import { BrowserWindow, webContents } from 'electron'
import { EventEmitter } from 'node:events'
import { ContextMenuType } from './api/common'
import { ChromeExtensionImpl } from './impl'
import { ExtensionEvent, ExtensionSender } from './router'

export class ExtensionStore extends EventEmitter {
  /** Tabs observed by the extensions system. */
  tabs = new Set<Electron.WebContents>()

  /** Windows observed by the extensions system. */
  windows = new Set<Electron.BaseWindow>()

  lastFocusedWindowId?: number

  /**
   * Map of tabs to their parent window.
   *
   * It's not possible to access the parent of a BrowserView so we must manage
   * this ourselves.
   */
  tabToWindow = new WeakMap<Electron.WebContents, Electron.BaseWindow>()

  /** Map of windows to their active tab. */
  private windowToActiveTab = new WeakMap<Electron.BaseWindow, Electron.WebContents>()

  tabDetailsCache = new Map<number, Partial<chrome.tabs.Tab>>()
  windowDetailsCache = new Map<number, Partial<chrome.windows.Window>>()

  urlOverrides: Record<string, string> = {}

  constructor(public impl: ChromeExtensionImpl) {
    super()
  }

  getWindowById(windowId: number) {
    return Array.from(this.windows).find(
      (window) => !window.isDestroyed() && window.id === windowId,
    )
  }

  getLastFocusedWindow() {
    return this.lastFocusedWindowId ? this.getWindowById(this.lastFocusedWindowId) : null
  }

  getWindowFromWebContents(wc: ExtensionSender) {
    // https://developer.chrome.com/docs/extensions/reference/api/windows#the_current_window
    // The current window is the window that contains the code that is currently executing.
    // It's important to realize that this can be different from the topmost or focused window.
    // Windowless contexts (MV3 service worker, MV2 background page) use the last focused window.
    if (!('mainFrame' in wc) || wc.mainFrame.url.endsWith('_generated_background_page.html')) {
      const win = this.getLastFocusedWindow()
      if (!win) throw new Error('No focused window')
      return win
    }
    const window = BrowserWindow.fromWebContents(wc)
    if (!window) throw new Error("event spawned from a window that doesn't exist?")
    const result = this.getWindowById(window.id)
    if (!result) throw new Error(`Couldn't retrieve stored window data for windowId ${window.id}`)
    return result
  }

  addWindow(window: Electron.BaseWindow) {
    if (this.windows.has(window)) return

    this.windows.add(window)

    if (typeof this.lastFocusedWindowId !== 'number') {
      this.lastFocusedWindowId = window.id
    }

    this.emit('window-added', window)
  }

  async createWindow(event: ExtensionEvent, details: chrome.windows.CreateData) {
    if (typeof this.impl.createWindow !== 'function') {
      throw new Error('createWindow is not implemented')
    }

    const win = await this.impl.createWindow(details)

    this.addWindow(win)

    return win
  }

  beforeRemoveWindow(window: Electron.BaseWindow) {
    if (typeof this.impl.beforeRemoveWindow === 'function') {
      return this.impl.beforeRemoveWindow(window)
    }
    return true
  }

  async removeWindow(window: Electron.BaseWindow) {
    if (!this.windows.has(window)) return

    this.windows.delete(window)

    if (typeof this.impl.removeWindow === 'function') {
      await this.impl.removeWindow(window)
    } else {
      window.destroy()
    }
  }

  getTabById(tabId: number) {
    return Array.from(this.tabs).find((tab) => !tab.isDestroyed() && tab.id === tabId)
  }

  addTab(tab: Electron.WebContents, window: Electron.BaseWindow) {
    if (this.tabs.has(tab)) return

    this.tabs.add(tab)
    this.tabToWindow.set(tab, window)
    this.addWindow(window)

    const activeTab = this.getActiveTabFromWebContents(tab)
    if (!activeTab) {
      this.setActiveTab(tab)
    }

    this.emit('tab-added', tab)
  }

