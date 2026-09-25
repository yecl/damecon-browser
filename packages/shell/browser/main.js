import path from 'path'
import fsSync, { utimesSync } from 'fs'
import {
  app,
  session,
  BrowserWindow,
  Notification,
  ipcMain,
  nativeTheme,
  dialog,
  webFrameMain,
} from 'electron'
import { EventEmitter } from 'events'

if (require('electron-squirrel-startup')) app.quit()
app.setAppUserModelId('net.tsunkit.damecon')

// damecon config
import ConfigStore from 'configstore'
import { configSchema, updateConfigDefaults, populateConfigDefaults } from './ui/config-utils.js'

// These two break if using import syntax...?
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const { installChromeWebStore, loadAllExtensions } = require('electron-chrome-web-store')

import { buildChromeContextMenu } from 'electron-chrome-context-menu'
import setupMenu from './menu'
import Tabs from './tabs'

import { setTimeout as delay } from 'timers/promises'
import { debug, error } from 'console'

// for wildcard matching URLs to hide address bar for
import { isMatch } from 'matcher'

// Updaters
import './workers/worker-shim'
import updateWorker from 'worker-loader!./workers/updater-worker.js'

const homePath = app.getPath('home')
const hideHome = function (filePath) {
  return filePath.replace(homePath, process.platform == 'win32' ? '%USERPROFILE%' : '~')
}

const devtoolsDebug = true
const shellDebug = process.env.SHELL_DEBUG

// folder the app was launched from
// for installed versions, this is the squirrel folder, not the folder containing resource.
let appDir = app.getAppPath()
console.log('Base appPath:', hideHome(appDir))
let isSquirrel = false
//added case insentivity flag
const appDirCheck =
  /^(?<base>.+?)[\\/](?<path>(?<squirrelpath>app-\d+\.\d+\.\d+[\\/])?resources[\\/]app\.asar)$/i.exec(
    appDir,
  )
if (!!appDirCheck) {
  appDir = appDirCheck.groups.base
  isSquirrel = !!appDirCheck.groups.squirrelpath
}
console.log(`${isSquirrel ? 'Running' : 'Not running'} via Squirrel.`)

// ~\AppData\Roaming in windows, or ~/.config in linux.
const appDataDir = app.getPath('userData')
const homeDataLocation = path.join(homePath, app.name)

// Read config.json from appDir first (inside .app/Contents) as a template,
// then determine dataPath and use dataPath/config.json as the real config.
// If the real config doesn't exist, copy from the template.
const cfgOpts = {}
if (app.commandLine.hasSwitch('config-path')) {
  let cfgPath = app.commandLine.getSwitchValue('config-path')
  console.log('User-provided config path:', cfgPath)
  if (!path.isAbsolute(cfgPath)) cfgPath = path.join(appDir, cfgPath)
  if (!path.extname(cfgPath)) cfgPath = path.join(cfgPath, 'config.json')
  cfgOpts.configPath = cfgPath
} else if (app.isPackaged) {
  cfgOpts.configPath = path.join(appDir, 'config.json')
} else {
  cfgOpts.globalConfigPath = true
  console.log('Using global config path.')
}

const preexisting = fsSync.existsSync(path.join(appDir, 'userdata'))
if (preexisting) console.log('Detected preexisting userdata at current app location.')

updateConfigDefaults({ isSquirrel, preexisting })

// Read template config from appDir to determine dataPath
const templateStore = new ConfigStore('damecon-browser', {}, cfgOpts)
populateConfigDefaults(templateStore.all, configSchema, () => {})
const dataLocation =
  templateStore.get('app.data.location') || configSchema.app.data.location.default

// Resolve dataPath
let dataPath = appDir
switch (dataLocation) {
  case 'home':
    dataPath = homeDataLocation
    break
  case 'appdata':
    dataPath = appDataDir
    break
  case 'appdir':
    if (process.platform === 'darwin' && appDir.match(/\.app[\\/]Contents$/i)) {
      dataPath = path.join(path.dirname(path.dirname(appDir)), 'damecon-data')
    }
    break
  case 'custom': {
    const customPath = templateStore.get('app.data.customPath')
    if (customPath && fsSync.existsSync(customPath)) dataPath = customPath
    break
  }
}

// Use dataPath/config.json as the real config location
if (app.isPackaged) {
  const realCfgPath = path.join(dataPath, 'config.json')
  if (!fsSync.existsSync(realCfgPath)) {
    // Copy template config to dataPath
    const dir = path.dirname(realCfgPath)
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
    const templatePath = path.join(appDir, 'config.json')
    if (fsSync.existsSync(templatePath)) {
      fsSync.copyFileSync(templatePath, realCfgPath)
      console.log('Copied config.json to', hideHome(realCfgPath))
    }
  }
  cfgOpts.configPath = realCfgPath
  console.log('Config path:', hideHome(cfgOpts.configPath))
}

const configStore = new ConfigStore('damecon-browser', {}, cfgOpts)

const cfg = configStore.all
console.log('Populating defaults for config')
const configModified = populateConfigDefaults(cfg, configSchema, (...input) =>
  console.log(...input),
)

// config fixes
if (cfg.proxy.client.enable === 'false') cfg.proxy.client.enable = false // i'm stupid
if (typeof cfg.proxy.client.enable !== 'undefined') {
  cfg.proxy.enable = cfg.proxy.client.enable
  delete cfg.proxy.client.enable
}
if (!configSchema.proxy.mode.options.includes(cfg.proxy.mode)) {
  cfg.proxy.mode = configSchema.proxy.mode.default
  cfg.proxy.enable = false
}
delete cfg.proxy.method
delete cfg.proxy.client.httpsPort
configStore.all = cfg // save with updated defaults

if (!configStore.get('window.behavior.occlusion'))
  app.commandLine.appendSwitch('disable-renderer-backgrounding')

//app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1') // wants to prefer IPv6 otherwise
app.commandLine.appendSwitch('allow-insecure-localhost')

const gpuConfig = configStore.get('window.gpu')
app.commandLine.appendSwitch(
  'force-gpu-mem-available-mb',
  Math.max(256, gpuConfig.availableMemoryMb),
)
if (gpuConfig.rasterization) app.commandLine.appendSwitch('force-gpu-rasterization')
if (gpuConfig.nativeBuffers) app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
if (gpuConfig.compositorResources)
  app.commandLine.appendSwitch('enable-gpu-memory-buffer-compositor-resources')
