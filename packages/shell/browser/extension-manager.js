import path from 'path'
import fs from 'fs'
import { dialog, nativeImage, shell } from 'electron'

const { loadAllExtensions, uninstallExtension } = require('electron-chrome-web-store')

// Extensions come from two folders: the web store's (<id>/<version>) and the local `extensions`
// folder (unpacked). Across restarts and data folder moves, one is known by its folder and the top
// directory it sits in. Disabled ones are listed in a file in the data folder and not loaded.
//
// managed: ids of extensions this page leaves alone (the webui, KC3Kai)
export function createExtensionManager({ session, roots, dataPath, managed }) {
  const disabledFile = path.join(dataPath, 'disabled-extensions.json')

  const readDisabled = () => {
    try {
      return JSON.parse(fs.readFileSync(disabledFile, 'utf8'))
    } catch {
      return []
    }
  }
  const writeDisabled = (list) => fs.writeFileSync(disabledFile, JSON.stringify(list, null, 2))

  // "<root>:<top directory>", or null for an extension outside both folders (the webui)
  const keyOf = (extPath) => {
    for (const [root, dir] of Object.entries(roots)) {
      const rel = path.relative(dir, extPath)
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
        return `${root}:${rel.split(path.sep)[0]}`
    }
    return null
  }
  const isDisabled = (extPath) => readDisabled().some((d) => d.key === keyOf(extPath))

  // the manifest's icon closest to 48px, as a data URL the settings page can show
  const iconOf = (ext) => {
    const icons = Object.entries(ext.manifest.icons || {})
    if (!icons.length) return ''
    const [, file] = icons.sort(([a], [b]) => Math.abs(a - 48) - Math.abs(b - 48))[0]
    return nativeImage.createFromPath(path.join(ext.path, file)).resize({ width: 48 }).toDataURL()
  }

  const loaded = () => session.extensions.getAllExtensions().filter((ext) => keyOf(ext.path))

  // Load the extensions under a folder that `accept` allows, skipping disabled ones, or only the
  // one with `key`; KC3Kai (kc3kai-*) is loaded by main. loadAllExtensions starts MV3 workers.
  const load = (root, { key, accept = () => true } = {}) =>
    loadAllExtensions(session, roots[root], {
      allowUnpacked: root === 'local',
      filterRegex: /^(?!kc3kai)/,
      filterCallback: (ext) =>
        key ? keyOf(ext.path) === key : !isDisabled(ext.path) && accept(ext),
    })

  async function list() {
    const enabled = loaded().map((ext) => ({
      key: keyOf(ext.path),
      name: ext.name,
      version: ext.version,
      icon: iconOf(ext),
      enabled: true,
      managed: managed().includes(ext.id),
    }))
    const disabled = readDisabled().map((d) => ({ ...d, enabled: false, managed: false }))
    return [...enabled, ...disabled].sort((a, b) => a.name.localeCompare(b.name))
  }

  async function setEnabled(key, enabled) {
    if (enabled) {
      writeDisabled(readDisabled().filter((d) => d.key !== key))
      return load(key.split(':')[0], { key })
    }
    const ext = loaded().find((e) => keyOf(e.path) === key)
    if (!ext || managed().includes(ext.id)) return
    writeDisabled([
      ...readDisabled(),
      { key, name: ext.name, version: ext.version, icon: iconOf(ext) },
    ])
    session.extensions.removeExtension(ext.id)
  }

  async function remove(key, window) {
    const [root, dir] = key.split(':')
    const ext = loaded().find((e) => keyOf(e.path) === key)
    if (ext && managed().includes(ext.id)) return
    const name = ext?.name || readDisabled().find((d) => d.key === key)?.name || dir
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      message: `Remove “${name}”?`,
      detail: 'Its files and data are deleted.',
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) return
    if (root === 'store') {
      // a web store extension's top directory is its id
      await uninstallExtension(dir, { session, extensionsPath: roots.store })
    } else {
      if (ext) session.extensions.removeExtension(ext.id)
      await fs.promises.rm(path.join(roots.local, dir), { recursive: true, force: true })
    }
    writeDisabled(readDisabled().filter((d) => d.key !== key))
  }

  return {
    load,
    action: async (name, data, window) => {
      switch (name) {
        case 'list':
          return list()
        case 'set-enabled':
          return setEnabled(data.key, data.enabled)
        case 'remove':
          return remove(data.key, window)
        case 'open-folder':
          fs.mkdirSync(roots.local, { recursive: true })
          return shell.openPath(roots.local)
        default:
          throw new Error(`Unknown extensions action ${name}`)
      }
    },
  }
}
