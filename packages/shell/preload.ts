import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { injectIpc } from './preload-ipc.js'
import { contextBridge, ipcRenderer } from 'electron'

console.log('Trying to inject into', location.pathname)
// Inject <browser-action-list> element into WebUI
const localPages = [
  '/new-tab.html',
  '/settings.html',
  '/_generated_background_page.html',
  '/webui.html',
  '/search.html',
  '/auth.html',
  '/error.html',
]
if (location.protocol === 'chrome-extension:' && localPages.includes(location.pathname)) {
  console.log('Successfully injected into', location.pathname)
  injectBrowserAction()
  injectIpc()
}

// Mouse side buttons go back/forward like in Chrome; Electron leaves them to the page
addEventListener(
  'mouseup',
  (e) => {
    if (e.button === 3 || e.button === 4)
      ipcRenderer.send('mouse-navigate', e.button === 3 ? -1 : 1)
  },
  true,
)