app.commandLine.appendSwitch('enable-experimental-web-platform-features')
// Since Chromium 120 (Electron 28) chrome-extension:// frames inside DevTools (KC3's panel)
// get a partitioned localStorage that KC3's background page can't see.
// Only the last --disable-features switch counts, so merge with any existing value.
const disabledFeatures = new Set(
  app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean),
)
disabledFeatures.add('ThirdPartyStoragePartitioning')
app.commandLine.appendSwitch('disable-features', [...disabledFeatures].join(','))

//app.userAgentFallback = app.userAgentFallback.replace(' Electron/' + process.versions.electron, '');
// Shorten 'Electron' so we can bypass Google's "Unsecure" browser block without losing version information
app.userAgentFallback = app.userAgentFallback.replace(' Electron/', ' Elec/')
console.log('User-Agent:', app.userAgentFallback)
const userDataPath = path.join(dataPath, 'userdata')
app.setPath('userData', userDataPath)

if (process.execPath.match(/(damecon(-browser)?|chrome)/)) {
  const currentPath = path.dirname(process.execPath)
  console.log('process.execPath', process.execPath)
  console.log('currentPath', currentPath)
} else {
  // app.commandLine.appendSwitch('proxy-server', '192.168.0.123:1235')
}

// https://www.electronforge.io/config/plugins/webpack#main-process-code
const SHELL_ROOT_DIR = path.join(__dirname, '../../')
const ROOT_DIR = path.join(__dirname, '../../../../')
const PATHS = {
  USERDATA: userDataPath,
  APPDATA: appDataDir,
  APPDIR: appDir,
  HOME: app.getPath('home'),
  WEBUI: app.isPackaged
    ? path.resolve(process.resourcesPath, 'ui')
    : path.resolve(SHELL_ROOT_DIR, 'browser', 'ui'),
  WORKERS: app.isPackaged
    ? path.resolve(process.resourcesPath, 'workers')
    : path.resolve(SHELL_ROOT_DIR, 'browser', 'workers'),
  PRELOAD: path.join(__dirname, '../renderer/browser/preload.js'),
  LOCAL_EXTENSIONS: path.join(dataPath, 'extensions'),
  KC3_EXTENSIONS: path.join(dataPath, 'extensions'),
  //KC3_EXTENSIONS: path.join(ROOT_DIR, 'ext_kc3kai'),
}

console.log(`Is packaged: ${app.isPackaged}`)
console.log(`SHELL_ROOT_DIR: ${SHELL_ROOT_DIR}`)
console.log(`ROOT_DIR: ${ROOT_DIR}`)
console.log(`PATHS:`, PATHS)

// only allow one instance to run for now
if (!app.requestSingleInstanceLock()) {
  app.quit()
  console.log("!! shouldn't see me !!")
}

let webuiExtensionId
let webuiUrl

let kc3ExtensionId
let kc3StartPageUrl
let DMMPageUrl
let newTabUrl
let searchUrl
let settingsUrl
let confirmCloseUrls = []
const manifestExists = async (dirPath) => {
  if (!dirPath) return false
  const manifestPath = path.join(dirPath, 'manifest.json')
  try {
    return (await fs.stat(manifestPath)).isFile()
  } catch {
    return false
  }
}

if (isSquirrel) {
  // clear old versions
  if (configStore.get('app.update.removeOld')) {
    console.log('Removing previous versions.')
    const entries = fsSync.readdirSync(appDir)
    entries.forEach((entry) => {
      const match = entry.match(/^app-(?<version>\d+\.\d+\.\d+)$/)
      if (!match) return
      const version = match.groups.version
      if (version == app.getVersion()) return
      const entryPath = path.join(appDir, entry)
      const info = fsSync.statSync(entryPath)
      if (info.isFile()) return
      console.log('Removing', entry)
      try {
        fsSync.rmSync(entryPath, { recursive: true, force: true })
      } catch (error) {
        console.log(`Couldn't remove old version ${version}:`, error)
      }
    })
  }
}

const getParentWindowOfTab = (tab) => {
  switch (tab.getType()) {
    case 'window':
      return BrowserWindow.fromWebContents(tab)
    case 'browserView':
    case 'webview':
      return tab.getOwnerBrowserWindow()
    case 'backgroundPage':
      return BrowserWindow.getFocusedWindow()
    default:
      throw new Error(`Unable to find parent window of '${tab.getType()}'`)
  }
}

class TabbedBrowserWindow {
  constructor(options) {
    const self = this

    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })

    this.session = options.session || session.defaultSession
    this.extensions = options.extensions

    // Can't inheret BrowserWindow
    // https://github.com/electron/electron/issues/23#issuecomment-19613241
    this.window = new BrowserWindow(options.window)
    this.id = this.window.id

    self.initTabs(options)

    // load window chrome
    this.webContents = this.window.webContents
    this.webContents.on('did-finish-load', async () => {
      this.webContents.send('webui-message', {
        type: 'webui-init',
        meta: { windowId: this.id, allTabs: true },
        data: { windowId: this.window.id },
      })

      await this.ready

      if (!this.tabs.tabList.length) {
        queueMicrotask(async () => {
          for (const url of options.initialUrls) {
            const tab = this.tabs.create({ initialUrl: url })
            this.tabs.select(tab.id)
          }
        })
      }
    })
    this.webContents.loadURL(webuiUrl)
  }

  initTabs(options) {
    const self = this
    const tabsOpts = { newTabPageUrl: newTabUrl, searchPageUrl: searchUrl }
    this.tabs = new Tabs(this.window, tabsOpts)

    this.tabs.on('tab-created', function onTabCreated(tab) {
      //tab.loadURL(options.urls.newtab)

      // Track tab that may have been created outside of the extensions API.
      self.extensions.addTab(tab.webContents, tab.window)
    })

    this.tabs.on('tab-navigated', function onTabNavigated(tab, tabUrl) {
      //console.log(">> main.tabs.on('tab-navigated', tabsOpts)")
      if (
        (tabUrl === kc3StartPageUrl || tabUrl === DMMPageUrl) &&
        configStore.get('kc3kai.startup.openDevtools')
      ) {
        //delaying opening of devtools on initial tab load
        const startDevTools = async () => {
          const delaySeconds = configStore.get('kc3kai.startup.openDevtoolsDelay') || 0
          await delay(delaySeconds * 1000)
          tab.webContents.openDevTools({ activate: true })
        }
        startDevTools()
        //tab.webContents.openDevTools({ activate: true })
      }
    })

    this.tabs.on('tab-selected', function onTabSelected(tab) {
      //console.log(">> main.tabs.on('tab-selected', tabsOpts)")
      self.extensions.selectTab(tab.webContents)
    })

    this.tabs.on('tabs-hidden', function onTabsHidden(hidden) {
      //console.log(">> main.tabs.on('tabs-hidden', tabsOpts)")
      self.webContents.send('webui-message', {
        windowId: this.id,
        allTabs: true,
        message: 'tabs-hidden',
        value: hidden,
      })
    })
  }

  destroy() {
    this.tabs?.destroy()
    this.window?.destroy()
  }

  getFocusedTab() {
    return this.tabs.selected
  }
}

