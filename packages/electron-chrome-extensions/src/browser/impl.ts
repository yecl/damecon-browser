/** App-specific implementation details for extensions. */
export interface ChromeExtensionImpl {
  createTab?(
    details: chrome.tabs.CreateProperties,
  ): Promise<[Electron.WebContents, Electron.BaseWindow]>
  selectTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  beforeRemoveTab?(tab: Electron.WebContents): boolean
  removeTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void

  /**
   * Populate additional details to a tab descriptor which gets passed back to
   * background pages and content scripts.
   */
  assignTabDetails?(details: chrome.tabs.Tab, tab: Electron.WebContents): void

  createWindow?(details: chrome.windows.CreateData): Promise<Electron.BaseWindow>
  beforeRemoveWindow?(window: Electron.BaseWindow): boolean
  removeWindow?(window: Electron.BaseWindow): void

  requestPermissions?(
    extension: Electron.Extension,
    permissions: chrome.permissions.Permissions,
  ): Promise<boolean>
}
