import { app, WebContentsView } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ExtensionContext } from './context'

// Electron's extension loader never enables the static rulesets an extension declares with
// `"enabled": true` in declarative_net_request.rule_resources; Chrome does that at install.
// The rule engine itself works, so enable them from the extension's own origin. Each ruleset
// id is handled once: after that Chromium persists the enabled set, including changes the
// extension makes itself, and this never disables anything.

type RulesetState = Record<string, string[]> // extension id -> ruleset ids already handled

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ])

async function enableRulesets(ctx: ExtensionContext, extension: Electron.Extension, ids: string[]) {
  // Not attached to a window, so creating and closing it has no window side effects.
  const view = new WebContentsView({ webPreferences: { session: ctx.session } })
  try {
    // Any document from the extension's origin gets its chrome.declarativeNetRequest.
    await withTimeout(view.webContents.loadURL(`${extension.url}manifest.json`), 10000)
    await withTimeout(
      view.webContents.executeJavaScript(
        `chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ${JSON.stringify(ids)} })`,
      ),
      10000,
    )
  } finally {
    view.webContents.close()
  }
}

export function initStaticRulesets(ctx: ExtensionContext) {
  const file = path.join(ctx.session.storagePath!, 'ece-dnr-rulesets.json')
  let state: RulesetState = {}
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}
  } catch {}

  // Written on a clean quit only: Chromium saves the enabled rulesets lazily, so after a crash
  // the ids count as unhandled and get enabled again.
  let dirty = false
  app.once('will-quit', () => {
    if (dirty) fs.writeFileSync(file, JSON.stringify(state))
  })

  const init = async (extension: Electron.Extension) => {
    const resources = (extension.manifest as chrome.runtime.ManifestV3).declarative_net_request
      ?.rule_resources
    if (!Array.isArray(resources)) return
    const known = Array.isArray(state[extension.id]) ? state[extension.id] : []
    const enable = resources.filter((r) => r.enabled && !known.includes(r.id)).map((r) => r.id)
    if (enable.length > 0) await enableRulesets(ctx, extension, enable)
    if (resources.some((r) => !known.includes(r.id))) {
      state[extension.id] = resources.map((r) => r.id)
      dirty = true
    }
  }

  let queue = Promise.resolve() // one at a time
  const enqueue = (extension: Electron.Extension) => {
    queue = queue
      .then(() => init(extension))
      .catch((error) =>
        console.error(
          `Failed to enable declarativeNetRequest rulesets for ${extension.id}:`,
          error,
        ),
      )
  }

  const sessionExtensions = ctx.session.extensions || ctx.session
  sessionExtensions.getAllExtensions().forEach(enqueue)
  sessionExtensions.on('extension-ready', (_event, extension) => enqueue(extension))
  sessionExtensions.on('extension-unloaded', (_event, extension) => {
    // Uninstalled: a reinstall starts from the manifest defaults again, as in Chrome.
    if (state[extension.id] && !fs.existsSync(extension.path)) {
      delete state[extension.id]
      dirty = true
    }
  })
}
