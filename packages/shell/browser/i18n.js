import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// The main process's half of ui/i18n.js: dialogs and menus, from the same dictionaries
// (ui/locales/<language>.json, keyed by the English text).
const LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ja']
let strings = {}

function resolveLanguage(setting) {
  if (LANGUAGES.includes(setting)) return setting
  for (const lang of app.getPreferredSystemLanguages()) {
    if (/^zh-(TW|HK|MO|Hant)/i.test(lang)) return 'zh-TW'
    if (/^zh/i.test(lang)) return 'zh-CN'
    if (/^ja/i.test(lang)) return 'ja'
    if (/^en/i.test(lang)) return 'en'
  }
  return 'en'
}

// setting: config app.language, 'system' or a language
export function setLanguage(uiDir, setting) {
  const lang = resolveLanguage(setting)
  try {
    strings =
      lang === 'en'
        ? {}
        : JSON.parse(fs.readFileSync(path.join(uiDir, 'locales', `${lang}.json`), 'utf8'))
  } catch (error) {
    console.error('i18n: no strings for', lang, error)
    strings = {}
  }
}

export const t = (text, vars = {}) =>
  (strings[text] ?? text).replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m)