function logBytes(x, showAll = false) {
  if (!showAll && x[0] != 'rss') return
  console.log(x[0], x[1] / (1000.0 * 1000), 'MB')
}

function getMemory() {
  Object.entries(process.memoryUsage()).map((e) => logBytes(e))
}

class Browser extends EventEmitter {
  windows = []
  currentKc3ExtensionId = null
  kc3IsUpdating = false
  isProxyEnabled = false
  session = null

  urls = {
    newtab: 'about:blank',
  }

  constructor() {
    super()
    //setInterval(getMemory, 1000)

    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })

    app.whenReady().then(this.init.bind(this))

    // Our window 'close' handler always prevents the close, which cancels a quit in progress
    // once more than one window is open, so finish the quit here.
    app.on('before-quit', () => (this.quitting = true))
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' || this.quitting) {
        this.destroy()
      }
    })
    app.on('second-instance', () => {
      console.log(
        'Tried to open a second instance. Opening a new window in existing instance instead.',
      )
      this.createTabbedWindow({ initialUrls: [settingsUrl, newTabUrl] })
      /*
      const mainWindow = this.windows[0].window
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      */
    })

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) this.createInitialWindow()
    })

    app.on('web-contents-created', this.onWebContentsCreated.bind(this))
  }

  destroy() {
    app.quit()
  }

  async applyProxy() {
    const proxyCfg = configStore.get('proxy')
    this.isProxyEnabled = proxyCfg.enable
    const mode = proxyCfg.mode

    const simpleModes = ['http-proxy', 'socks5-proxy']

    if (this.isProxyEnabled && simpleModes.includes(mode)) {
      const host = proxyCfg.client.host
      const port = proxyCfg.client.port
      // Chromium proxyRules format: socks5 needs scheme prefix, HTTP proxy uses host:port directly
      const proxyRules = mode === 'socks5-proxy' ? `socks5://${host}:${port}` : `${host}:${port}`
      console.log('Applying simple proxy settings:', mode, proxyRules)
      await this.session.setProxy({ mode: 'fixed_servers', proxyRules })
    } else {
      console.log('Clearing proxy settings')
      await this.session.setProxy({ mode: 'system' })
    }

    // Sync proxy settings to worker threads (for Node.js fetch)
    if (this.updateWorker) {
      let proxyUrl = null
      if (this.isProxyEnabled && simpleModes.includes(mode)) {
        const scheme = mode === 'socks5-proxy' ? 'socks5' : 'http'
        proxyUrl = `${scheme}://${proxyCfg.client.host}:${proxyCfg.client.port}`
      }
      this.updateWorker.postMessage({ type: 'set-proxy', data: { proxyUrl } })
    }
  }

  getFocusedWindow() {
    return this.windows.find((w) => w.window.isFocused()) || this.windows[0]
  }

  getWindowFromBrowserWindow(window) {
    return !window.isDestroyed() ? this.windows.find((w) => w.id === window.id) : null
  }

  getWindowFromWebContents(webContents) {
    let window

    if (this.popup && webContents === this.popup.browserWindow?.webContents) {
      window = this.popup.parent
    } else {
      window = getParentWindowOfTab(webContents)
    }

    return window ? this.getWindowFromBrowserWindow(window) : null
  }

  async init() {
    this.initSession()
    setupMenu(this)

    this.session.registerPreloadScript({
      id: 'shell-preload',
      type: 'frame',
      filePath: PATHS.PRELOAD,
    })

    this.extensions = new ElectronChromeExtensions({
      license: 'internal-license-do-not-use',
      session: this.session,

      createTab: async (details) => {
        //console.log('>> main.extensions.createTab()')
        await this.ready

        const parentWin =
          typeof details.windowId === 'number' &&
          this.windows.find((w) => w.id === details.windowId)

        if (!parentWin) {
          throw new Error(`Unable to find windowId=${details.windowId}`)
        }

        const tab = parentWin.tabs.create()

        if (details.url) tab.loadURL(details.url)
        if (typeof details.active === 'boolean' ? details.active : true)
          parentWin.tabs.select(tab.id)

        return [tab.webContents, tab.window]
      },
      selectTab: (tab, browserWindow) => {
        //console.log('>> main.extensions.selectTab()')
        const parentWin = this.getWindowFromBrowserWindow(browserWindow)
        parentWin?.tabs.select(tab.id)
      },
      beforeRemoveTab: (tab) => {
        if (!confirmCloseUrls.includes(tab.mainFrame.url)) return true
        return this.checkConfirmClose()
      },
      removeTab: (tab, browserWindow) => {
        //console.log('>> main.extensions.removeTab()')
        const parentWin = this.getWindowFromBrowserWindow(browserWindow)
        parentWin?.tabs.remove(tab.id)
        if (parentWin?.tabs.tabList.length === 0) {
          this.removeWindow(parentWin)
        }
      },

      createWindow: async (details) => {
        //console.log('>> main.extensions.createWindow()')
        await this.ready

        const newWin = this.createTabbedWindow({
          initialUrls: [settingsUrl, details.url],
        })
        // if (details.active) tabs.select(tab.id)
        return newWin.window
      },
      beforeRemoveWindow: (browserWindow) => {
        const tabWin = this.getWindowFromBrowserWindow(browserWindow)
        const confirmTab = tabWin.tabs.tabList.find((t) =>
          confirmCloseUrls.includes(t.webContents.mainFrame.url),
        )
        if (!confirmTab) return true
        return this.checkConfirmClose()
      },
      removeWindow: (browserWindow) => {
        this.removeWindow(browserWindow)
      },
    })

    // Display <browser-action-list> extension icons.
    ElectronChromeExtensions.handleCRXProtocol(this.session)

    this.extensions.on('browser-action-popup-created', (popup) => {
      // parent isn't set correctly, let's patch it
      //const focused = this.extensions.api.windows.getLastFocused()
      //const tabbedWin = this.windows.find((w) => w.window.id === focused.id)
      //popup.parent = tabbedWin.window
      this.popup = popup
    })

    // Allow extensions to override new tab page
    this.extensions.on('url-overrides-updated', (urlOverrides) => {
      if (urlOverrides.newtab) {
        this.urls.newtab = urlOverrides.newtab
      }
    })

    // extension containing window chrome UI
    const webuiExtension = await this.session.extensions.loadExtension(PATHS.WEBUI)
    webuiExtensionId = webuiExtension.id
    webuiUrl = `chrome-extension://${webuiExtensionId}/webui.html`

    // Wait for web store extensions to finish loading as they may change the
    // newtab URL.
    console.log('Initializing webstore system.')
    await installChromeWebStore({
      session: this.session,
      async beforeInstall(details) {
        if (!details.browserWindow || details.browserWindow.isDestroyed()) return

        const title = `Add “${details.localizedName}”?`

        let message = `${title}`
        if (details.manifest.permissions) {
          const permissions = (details.manifest.permissions || []).join(', ')
          message += `\n\nPermissions: ${permissions}`
        }

        const returnValue = await dialog.showMessageBox(details.browserWindow, {
          title,
          message,
          icon: details.icon,
          buttons: ['Cancel', 'Add Extension'],
        })

        return { action: returnValue.response === 0 ? 'deny' : 'allow' }
      },
    })

    //if (!app.isPackaged) {
    if (fsSync.existsSync(PATHS.LOCAL_EXTENSIONS)) {
      console.log('Loading extensions')
      await loadAllExtensions(this.session, PATHS.LOCAL_EXTENSIONS, {
        allowUnpacked: true,
        filterRegex: /^(?!kc3kai).*(?:[/\\]src)?$/,
        filterCallback: (ext) => {
          console.log(`Checking extension ${ext.manifest.name}`)
          if (ext.manifest.name === 'uBlock Origin') {
            const version = ext.manifest.version.split('.').map((i) => parseInt(i))
            const v = [1, 47, 4]
            if ([0, 1].some((i) => version[i] > v[i])) {
              const notice = `${ext.manifest.name} versions above ${v.join('.')} may cause a severe memory leak and are currently unsupported.`
              console.error(notice)
              console.log(
                `${ext.manifest.name} version ${ext.manifest.version} will not be loaded.`,
              )
              return false
            }
          }
          return true
        },
      })
    }

    console.log('Starting extension workers.')
    await Promise.all(
      this.session.extensions.getAllExtensions().map(async (extension) => {
        const manifest = extension.manifest
        if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
          await this.session.serviceWorkers.startWorkerForScope(extension.url).catch((error) => {
            console.error(error)
          })
        }
      }),
    )

    // theme handling
    const bright = configStore.get('window.style.brightness') || 'system'
    nativeTheme.themeSource = bright
    nativeTheme.on('updated', (ev) => {
      //console.log('nativeTheme.updated', ev)
    })

    // initial window creation
    const webuiBase = 'chrome-extension://' + webuiExtensionId
    newTabUrl = webuiBase + '/new-tab.html'
    settingsUrl = webuiBase + '/settings.html'
    searchUrl = webuiBase + '/search.html'

    const initialWindow = this.createTabbedWindow({
      initialUrls: [settingsUrl],
      hideAddressBarFor: [settingsUrl],
    })

    // Messages from webui/settings
    ipcMain.handle('webui-message', async (ev, meta, data) => {
      // The shell preload matches by path, so other extensions' background pages get window.ipc too.
      if (!ev.senderFrame?.url.startsWith(webuiBase + '/')) throw new Error('Forbidden')
      let result
      switch (meta.type) {
        case 'get-damecon-info':
          result = {
            version: `${app.getName()} v${app.getVersion()}`,
            paths: {
              home: homeDataLocation,
              app: appDir,
              appData: appDataDir,
            },
          }
          break
        case 'get-damecon-version':
          result = `${app.getName()} v${app.getVersion()}`
          break
        case 'get-config-item':
          result = configStore.get(data.key)
          break
        case 'get-config':
          result = configStore.all
          break
        case 'set-config-item':
          result = configStore.set(data.key, data.value)
          if (data.key.startsWith('proxy.')) {
            await this.applyProxy()
          } else if (data.key == 'kc3kai.update.channel') {
            if (kc3ExtensionId) this.session.extensions.removeExtension(kc3ExtensionId)
            await this.updateKc3IfScheduled()
          } else if (data.key === 'window.style.brightness') {
            nativeTheme.themeSource = data.value
          } else if (data.key.startsWith('kc3kai.custom')) {
            const kc3Path = this.getKc3Path()
            await this.checkStartKc3(kc3Path)
          } else if (data.key == 'kancolle.forceCookieHack' && data.value == true) {
            this.applyCookieHack()
          }
          this.sendToAllWindows('config-saved', configStore.all)
          break
        case 'get-should-hide-addressbar':
          if (data.url === settingsUrl) {
            result = true
          } else {
            const sites = configStore
              .get('window.view.hideAddressBarSites')
              .map((site) =>
                site.replace('{{kc3-extension}}', `chrome-extension://${kc3ExtensionId}`),
              )
            result = isMatch(data.url, sites)
          }
          break
        case 'clear-cache':
          await this.session.clearCache()
          console.log('Cache cleared.')
          break
        case 'start-find-in-page':
          this.startFindInPage(data.tabId, data.searchInput)
          break
        case 'close-find-in-page':
          this.setFindInPageVisible(data.tabId, false)
          break
        case 'kc3-doupdate':
          await this.updateKc3(configStore.get('kc3kai.update.channel'))
          break
        case 'kc3-get-isupdating':
          result = { isUpdating: this.kc3IsUpdating, channel: this.kc3UpdatingChannel }
          break
        case 'kc3-select-custom-location':
        case 'select-custom-data-location':
          const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: data?.defaultPath || undefined,
          })
          result = { canceled, filePaths }
          break
        case 'webui-init-complete':
          let initWin = this.windows.find((w) => w.window.id === meta.windowId)
          initWin.resolveReady()
          break
        case 'fit-game-to-window': {
          const fitWin = this.windows.find((w) => w.window.id === meta.windowId)
          const fitTab = fitWin?.tabs.selected
          if (fitTab) {
            const viewBounds = fitTab.view.getBounds()
            const viewW = viewBounds.width
            const viewH = viewBounds.height
            const scale = Math.min(viewW / 1200, viewH / 720)
            // Only zoom when we're actually in the game view:
            // kc3kai creates `.box-game .game-swf` iframe when the user
            // starts the game. If that iframe doesn't exist, it's either
            // a non-game page (settings/about/...) or the pre-play screen,
            // and we must do nothing.
            await fitTab.webContents.executeJavaScript(`
              (function() {
                const gameSwf = document.querySelector('.box-game .game-swf');
                if (!gameSwf) return;
                const wrap = document.querySelector('.box-wrap');
                if (!wrap) return;
                wrap.style.zoom = ${scale};
              })()
            `)
          }
          break
        }
        case 'webui-display-mode-changed': {
          // Tab bounds are window DIPs; webui sends its top bar height in CSS px.
          const layoutWin = this.windows.find((w) => w.window.id === meta.windowId)
          layoutWin?.tabs.updateLayout(
            Math.round(data.height * layoutWin.webContents.getZoomFactor()),
          )
          break
        }
        case 'webui-close-tab':
          //console.log('clicked tab X', data)
          this.confirmCloseTab(data.tabId)
          break
      }
      return result
    })

    await initialWindow.ready
    this.resolveReady()

    // set up kc3 update worker thread
    console.log('Starting KC3 update service')

    this.updateWorker = new updateWorker()
    this.updateWorker.on('message', this.handleWorkerMessage.bind(this))

    await this.applyProxy()
    await this.updateKc3IfScheduled()
  }

  async handleWorkerMessage(msg) {
    //console.log('main.js received message from KC3 update worker', msg)
    // msg: { type, data }
    if (!msg?.type)
      throw new Error('Messages sent from worker must be in the format { type, data }')
    switch (msg.type) {
      case 'status-kc3-is-updating':
        this.kc3IsUpdating = msg.data.isUpdating
        this.kc3UpdatingChannel = msg.data.channel
        this.sendToAllWindows(msg.type, msg.data)
        break
      case 'error-do-kc3-update':
      case 'update-process-started':
      case 'update-process-progress':
        this.sendToAllWindows(msg.type, msg.data)
        break
      case 'update-process-completed':
        this.sendToAllWindows(msg.type, msg.data)

        if (msg.data.name === 'KC3 Update') {
          const kc3Path = this.getKc3Path()
          if (!kc3Path) {
            //console.log('No kc3 path provided.')
            return
          }
          const channel = this.kc3UpdatingChannel
          if (!channel.startsWith('custom'))
            configStore.set('kc3kai.update.time.' + channel, Date.now())
          await this.checkStartKc3(kc3Path)
        }
        break
      default:
        throw new Error(`Unknown message type ${msg.type}`)
    }
  }

  removeWindow(browserWindow) {
    const removingWin = this.windows.find((w) => w.id == browserWindow.id)

    const idx = this.windows.indexOf(removingWin)
    if (idx >= 0) this.windows.splice(idx, 1)

    if (removingWin?.window.isDestroyed() === false) removingWin.destroy()
  }

  sendToAllWindows(type, data) {
    if (!(this.windows?.length > 0)) return

    // windows seem to have trouble keeping themselves separated logically...
    this.windows.forEach((w) =>
      w.window.webContents.send('webui-message', {
        type,
        meta: { windowId: w.id, allTabs: true },
        data,
      }),
    )
  }

  sendToWindow(windowId, type, data) {
    if (!(this.windows?.length > 0)) return
    const window = this.windows.find((w) => w.id === windowId)
    if (!window) throw new Error(`No window present with ID ${windowId}`)
    window.window.webContents.send('webui-message', {
      type,
      meta: { windowId, allTabs: true },
      data,
    })
  }

  sendToTab(tabId, type, data) {
    if (!(this.windows?.length > 0)) return
    const window = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    if (!window) throw new Error(`No window present containing tab ID ${tabId}`)
    const tab = window.tabs.tabList.find((t) => t.id == tabId)
    tab.webContents.send('webui-message', { type, meta: { windowId: window.id, tabId }, data })
  }

  initSession() {
    //console.log('>> main.initSession()')
    this.session = session.defaultSession

    if (configStore.get('kancolle.forceCookieHack')) {
      this.applyCookieHack()
    }

    this.session.cookies.on('changed', (event, cookie, cause, removed) => {
      if (!configStore.get('kancolle.forceCookieHack')) return
      // Every non-removal is an insert. Electron >= 41 reports it as 'inserted*', not 'explicit'.
      if (removed) return
      if (cookie.domain != '.dmm.com' || !cookie.name.startsWith('ck')) return
      //console.log(`Cookie ${removed ? 'removed' : 'changed'}: ${cookie.name} ; Cause: ${cause}`)
      this.interceptCookieUpdate({ cookie, cause, removed })
    })

    this.session.serviceWorkers.on('running-status-changed', (event) => {
      console.info(`service worker ${event.versionId} ${event.runningStatus}`)
    })

    if (shellDebug) {
      this.session.serviceWorkers.once('running-status-changed', () => {
        const tab = this.windows[0]?.getFocusedTab()
        if (tab) {
          tab.webContents.inspectServiceWorker()
        }
      })
    }
  }

  createTabbedWindow(options) {
    //console.log('>> main.createWindow()')
    const windowConfig = configStore.get('window')

    const newTabbedWindow = new TabbedBrowserWindow({
      ...options,
      //urls: this.urls,
      extensions: this.extensions,
      window: {
        width: windowConfig.state?.width || configSchema.window.state.width.default,
        height: windowConfig.state?.height || configSchema.window.state.height.default,
        frame: false,
        titleBarStyle: 'hidden',
        // remove the min/max/close buttons so we can theme them
        /*titleBarOverlay: {
          height: 31,
          color: '#39375b',
          symbolColor: '#ffffff',
        },//*/
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: true,
          enableRemoteModule: false,
          contextIsolation: true,
          worldSafeExecuteJavaScript: true,
          backgroundThrottling: windowConfig.behavior.occlusion,
        },
        icon: path.join(__dirname, 'icon.ico'),
      },
    })

    newTabbedWindow.window.on('close', (ev) => {
      ev.preventDefault()
      const idx = this.windows.indexOf(newTabbedWindow)

      const confirmTab = newTabbedWindow.tabs.tabList.find((t) =>
        confirmCloseUrls.includes(t.webContents.mainFrame.url),
      )
      if (confirmTab) {
        const leave = this.checkConfirmClose()
        if (!leave) {
          this.quitting = false
          return
        }
      }

      this.windows.splice(idx, 1)
      newTabbedWindow.destroy()
    })
    const onInput = (event, input) => this.handleShortcut(newTabbedWindow, event, input)
    newTabbedWindow.webContents.on('before-input-event', onInput)
    newTabbedWindow.tabs.on('tab-created', (tab) => {
      tab.webContents.on('before-input-event', onInput)
      tab.searchView.webContents.on('before-input-event', onInput)
    })
    newTabbedWindow.window.on('resize', () => {
      // WebContentsView has no setAutoResize
      newTabbedWindow.tabs.updateLayout()
      this.sendToWindow(newTabbedWindow.id, 'webui-display-mode', {
        mode: newTabbedWindow.window.isMaximized() ? 'maximized' : 'normal',
      })
      if (newTabbedWindow.window.isMaximized()) return
      const size = newTabbedWindow.window.getSize()
      try {
        configStore.set('window.state.width', size[0])
        configStore.set('window.state.height', size[1])
      } catch (error) {
        console.error('Failed to set window.state values during resize.')
      }
    })
    this.windows.push(newTabbedWindow)

    //* webui.html
    if (devtoolsDebug && shellDebug) {
      newTabbedWindow.webContents.openDevTools({ mode: 'detach' })
    } //*/

    return newTabbedWindow
  }

  createInitialWindow() {
    //console.log('>> main.createInitialWindow()')
    this.createTabbedWindow({
      initialUrls: [settingsUrl],
      hideAddressBarFor: [settingsUrl],
    })
  }

  windowOpenHandler(webContents, details) {
    switch (details.disposition) {
      case 'foreground-tab':
      case 'background-tab':
      case 'new-window': {
        queueMicrotask(() => {
          const sourceWin = this.getWindowFromWebContents(webContents)
          if (!sourceWin) return
          const opts = {}
          const tab = sourceWin.tabs.create(opts)
          if (
            shellDebug ||
            ((details.url == kc3StartPageUrl || details.url === DMMPageUrl) &&
              configStore.get('kc3kai.startup.openDevtools'))
          ) {
            //delaying opening of devtools on tab open
            const startDevTools = async () => {
              const delaySeconds = configStore.get('kc3kai.startup.openDevtoolsDelay') || 0
              await delay(delaySeconds * 1000)
              tab.webContents.openDevTools({ activate: true })
            }
            startDevTools()
            //tab.webContents.openDevTools({ activate: true })
          }

          // POST submission
          const loadOpts = {}
          if (details.referrer) loadOpts.httpReferrer = details.referrer
          if (details.postBody) {
            loadOpts.postData = details.postBody.data
            if (details.postBody.contentType)
              loadOpts.extraHeaders = `Content-Type: ${details.postBody.contentType}`
          }

          tab.loadURL(details.url, loadOpts)

          // extension popups don't auto-close when using window.open for whatever reason
          if (this.popup) {
            this.popup.destroy()
          }
        })

        return { action: 'deny' }
      }
      default:
        return { action: 'allow' }
    }
  }

  getNumericVersion() {
    // for version M.m.r
    // give a simple numeric version MMmmrr
    const version = app.getVersion().split('.').reverse()
    let numeric = 0
    for (let i = 0; i < version.length; i++) {
      numeric += version[i] * Math.pow(10, i * 2)
    }
    return numeric
  }

  devtoolsPolyfillJs = `
    (function() {
      window.open = function (url, name, features) {
        if (RMsg) {
          (new RMsg("service", "windowOpen", {url})).execute();
        }
        else console.error("Attempted to execute window.open, but the API is broken")
      }
    }());`

  alwaysActiveUpdateJs = `
    (function() {
      console.log("Running always-active injection.", document?.URL)

      Object.defineProperty(document, 'hidden', {
        value: false,
        configurable: false
      });
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: false
      });
    }());`

  canvasUpdateJs = `
    (function() {
      console.log("Running canvas preserveDrawingBuffer injection.", document?.URL)

      // Set preserveDrawingBuffer to true, so we can save canvas as image :)
      // Source from https://github.com/greggman/webgl-helpers/blob/master/webgl-force-preservedrawingbuffer.js
      if (typeof HTMLCanvasElement !== "undefined") {
        wrapGetContext(HTMLCanvasElement);
      }
      if (typeof OffscreenCanvas !== "undefined") {
        wrapGetContext(OffscreenCanvas);
      }

      function wrapGetContext(ContextClass) {
        const isWebGL = /webgl/i;

        ContextClass.prototype.getContext = function(origFn) {
          return function(type, attributes) {
            if (isWebGL.test(type)) {
              attributes = Object.assign({}, attributes || {}, {preserveDrawingBuffer: true});
            }
            return origFn.call(this, type, attributes);
          };
        }(ContextClass.prototype.getContext);
      }
    }());`

  applyCookieHack() {
    const playUrl = 'https://games.dmm.com'
    const kcUrl = 'https://play.games.dmm.com' // /game/kancolle
    const cookies = [
      [kcUrl, 'cklg', 'welcome', '.dmm.com', '/'],
      [kcUrl, 'cklg', 'welcome', '.dmm.com', '/netgame/'],
      [kcUrl, 'cklg', 'welcome', '.dmm.com', '/netgame_s/'],
      [kcUrl, 'cklg', 'welcome', '.dmm.com', '/play/'],
      [kcUrl, 'ckcy', '1', '.dmm.com', '/'],
      [kcUrl, 'ckcy', '1', '.dmm.com', '/netgame/'],
      [kcUrl, 'ckcy', '1', '.dmm.com', '/netgame_s/'],
      [kcUrl, 'ckcy', '1', '.dmm.com', '/play/'],
      //['ckcy', '1', 'www.dmm.com', '/'],
      //['ckcy', '1', 'osapi.dmm.com', '/'],
      //['ckcy', '1', 'log-netgame.dmm.com', '/'],
      [kcUrl, 'ckcy_remedied_check', 'ec_mrnhbtk', '.dmm.com', '/'],
    ]
    const expires = new Date(+new Date() + 31536e6) * 60 * 60 * 24 * 7

    cookies.forEach((c) => {
      const cookie = {
        url: c[0],
        name: c[1],
        value: c[2],
        domain: c[3],
        path: c[4],
        expirationDate: expires,
      }
      this.session.cookies.set(cookie)
    })

    console.log('DMM cookie hack applied.')
  }

  interceptCookieUpdate(changeInfo) {
    var nextYear = new Date()
    nextYear.setFullYear(nextYear.getFullYear() + 1)

    // CKCY force 1
    if (changeInfo.cookie.name == 'ckcy' && changeInfo.cookie.value != '1') {
      console.log('ckcy cookie changed, re-hacking it.')
      // console.log("CKCY=", changeInfo.cookie.value, changeInfo);
      this.session.cookies.set(
        {
          url: 'https://play.games.dmm.com',
          name: 'ckcy',
          value: '1',
          domain: '.dmm.com',
          expirationDate: Math.ceil(nextYear.getTime() / 1000),
          path: changeInfo.cookie.path,
        },
        function (cookie) {
          // console.log("ckcy cookie re-hacked", cookie);
        },
      )
    }

    // CKLG force welcome
    if (changeInfo.cookie.name == 'cklg' && changeInfo.cookie.value != 'welcome') {
      console.log('cklg cookie changed, re-hacking it.')
      // console.log("CKLG=", changeInfo.cookie.value, changeInfo);
      this.session.cookies.set(
        {
          url: 'https://play.games.dmm.com',
          name: 'cklg',
          value: 'welcome',
          domain: '.dmm.com',
          expirationDate: Math.ceil(nextYear.getTime() / 1000),
          path: changeInfo.cookie.path,
        },
        function (cookie) {
          // console.log("cklg cookie re-hacked", cookie);
        },
      )
    }

    // ckcy_remedied_check force?
    if (
      changeInfo.cookie.name == 'ckcy_remedied_check' &&
      changeInfo.cookie.value != 'ec_mrnhbtk'
    ) {
      console.log('ckcy_remedied_check cookie changed, re-hacking it.')
      // console.log("ckcy_remedied_check=", changeInfo.cookie.value, changeInfo);
      this.session.cookies.set(
        {
          url: 'https://play.games.dmm.com',
          name: 'ckcy_remedied_check',
          value: 'ec_mrnhbtk',
          domain: '.dmm.com',
          expirationDate: Math.ceil(nextYear.getTime() / 1000),
          path: changeInfo.cookie.path,
        },
        function (cookie) {
          // console.log("ckcy_remedied_check cookie re-hacked", cookie);
        },
      )
    }
  }

  async onWebContentsCreated(event, webContents) {
    const browser = this
    const type = webContents.getType()
    const url = webContents.getURL()

    webContents.setBackgroundThrottling(configStore.get('window.behavior.occlusion'))

    webContents.on('devtools-opened', (e) => {
      const devtools = webContents.devToolsWebContents
      console.log('DevTools opened')
      devtools.on('did-create-window', (window, details) => {
        console.log('Window created', details)
      })
    })

    //*
    const devToolsTypes = ['backgroundPage', 'remote']
    if (devtoolsDebug && shellDebug && devToolsTypes.includes(webContents.getType())) {
      webContents.openDevTools({ mode: 'detach', activate: true })
    } //*/

    webContents.setWindowOpenHandler((details) =>
      this.windowOpenHandler.bind(this)(webContents, details),
    )

    webContents.on('context-menu', (event, params) => {
      const menu = buildChromeContextMenu({
        params,
        webContents,
        extensionMenuItems: this.extensions.getContextMenuItems(webContents, params),
        openLink: (url, disposition) => {
          const activeWin = this.getFocusedWindow()

          switch (disposition) {
            case 'new-window':
              this.createTabbedWindow({ initialUrls: [settingsUrl, url] })
              break
            default:
              const tab = activeWin.tabs.create()
              tab.loadURL(url)
          }
        },
      })

      menu.popup()
    })

    webContents.on('zoom-changed', (event, zoomDirection) => {
      //console.log(">> webContents.on('zoom-changed')", zoomDirection)
      var currentZoom = webContents.getZoomFactor()
      const isWebui = webContents.mainFrame.url == webuiUrl
      let increment = isWebui ? 0.1 : 0.2
      let min = isWebui ? 0.5 : 0.2
      let max = isWebui ? 1.5 : 2.0

      if (zoomDirection === 'in') {
        webContents.zoomFactor = Math.min(max, currentZoom + increment)
      }
      if (zoomDirection === 'out') {
        webContents.zoomFactor = Math.max(min, currentZoom - increment)
      }
    })

    webContents.on('will-prevent-unload', (event) => {
      if (this.checkConfirmClose()) event.preventDefault()
    })

    // Inject canvas getContext interception so we can copy/save canvas contents as an image
    webContents.on(
      'did-frame-navigate',
      (
        event,
        url,
        httpResponseCode,
        httpStatusText,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      ) => {
        const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
        // Electron >= 33 may hand back no frame or a detached one
        if (!frame || frame.detached) return
        const isDevTools = url.startsWith('devtools:')
        const isDevToolsPanel = frame.parent?.url.startsWith('devtools:')
        const isCustomDevtoolsPanel = url.startsWith('chrome-extension:') && isDevToolsPanel
        frame.executeJavaScript(this.alwaysActiveUpdateJs)
        // {preserveDrawingBuffer: true} for canvas getContext
        const skip = ['devtools:', 'about:']
        if (!skip.some((s) => url.startsWith(s))) frame.executeJavaScript(this.canvasUpdateJs)
        if (isCustomDevtoolsPanel) frame.executeJavaScript(this.devtoolsPolyfillJs)
      },
    )
  }

  checkConfirmClose() {
    if (!configStore.get('window.behavior.confirmCloseGamePage')) return true
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['Leave', 'Stay'],
      title: 'Do you want to leave this site?',
      message: 'Changes you made may not be saved.',
      defaultId: 0,
      cancelId: 1,
    })
    return choice === 0
  }

  // Window-level shortcuts for a window's webui, tab and find-bar webContents. Not globalShortcut:
  // on Wayland (native by default since Electron 38) that goes through the desktop portal, which
  // needs a .desktop identity and may prompt or refuse.
  handleShortcut(win, event, input) {
    const tab = win.getFocusedTab()
    if (input.type !== 'keyDown' || !tab) return
    const isMac = process.platform === 'darwin'
    // ponytail: physical key positions (input.code); use input.key if non-QWERTY layouts need it
    const accelerator = [
      (isMac ? input.meta : input.control) && 'CmdOrCtrl',
      (isMac ? input.control : input.meta) && 'Super',
      input.alt && 'Alt',
      input.shift && 'Shift',
      input.code.replace(/^Key/, ''),
    ]
      .filter(Boolean)
      .join('+')
    switch (accelerator) {
      case 'CmdOrCtrl+T':
        win.tabs.create()
        break
      case 'CmdOrCtrl+N':
        this.createTabbedWindow({ initialUrls: [settingsUrl, newTabUrl] })
        break
      case 'CmdOrCtrl+R':
      case 'F5':
        tab.webContents.reload()
        break
      case 'CmdOrCtrl+Shift+R':
      case 'CmdOrCtrl+F5':
        tab.webContents.reloadIgnoringCache()
        break
      case 'CmdOrCtrl+W':
      case 'CmdOrCtrl+F4':
        this.confirmCloseTab(tab.id)
        break
      case 'F3':
      case 'CmdOrCtrl+F':
        this.setFindInPageVisible(tab.id, true)
        break
      case 'Escape':
        this.setFindInPageVisible(tab.id, false)
        break
      case 'Alt+A':
        this.toggleAddressBar(tab.id)
        break
      case 'Alt+D':
        this.focusAddressBar(tab.id)
        break
      case 'CmdOrCtrl+Tab':
        this.nextTab(tab.id)
        break
      case 'CmdOrCtrl+Shift+Tab':
        this.prevTab(tab.id)
        break
      default:
        return
    }
    event.preventDefault()
  }

  confirmCloseTab(tabId) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    const tab = parentWin.tabs.tabList.find((t) => t.id == tabId)
    if (parentWin.tabs.tabList.length > 1 && tab.webContents.mainFrame.url === settingsUrl) {
      return
    }
    let leave = true
    // add other URLs requiring confirmation here
    if (confirmCloseUrls.includes(tab.webContents.mainFrame.url)) {
      leave = this.checkConfirmClose()
    }
    if (leave) parentWin.tabs.remove(tab.id)
    //if (!parentWin.tabs.tabList.length)
    //this.removeWindow(parentWin.window)
  }

  toggleAddressBar(tabId) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    this.sendToWindow(parentWin.id, 'webui-toggle-addressbar')
  }

  focusAddressBar(tabId) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    const tab = parentWin.tabs.tabList.find((t) => t.id == tabId)
    const url = tab?.url || tab?.webContents.mainFrame.url
    if (url == settingsUrl) return

    parentWin.webContents.focus()
    this.sendToWindow(parentWin.id, 'webui-focus-addressbar')
  }

  prevTab(tabId) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    if (parentWin.tabs.tabList.length <= 1) return
    let tabIdx = parentWin.tabs.tabList.findIndex((t) => t.id == tabId) - 1
    if (tabIdx < 1) tabIdx = parentWin.tabs.tabList.length - 1
    parentWin.tabs.select(parentWin.tabs.tabList[tabIdx].id)
  }
  nextTab(tabId) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    if (parentWin.tabs.tabList.length <= 1) return
    let tabIdx = parentWin.tabs.tabList.findIndex((t) => t.id == tabId) + 1
    if (tabIdx >= parentWin.tabs.tabList.length) tabIdx = 1
    parentWin.tabs.select(parentWin.tabs.tabList[tabIdx].id)
  }

  setFindInPageVisible(tabId, visible) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    const tab = parentWin.tabs.tabList.find((t) => t.id == tabId)

    tab.setFindInPageVisible(visible)
  }
  startFindInPage(tabId, searchInput) {
    const parentWin = this.windows.find((w) => w.tabs.tabList.some((t) => t.id == tabId))
    const tab = parentWin.tabs.tabList.find((t) => t.id == tabId)

    tab.findInPage(searchInput)
  }

  getKc3Path() {
    const currentChannel = configStore.get('kc3kai.update.channel')
    let kc3Path
    if (currentChannel.startsWith('custom'))
      kc3Path = configStore.get(`kc3kai.${currentChannel}Location`)
    else kc3Path = path.join(PATHS.KC3_EXTENSIONS, 'kc3kai-' + currentChannel)
    return kc3Path
  }

  async updateKc3IfScheduled() {
    // update if configured schedule warrants it
    const currentChannel = configStore.get('kc3kai.update.channel')
    const canUpdate = !currentChannel.startsWith('custom')
    const lastUpdated = configStore.get('kc3kai.update.time.' + currentChannel)
    const schedule = configStore.get('kc3kai.update.schedule')
    const autoUpdate = configStore.get('kc3kai.update.auto')
    const scheduleMap = {
      startup: 0,
      daily: 1,
      weekly: 7,
      manual: 999999,
    }
    let doUpdate = false
    if (canUpdate && autoUpdate && (!lastUpdated || scheduleMap[schedule] >= 0)) {
      if (!lastUpdated) doUpdate = true
      else {
        let date = new Date(lastUpdated)
        date.setDate(date.getDate() + scheduleMap[schedule])
        doUpdate = date < new Date()
        console.log('Next KC3 update scheduled for ', date)
      }
    }

    if (doUpdate) {
      await delay(1000)
      await this.updateKc3(currentChannel)
    } else {
      const kc3Path = this.getKc3Path()
      await this.checkStartKc3(kc3Path)
    }
  }

  async updateKc3(channel) {
    this.updateWorker.postMessage({
      type: 'do-kc3-update',
      data: { path: PATHS.KC3_EXTENSIONS, channel },
    })
  }

  async checkStartKc3(kc3Path) {
    if (!!this.currentKc3ExtensionId) {
      this.windows.forEach((w) => w.tabs.removeExtensionTabs(this.currentKc3ExtensionId))
    }

    if (!kc3Path) {
      console.log('No kc3 path defined.')
      return
    }

    const kc3SrcPath = path.join(kc3Path, 'src')
    if (fsSync.existsSync(kc3SrcPath)) kc3Path = kc3SrcPath
    console.log('Searching for KC3Kai in', hideHome(kc3Path))

    // once we're updated and kc3 is loaded, remove the default new tab page
    // and open the kc3 start page + strat room

    if (!fsSync.existsSync(kc3Path)) {
      console.error(`Unable to find KC3 in ${hideHome(kc3Path)}.`)
      console.log("Please open the KC3Kai section and click 'Check for updates & reload'.")
      return
    }

    let kc3
    try {
      kc3 = await this.session.extensions.loadExtension(kc3Path)
    } catch (error) {
      console.error(
        `Unable to load KC3 from ${hideHome(kc3Path)}. It may need to be installed/updated.`,
      )
      console.error(error)
      return
    }
    console.log('KC3Kai loaded! ID: ', kc3.id)

    // open KC3 start page
    kc3ExtensionId = kc3.id
    this.currentKc3ExtensionId = kc3ExtensionId

    kc3StartPageUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/game/direct.html'
    //DMMPageUrl = 'https://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/'
    DMMPageUrl = 'https://play.games.dmm.com/game/kancolle'
    confirmCloseUrls = [DMMPageUrl]
    let startTab

    // TODO: remove cases for old config keys
    if (configStore.get('kc3kai.startup.openStartPage')) {
      configStore.delete('kc3kai.startup.openStartPage')
      configStore.set('kc3kai.startup.gamePage', 'kc3')
    }
    if (configStore.get('kc3kai.startup.openDMMPage')) {
      configStore.delete('kc3kai.startup.openDMMPage')
      configStore.set('kc3kai.startup.gamePage', 'dmm')
    }

    const currentWin = this.getFocusedWindow()

    switch (configStore.get('kc3kai.startup.gamePage')) {
      case 'kc3':
        startTab = currentWin.tabs.create({ initialUrl: kc3StartPageUrl })
        break
      case 'dmm':
        startTab = currentWin.tabs.create({ initialUrl: DMMPageUrl })
        break
    }

    const kc3StratRoomUrl = 'chrome-extension://' + kc3ExtensionId + '/pages/strategy/strategy.html'
    if (configStore.get('kc3kai.startup.openStratRoom')) {
      const stratRoomTab = currentWin.tabs.create({ initialUrl: kc3StratRoomUrl })
      startTab = startTab || stratRoomTab
    }

    if (startTab) currentWin.tabs.select(startTab.id)
  }
}

//module.exports = Browser
export default Browser
