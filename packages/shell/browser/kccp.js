import path from 'path'
import fs from 'fs'
import { inspect } from 'util'
import { dialog, shell } from 'electron'

// Built-in KCCacheProxy. KCCP keeps its config in module state loaded from DATA_DIR,
// so it is required lazily, after DATA_DIR points into Damecon's userdata.

const OPTIONS = [
  'enableModder',
  'autoUpdateGitMods',
  'verifyCache',
  'bypassGadgetUpdateCheck',
  'disableBrowserCache',
]

let k
let proxy = null
let busy = ''
let stats = {}
let push = () => {}
let pendingLog = []

// KCCP logs every request; batch the lines instead of one IPC round per line
function queueLog(entry) {
  pendingLog.push(entry)
  if (pendingLog.length > 1) return
  setTimeout(() => {
    push('kccp-log', pendingLog)
    pendingLog = []
  }, 500)
}

const logEntry = ([time, source, type, ...input]) => [
  new Date(time).toLocaleTimeString(),
  source,
  type,
  input.map((x) => (typeof x === 'string' ? x : inspect(x, { depth: 2 }))).join(' '),
]

function load(dataDir) {
  if (k) return k
  process.env.DATA_DIR = dataDir
  k = {
    core: require('kccp-src/proxy.js'),
    cacher: require('kccp-src/cacher.js'),
    cacheHandler: require('kccp-src/cacheHandler.js'),
    patcher: require('kccp-src/mod/patcher.js'),
    modderUtils: require('kccp-src/mod/modderUtils.js'),
    git: require('kccp-src/mod/gitModHandler.js'),
  }
  // KCCP reports to its own window; relay log lines and stats to the settings pages instead
  k.core.logger.setMainWindow({
    isVisible: () => true,
    webContents: {
      send: (channel, payload) => {
        if (channel === 'recent')
          push('kccp-log-recent', payload.filter((e) => e[2] !== 'stats').map(logEntry))
        // request counters and cache size arrive as separate 'stats' messages
        else if (payload[2] === 'stats') stats = { ...stats, ...payload[3] }
        else queueLog(logEntry(payload))
      },
    },
  })
  return k
}

const config = () => k.core.config.getConfig()
const saveConfig = (cfg) => k.core.config.setConfig(cfg, true)
const modsDir = () => path.join(process.env.DATA_DIR, 'mods')

export function init(pushToWindows) {
  push = pushToWindows
}

export async function start({ host, port, dataDir }) {
  load(dataDir)
  stop()
  await saveConfig({
    ...config(),
    hostname: host,
    httpsPort: port,
    mode: 'https',
    socks5Enabled: false,
    checkForUpdates: false,
  })
  proxy = new k.core.Proxy()
  await proxy.init()
  await proxy.start()
  if (config().enableModder && config().autoUpdateGitMods)
    updateGitMods().catch((e) => k.core.logger.error('kccp-git', 'Auto-update failed:', e))
}

export function stop() {
  proxy?.close()
  proxy = null
}

function readMods() {
  return config().mods.map((mod, index) => {
    let info = null
    try {
      info = JSON.parse(fs.readFileSync(mod.path, 'utf8'))
    } catch {}
    return { index, path: mod.path, git: mod.git || '', info }
  })
}

export function status() {
  if (!k) return { loaded: false }
  const err = proxy?.lastStartError
  const cfg = config()
  return {
    loaded: true,
    running: !!proxy?.listening(),
    error: !err
      ? ''
      : err.code === 'EADDRINUSE'
        ? 'Port already in use'
        : String(err.message || err),
    busy,
    dataDir: process.env.DATA_DIR,
    cacheDir: k.core.config.getCacheLocation(),
    cachedFiles: Object.keys(k.cacher.getCached() || {}).length,
    stats,
    options: Object.fromEntries(OPTIONS.map((o) => [o, !!cfg[o]])),
    mods: readMods(),
  }
}

// Only one long-running task at a time; its name is shown in the UI
async function task(name, fn) {
  if (busy) throw new Error(`KCCP is busy: ${busy}`)
  busy = name
  push('kccp-status', status())
  try {
    return await fn()
  } finally {
    busy = ''
    push('kccp-status', status())
  }
}

async function confirmScripts(modPath) {
  const meta = JSON.parse(fs.readFileSync(modPath, 'utf8'))
  if (!meta.requireScripts) return true
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', 'Cancel'],
    title: 'Mod scripts',
    message: `The mod "${meta.name}" runs its own scripts. Only allow this if you trust it.`,
  })
  return response === 0
}

async function addMod(modPath, extra = {}) {
  const cfg = config()
  if (cfg.mods.some((m) => m.path === modPath)) throw new Error('This mod is already added')
  const allowScripts = await confirmScripts(modPath)
  if (!allowScripts) return false
  await saveConfig({ ...cfg, mods: [...cfg.mods, { path: modPath, allowScripts, ...extra }] })
  await k.patcher.reloadModCache()
  return true
}

function updateGitMods() {
  return task('Updating git mods', async () => {
    for (const mod of config().mods.filter((m) => m.git)) await k.git.updateMod(mod.path, mod.git)
    await k.patcher.reloadModCache()
  })
}

