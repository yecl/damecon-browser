class Settings {
  theme = ko.observable('andra')
  brightness = ko.observable('system')

  configPages = [
    {
      id: 0,
      name: 'Damecon',
      img: 'assets/icons/damecon_icon_48.png',
    },
    {
      id: 1,
      name: 'KC3Kai',
      img: 'assets/icons/kc3kai.png',
    },
    {
      id: 2,
      name: 'Proxy',
      img: 'assets/icons/kccp.png',
      //faIcon: 'fa-solid fa-circle-nodes'
    },
    {
      id: 3,
      name: 'Downloads',
      img: 'assets/icons/download_icon_48.png',
      //faIcon: 'fa-solid fa-download',
    },
  ]

  config = {}
  appTabs = { window: 0, kancolle: 1, application: 2, advanced: 4 }
  appTab = ko.observable(this.appTabs.window)

  version = ''

  selectedConfigPage = ko.observable(0)

  // This sets up the mappings between knockout properties and config keys.
  settingsInitialized = ko.observable(false)

  processes = ko.observableArray([])

  newHideAddressBarSite = ko.observable('')
  canAddNewHideAddressBarSite = ko.computed(
    () =>
      !!this.newHideAddressBarSite() &&
      (!this.config.window.view.hideAddressBarSites() ||
        !this.config.window.view.hideAddressBarSites().includes(this.newHideAddressBarSite())),
    this,
  )

  kc3IsUpdating = ko.observable(false)
  kc3UpdateError = ko.observable('')
  proxySaved = ko.observable(false)
  kc3UpdatingChannel = ko.observable('')
  canSetKc3Channel = ko.computed(() => !this.kc3IsUpdating(), this)
  canUpdateKc3 = ko.observable(true)

  downloads = ko.observableArray([])

  /*async sendMessage(type, data) {
    return await ipc.send('webui-message', { type, data })
  }*/

  async clearSessionCache() {
    await sendToMain('clear-cache')
  }

  convertPropertiesToObservables(baseObj, opts) {
    const newObj = opts?.viewModel ?? {}
    for (const key of opts?.keys ?? Object.keys(baseObj)) {
      const isFunc = typeof newObj[key] === 'function'
      if (Array.isArray(baseObj[key])) {
        const newArr = baseObj[key].map((p) => ko.observable(p))
        if (isFunc) newObj[key](newArr)
        else newObj[key] = ko.observableArray(newArr)
      } else {
        if (isFunc) newObj[key](baseObj[key])
        else newObj[key] = ko.observable(baseObj[key])
      }
      if (opts?.subscribeCallback) {
        newObj[key].subscribe(opts.subscribeCallback)
      }
    }
    return newObj
  }

  selectConfigPage(item) {
    this.selectedConfigPage(item.id)
  }

  async tryInvoke(asyncCallback, name) {
    let result
    let tries = 5
    let error
    while (!result && tries-- > 0) {
      try {
        console.log(`>> invoking ${name ?? 'action'}...`)
        result = await asyncCallback()
        console.log(`>> received`, result)
        return result
      } catch (err) {
        error = err

        console.error(
          ` >> got error while invoking ${name ?? 'action'}. ${tries > 0 ? 'retrying...' : 'giving up.'}`,
          err,
        )
      }
    }
    throw error
  }

  // loads values from the current config into ko properties
  async prepConfigProperties(newConfig) {
    if (!newConfig) newConfig = await configStore.all()
    if (!newConfig) throw new Error('Error occurred fetching config.')
    configApplySync(this.config, {
      propertyCallback: this.prepConfigProperty.bind(this),
      source: newConfig,
    })

    this.theme(this.config.window.style.theme())
    this.config.window.style.theme.subscribe((newValue) => this.theme(newValue))
    this.brightness(this.config.window.style.brightness())
    this.config.window.style.brightness.subscribe((newValue) => this.brightness(newValue))
    return this.config
  }

  setArrayItemSubscriber(observable, path) {
    observable.subscribe(async (changes) => {
      let newValue = access(this.config, path)().map(getMaybeObsValue)
      await configStore.set(path, newValue)
    })
  }

  prepConfigProperty(path, key, keySchema, target, source) {
    // do we operate on the current object or pull from the new source
    const currentSource = source || target

    // convert to observable
    //const itemsKey = `${key}_items`
    let schema = keySchema

    // capture the raw value
    let value = currentSource[key]
    if (typeof value === 'function') value = value()

    // set up array contents as observables
    if (schema.type === 'array') {
      if (!Array.isArray(value)) value = []
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'function') {
          value[i] = ko.observable(value[i])
          this.setArrayItemSubscriber(value[i], path)
        }
      }
    }

    // set up observable if it's not already set
    if (typeof target[key] !== 'function') {
      target[key] = schema.type === 'array' ? ko.observableArray(value) : ko.observable(value)
    }

    if (target[key].getSubscriptionsCount() === 0) {
      const subscriptionType = schema.type === 'array' ? 'arrayChange' : undefined
      target[key].subscribe(
        async (changes) => {
          if (!this.settingsInitialized()) return
          let newValue = access(this.config, path)()
          if (schema.type === 'array') newValue = newValue.map(getMaybeObsValue)
          const oldValue = await configStore.get(path)
          let changed = false

          console.log('>> checking: ', key)

          if (Array.isArray(newValue)) changed = !arrayObsEquals(oldValue, newValue)
          else changed = newValue != oldValue

          if (!changed) return

          console.log('>> setting changed: ', key, oldValue, newValue)

          await configStore.set(path, newValue)
          if (path == 'kc3kai.update.channel') this.setCanUpdateKc3()
        },
        this,
        subscriptionType,
      )
    }

    // update the value if needed
    if (
      (schema.type === 'array' && !arrayObsEquals(target[key](), value)) ||
      (schema.type !== 'array' && target[key]() !== value)
    )
      target[key](value)
  }

  async saveProxyConfig() {
    await configStore.set('proxy.client.host', this.config.proxy.client.host())
    await configStore.set('proxy.client.port', this.config.proxy.client.port())
    this.proxySaved(true)
    clearTimeout(this.proxySavedTimer)
    this.proxySavedTimer = setTimeout(() => this.proxySaved(false), 3000)
  }

  // updates the config from ko properties
  async saveConfig() {
    await configApply(this.config, {
      propertyCallback: async (path, config, key, keySchema) => {
        let value = config[key]
        if (Array.isArray(value)) value = value.map(getMaybeObsValue)
        await configStore.set(path, value)
      },
    })
  }

  async kc3CheckForUpdates() {
    await sendToMain('kc3-doupdate')
  }

  addNewHideAddressBarSite() {
    const site = this.newHideAddressBarSite()
    if (!this.canAddNewHideAddressBarSite()) return
    this.newHideAddressBarSite('')

    const path = 'window.view.hideAddressBarSites'
    const item = ko.observable(site)
    this.setArrayItemSubscriber(item, path)

    this.config.window.view.hideAddressBarSites.push(item)
  }
  removeHideAddressBarSite(value) {
    const actualValue = this.config.window.view.hideAddressBarSites().find((v) => v() === value)
    this.config.window.view.hideAddressBarSites.remove(actualValue)
  }

  addNewProcess(data) {
    const p = {
      name: data.name,
      phase: ko.observable(''),
      current: ko.observable(0),
      total: ko.observable(0),
      type: ko.observable('steps'),
    }
    p.progressPct = ko.computed(() => {
      return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(
        (p.current() / p.total()) * 100,
      )
    })
    p.progress = ko.computed(() => {
      if (p.total() <= 0 || !p.total()) return ''

      const current = p.type() === 'bytes' ? this.friendlySize(p.current()) : p.current()
      const total = p.type() === 'bytes' ? this.friendlySize(p.total()) : p.total()

      return `${current}/${total} (${p.progressPct()}%)`
    })
    this.processes.push(p)
  }

  async getCustomKc3Path() {
    const channel = this.config.kc3kai.update.channel()
    if (!channel.startsWith('custom')) {
      console.error('Custom kc3 channel not selected.')
      return
    }
    const result = await sendToMain('kc3-select-custom-location', {
      defaultPath: this.config.kc3kai[`${channel}Location`](),
    })
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected kc3 path', path)

    if (channel === 'custom1') this.config.kc3kai.custom1Location(path)
    else if (channel === 'custom2') this.config.kc3kai.custom2Location(path)
    else console.error('Unknown custom kc3 channel', channel)
  }

  async getCustomDataPath() {
    const loc = this.config.app.data.location()
    if (loc != 'custom') {
      console.error('Custom data location not selected.')
      return
    }
    const result = await sendToMain('select-custom-data-location', {
      defaultPath: this.config.app.data.customPath(),
    })
    if (result.canceled || !result.filePaths.length) return
    const path = result.filePaths[0]
    console.log('Selected data path', path)

    this.config.app.data.customPath(path)
  }

  friendlySize(bytes, decimals = 2) {
    let received = bytes
    if (received < 1024) return `${received}bytes`
    received = (bytes / 1024).toFixed(decimals)
    if (received < 1024) return `${received}KB`
    received = (bytes / Math.pow(1024, 2)).toFixed(decimals)
    if (received < 1024) return `${received}MB`
    received = (bytes / Math.pow(1024, 3)).toFixed(decimals)
    return `${received}GB`
  }

  prepDownload(item) {
    const dl = this.convertPropertiesToObservables(item)
    dl.file = ko.pureComputed(() => {
      const split = (dl.filename() || dl.url()).split(/\\|\//)
      return split[split.length - 1]
    })
    if (!dl.endTime) dl.endTime = ko.observable()
    if (!dl.estimatedEndTime) dl.estimatedEndTime = ko.observable()

    dl.received = ko.pureComputed(() => this.friendlySize(dl.bytesReceived()))
    dl.total = ko.pureComputed(() => this.friendlySize(dl.totalBytes()))
    dl.progressPct = ko.pureComputed(() =>
      dl.totalBytes() > 0 && dl.bytesReceived() >= 0
        ? dl.bytesReceived() / dl.totalBytes()
        : undefined,
    )

    dl.open = () => chrome.downloads.open(dl.id())
    dl.openFolder = () => chrome.downloads.show(dl.id())
    dl.pause = () => chrome.downloads.pause(dl.id())
    dl.resume = () => chrome.downloads.resume(dl.id())
    dl.deleteFile = () => chrome.downloads.removeFile(dl.id())
    dl.erase = () => chrome.downloads.erase({ id: dl.id() })
    return dl
  }

  async receiveFromMain(msg) {
    switch (msg.type) {
      case 'status-kc3-is-updating':
        this.kc3IsUpdating(msg.data.isUpdating)
        this.kc3UpdatingChannel(msg.data.channel)
        if (msg.data.isUpdating) this.kc3UpdateError('')
        break
      case 'error-do-kc3-update':
        this.kc3UpdateError(String(msg.data))
        break
      case 'update-process-started':
        console.log('process started', msg.data.name)
        this.addNewProcess(msg.data)
        break
      case 'update-process-progress':
        const processToUpdate = this.processes().find((p) => p.name == msg.data.name)
        if (!processToUpdate) {
          this.addNewProcess(msg.data)
        }
        processToUpdate.phase(msg.data.phase)
        processToUpdate.type(msg.data.type)
        processToUpdate.total(msg.data.total)
        processToUpdate.current(msg.data.current)
        break
      case 'update-process-completed':
        console.log('process completed', msg.data.name)
        const processToRemove = this.processes().find((p) => p.name == msg.data.name)
        this.processes.remove(processToRemove)
        break
      case 'config-saved':
        await this.prepConfigProperties(msg.data)
        break
      default:
        throw new Error(`Unknown message type ${msg.type || '(none)'}`)
    }
  }

  addBrowserListeners() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      ;(async () => {
        // windows/tabs getCurrent methods are super unreliable

        const myWindowId = (await chrome.windows.getCurrent()).id
        if (!msg.meta.allWindows && msg.meta.windowId !== myWindowId) {
          console.log('Ignoring message for other window', msg.meta.windowId)
          return
        }
        if (!msg.meta.allWindows && !msg.meta.allTabs && msg.meta.tabId !== this.tabId) {
          console.log('Ignoring message for other tab', msg.meta.tabId)
          return
        } //*/
        let result
        try {
          await this.receiveFromMain(msg)
          //sendResponse({ result, complete: true })
        } catch (error) {
          //sendResponse({ error, complete: false })
        }
      })()
      //return true
    })

    chrome.downloads.onCreated.addListener((item) => this.downloads.push(this.prepDownload(item)))
    chrome.downloads.onChanged.addListener(async (downloadId, delta) => {
      const existing = this.downloads().find((d) => d.id() == delta.id)
      if (!existing) {
        console.error('received update for untracked download', delta)
        return
      }
      const results = await chrome.downloads.search({ id: delta.id })
      if (!results.length) {
        console.error(
          'received update for download but downloads api returned no results for its ID.',
          delta,
        )
        return
      }
      const dl = results[0]
      for (const key of Object.keys(dl)) {
        if (key == 'id') continue
        try {
          existing[key](dl[key])
        } catch (error) {
          console.error(error)
        }
      }
    })
    chrome.downloads.onErased.addListener((downloadId) => {
      const dl = this.downloads().find((d) => d.id() == downloadId)
      if (!dl) return
      this.downloads.remove(dl)
    })
  }

  async clearFinishedDownloads() {
    await chrome.downloads.erase({ state: 'complete' })
    await chrome.downloads.erase({ state: 'interrupted' })
  }

  setCanUpdateKc3() {
    this.canUpdateKc3(!this.kc3IsUpdating() && !!this.config?.kc3kai?.update.channel())
  }

  compareVersions(a, b) {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0
      const nb = pb[i] || 0
      if (na !== nb) return na > nb ? 1 : -1
    }
    return 0
  }

  constructor() {
    this.init()
  }
  async init() {
    setMessageSource('settings')
    const appInfo = await this.tryInvoke(
      async () => await sendToMain('get-damecon-info', {}),
      'get-damecon-info',
    )
    this.paths = appInfo.paths
    this.version = appInfo.version
    await this.prepConfigProperties()
    console.log('done prepping config', this.config)
    this.settingsInitialized(true)

    const cfgVer = this.config.version()
    if (!cfgVer || this.compareVersions(cfgVer, '0.10.0') < 0) {
      console.log('Adding new game page URL')
      const newGamePageUrl = 'https://play.games.dmm.com/game/kancolle'
      const sites = vm.config.window.view.hideAddressBarSites()
      if (!sites.includes(newGamePageUrl)) {
        this.newHideAddressBarSite(newGamePageUrl)
        this.addNewHideAddressBarSite()
      }
    }

    const downloads = await chrome.downloads.search({})
    downloads.forEach((d) => this.downloads.push(this.prepDownload(d)))

    //this doesn't work lol
    //this.tabId = await chrome.tabs.getCurrent()

    this.addBrowserListeners()

    const kc3UpdateStatus = await sendToMain('kc3-get-isupdating')
    this.kc3IsUpdating.subscribe((newValue) => this.setCanUpdateKc3())
    this.kc3IsUpdating(kc3UpdateStatus.isUpdating)
    this.kc3UpdatingChannel(kc3UpdateStatus.channel)

    this.config.version(this.version.split(' v')[1])
  }
}
window.vm = new Settings()
$(document).ready(() => ko.applyBindings(window.vm))
