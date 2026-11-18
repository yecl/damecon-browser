import { Menu } from 'electron'
import { t } from './i18n'

const setupMenu = (browser) => {
  const isMac = process.platform === 'darwin'

  const tab = () => browser.getFocusedWindow().getFocusedTab()
  const tabWc = () => tab().webContents

  // this menu is never actually visible but we can easily shove shortcuts here so hey
  // though realistically if we're gonna support the wider set of shortcuts
  // we probably should get away from using this
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: t('View'),
      submenu: [
        {
          label: t('Open devtools'),
          accelerator: 'F12',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        {
          label: 'Open devtools2',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        { type: 'separator' },
        // off while the window size is locked (main.js applyWindowSizeLock)
        { role: 'resetZoom', enabled: !browser.isSizeLocked() },
        { role: 'zoomIn', enabled: !browser.isSizeLocked() },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=', enabled: !browser.isSizeLocked() },
        { role: 'zoomOut', enabled: !browser.isSizeLocked() },
        { type: 'separator' },
        { role: 'togglefullscreen', enabled: !browser.isSizeLocked() },
      ],
    },
    { role: 'windowMenu' },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export default setupMenu