async function pickFile(opts) {
  const { canceled, filePaths } = await dialog.showOpenDialog(opts)
  return canceled ? null : filePaths[0]
}

export async function action(name, data = {}) {
  if (name === 'status') return status()
  if (name === 'recent-log') return k?.core.logger.sendRecent()
  if (!k) throw new Error('Built-in KCCP is not running')
  const mod = () => {
    const m = config().mods[data.index]
    if (!m) throw new Error('No such mod')
    return m
  }

  switch (name) {
    case 'set-option': {
      if (!OPTIONS.includes(data.key)) throw new Error(`Unknown option ${data.key}`)
      await saveConfig({ ...config(), [data.key]: !!data.value })
      if (data.key === 'enableModder' && data.value) await k.patcher.reloadModCache()
      return status()
    }

    // cache
    case 'open-cache-folder':
      return shell.openPath(k.core.config.getCacheLocation())
    case 'open-data-folder':
      return shell.openPath(process.env.DATA_DIR)
    case 'reload-cache':
      return k.cacher.loadCached()
    case 'verify-cache':
      return task('Verifying cache', async () => {
        const cfg = config()
        await saveConfig({ ...cfg, verifyCache: true })
        try {
          await k.cacheHandler.verifyCache(!!data.deleteInvalid)
        } finally {
          await saveConfig({ ...config(), verifyCache: cfg.verifyCache })
        }
      })
    case 'import-cache': {
      const zip = await pickFile({ filters: [{ name: 'Cache dump', extensions: ['zip'] }] })
      if (zip) await task('Importing cache', () => k.cacheHandler.mergeCache(zip))
      return
    }
    case 'preload':
      return task('Preloading assets', () => require('kccp-src/preload.js').run())

    // mods
    case 'add-mod': {
      const file = await pickFile({
        defaultPath: modsDir(),
        filters: [{ name: 'KCCP mod', extensions: ['json'] }],
      })
      if (file) await task('Adding mod', () => addMod(file))
      return status()
    }
    case 'add-git-mod':
      return task('Installing git mod', async () => {
        const url = String(data.url || '')
          .trim()
          .replace(/\/+$/, '')
        const name = url
          .split('/')
          .pop()
          .replace(/\.git$/, '')
        if (!/^https:\/\/\S+\/[\w.-]+$/.test(url) || !name || name.startsWith('.'))
          throw new Error('Enter an https:// git repository URL')
        const dir = path.join(modsDir(), name)
        if (config().mods.some((m) => m.git === url || m.path.startsWith(dir + path.sep)))
          throw new Error('This mod is already added')
        // a folder left over from a removed mod would make the clone fail
        fs.rmSync(dir, { recursive: true, force: true })
        // handleModInstallation adds the mod to the config itself
        const res = await k.git.handleModInstallation(modsDir(), url, config(), k.core.config)
        if (!res?.success)
          throw new Error(String(res?.error?.message || 'No .mod.json in repository'))
        const added = config().mods.find((m) => m.git === url)
        if (added && (await confirmScripts(added.path))) {
          added.allowScripts = true
          await saveConfig(config())
        } else if (added) {
          await saveConfig({ ...config(), mods: config().mods.filter((m) => m !== added) })
        }
        await k.patcher.reloadModCache()
        return status()
      })
    case 'update-git-mod': {
      const m = mod()
      return task('Updating git mod', async () => {
        await k.git.updateMod(m.path, m.git)
        await k.patcher.reloadModCache()
        return status()
      })
    }
    case 'update-git-mods':
      await updateGitMods()
      return status()
    case 'remove-mod': {
      const m = mod()
      await saveConfig({ ...config(), mods: config().mods.filter((x) => x !== m) })
      await k.patcher.reloadModCache()
      return status()
    }
    case 'move-mod': {
      const mods = [...config().mods]
      const to = data.index + data.offset
      if (!mods[data.index] || !mods[to]) return status()
      ;[mods[data.index], mods[to]] = [mods[to], mods[data.index]]
      await saveConfig({ ...config(), mods })
      await k.patcher.reloadModCache()
      return status()
    }
    case 'open-mod-folder':
      return shell.openPath(path.dirname(mod().path))
    case 'reload-mods':
      return task('Reloading mods', () => k.patcher.reloadModCache())
    case 'prepatch':
      return task('Pre-patching assets', () => k.patcher.prepatch())
    case 'convert-poi': {
      const source = await pickFile({ title: 'poi mod folder', properties: ['openDirectory'] })
      if (!source) return status()
      const target = path.join(modsDir(), path.basename(source))
      return task('Converting poi mod', async () => {
        await k.modderUtils.importExternalMod(source, target)
        const metaPath = `${target}.mod.json`
        if (!fs.existsSync(metaPath)) {
          const meta = { name: path.basename(source), version: '1.0.0', authors: ['poi import'] }
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        }
        if (!config().mods.some((m) => m.path === metaPath)) await addMod(metaPath)
        return status()
      })
    }
    default:
      throw new Error(`Unknown KCCP action ${name}`)
  }
}