  moveTabs(tabs: Electron.WebContents[] | Electron.WebContents, index: number, windowId: number) {
    // detach tabs to be moved
    tabs = (tabs instanceof Array ? tabs : [tabs]).filter((t) => this.tabs.has(t))
    tabs.forEach(this.tabs.delete, this.tabs)

    // detach tabs after the desired index
    const windowTabsEnd = Array.from(this.tabs)
      .filter((t) => this.tabToWindow.get(t)!.id === windowId)
      .slice(index)
    windowTabsEnd.forEach(this.tabs.delete, this.tabs)

    // detach tabs after the target position
    //const end = Array.from(this.tabs).slice(index == -1 ? this.tabs.size : index)
    //end.forEach(this.tabs.delete, this.tabs)
    this.tabs = new Set([...this.tabs, ...tabs, ...windowTabsEnd])
  }

  beforeRemoveTab(tab: Electron.WebContents) {
    if (typeof this.impl.beforeRemoveTab === 'function') {
      return this.impl.beforeRemoveTab(tab)
    }
    return true
  }

  removeTab(tab: Electron.WebContents) {
    if (!this.tabs.has(tab)) return

    const tabId = tab.id
    const win = this.tabToWindow.get(tab)!

    this.tabs.delete(tab)
    this.tabToWindow.delete(tab)

    // TODO: clear active tab

    // Clear window if it has no remaining tabs
    const windowHasTabs = Array.from(this.tabs).find((tab) => this.tabToWindow.get(tab) === win)
    if (!windowHasTabs) {
      this.windows.delete(win)
    }

    if (typeof this.impl.removeTab === 'function') {
      this.impl.removeTab(tab, win)
    }

    this.emit('tab-removed', tabId)
  }

  async createTab(event: ExtensionEvent, details: chrome.tabs.CreateProperties) {
    if (typeof this.impl.createTab !== 'function') {
      throw new Error('createTab is not implemented')
    }

    // Fallback to current window
    if (!details.windowId) {
      details.windowId = this.getWindowFromWebContents(event.sender).id
    }

    const result = await this.impl.createTab(details)

    if (!Array.isArray(result)) {
      throw new Error('createTab must return an array of [tab, window]')
    }

    const [tab, window] = result

    if (typeof tab !== 'object' || !webContents.fromId(tab.id)) {
      throw new Error('createTab must return a WebContents')
    } else if (typeof window !== 'object') {
      throw new Error('createTab must return a BrowserWindow')
    }

    this.addTab(tab, window)

    return tab
  }

  getActiveTabFromWindow(win: Electron.BaseWindow) {
    const activeTab = win && !win.isDestroyed() && this.windowToActiveTab.get(win)
    return (activeTab && !activeTab.isDestroyed() && activeTab) || undefined
  }

  getActiveTabFromWebContents(wc: ExtensionSender): Electron.WebContents | undefined {
    const win =
      'mainFrame' in wc
        ? this.tabToWindow.get(wc) || BrowserWindow.fromWebContents(wc)
        : this.getLastFocusedWindow() // service worker has no window
    const activeTab = win ? this.getActiveTabFromWindow(win) : undefined
    return activeTab
  }

  setActiveTab(tab: Electron.WebContents) {
    const win = this.tabToWindow.get(tab)
    if (!win) {
      throw new Error('Active tab has no parent window')
    }

    const prevActiveTab = this.getActiveTabFromWebContents(tab)

    this.windowToActiveTab.set(win, tab)

    if (tab.id !== prevActiveTab?.id) {
      this.emit('active-tab-changed', tab, win)

      if (typeof this.impl.selectTab === 'function') {
        this.impl.selectTab(tab, win)
      }
    }
  }

  buildMenuItems(
    event: ExtensionEvent,
    extensionId: string,
    menuType: ContextMenuType,
  ): Electron.MenuItem[] {
    // This function is overwritten by ContextMenusAPI
    return []
  }

  async requestPermissions(
    extension: Electron.Extension,
    permissions: chrome.permissions.Permissions,
  ) {
    if (typeof this.impl.requestPermissions !== 'function') {
      // Default to allowed.
      return true
    }
    const result: unknown = await this.impl.requestPermissions(extension, permissions)
    return typeof result === 'boolean' ? result : false
  }
}
