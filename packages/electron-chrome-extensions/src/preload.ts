import { contextBridge } from 'electron'
import { injectExtensionAPIs } from './renderer'

// Only load within extension contexts; the service-worker preload also runs in websites' workers.
// Service-worker preloads run in a separate realm without `location`, so ask the worker itself.
// Skip DevTools-hosted extension frames (devtools_page/panels): since Electron 44 session preloads
// run there too, and freezing `chrome` breaks DevTools defining chrome.devtools.
const isExtensionContext =
  process.type === 'service-worker'
    ? contextBridge.executeInMainWorld({ func: () => location.protocol }) === 'chrome-extension:'
    : location.protocol === 'chrome-extension:' &&
      !Array.from(location.ancestorOrigins ?? []).some((o) => o.startsWith('devtools://'))

if (isExtensionContext) injectExtensionAPIs()
