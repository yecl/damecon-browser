// Translates Damecon's own pages into the chosen language (Settings → Damecon → Language).
//
// Strings are keyed by their English text, in locales/<language>.json. Text nodes and the title,
// placeholder and aria-label attributes are looked up as they appear, including what knockout
// renders later. Elements marked translate="no" (tab titles, file names, logs) are left alone; an
// element marked data-i18n="whole" is translated as one string with its markup, so a sentence
// around <code> keeps its word order in every language. Text built from values goes through
// t('{n} files', { n }).
;(() => {
  const LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ja']
  const ATTRIBUTES = ['title', 'placeholder', 'aria-label']
  const STORE = 'damecon-language'
  // the dictionaries sit next to this script, whatever page loads it
  const base = document.currentScript.src

  // a setting ('system' or a language) to a language with a dictionary
  const resolve = (setting) => {
    if (LANGUAGES.includes(setting)) return setting
    for (const lang of navigator.languages) {
      if (/^zh-(TW|HK|MO|Hant)/i.test(lang)) return 'zh-TW'
      if (/^zh/i.test(lang)) return 'zh-CN'
      if (/^ja/i.test(lang)) return 'ja'
      if (/^en/i.test(lang)) return 'en'
    }
    return 'en'
  }

  const normalize = (text) => text.replace(/\s+/g, ' ').trim()
  let language = resolve(localStorage.getItem(STORE) || 'system')
  let strings = {}
  const lookup = (text) => strings[normalize(text)]

  // what each node or attribute said in English, and what it was last set to
  const sources = new WeakMap()
  // as in HTML, the nearest translate attribute decides (an option can opt back in)
  const skipped = (el) =>
    !!el?.closest?.('code, script, style, textarea') ||
    el?.closest?.('[translate]')?.getAttribute('translate') === 'no'

  function translateText(node) {
    if (skipped(node.parentElement) || node.parentElement?.closest('[data-i18n="whole"]')) return
    const seen = sources.get(node)
    const source = seen && node.data === seen.shown ? seen.source : node.data
    if (!/[A-Za-z]/.test(source)) return
    const translated = lookup(source)
    const shown = translated
      ? source.match(/^\s*/)[0] + translated + source.match(/\s*$/)[0]
      : source
    sources.set(node, { source, shown })
    if (node.data !== shown) node.data = shown
  }

  function translateElement(el) {
    if (skipped(el)) return
    let map = sources.get(el)
    if (!map) sources.set(el, (map = {}))
    if (el.dataset?.i18n === 'whole') {
      const seen = map.html
      const source = seen && el.innerHTML === seen.shown ? seen.source : el.innerHTML
      const shown = lookup(source) ?? source
      map.html = { source, shown }
      if (el.innerHTML !== shown) el.innerHTML = shown
    }
    for (const attr of ATTRIBUTES) {
      const value = el.getAttribute?.(attr)
      if (!value) continue
      const seen = map[attr]
      const source = seen && value === seen.shown ? seen.source : value
      const shown = lookup(source) ?? source
      map[attr] = { source, shown }
      if (value !== shown) el.setAttribute(attr, shown)
    }
  }

  function translate(root) {
    if (root.nodeType === Node.TEXT_NODE) return translateText(root)
    if (root.nodeType !== Node.ELEMENT_NODE) return
    translateElement(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      node.nodeType === Node.TEXT_NODE ? translateText(node) : translateElement(node)
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(translate)
      else if (r.type === 'characterData') translateText(r.target)
      else translateElement(r.target)
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributeFilter: ATTRIBUTES,
  })

  // re-evaluates knockout bindings that call t() when the language changes
  const version = window.ko ? ko.observable(0) : null

  async function load(lang) {
    // hidden until translated, rather than flashing the English first
    if (lang !== 'en') document.documentElement.style.visibility = 'hidden'
    try {
      strings =
        lang === 'en' ? {} : await (await fetch(new URL(`locales/${lang}.json`, base))).json()
    } catch (error) {
      console.error('i18n: no strings for', lang, error)
      strings = {}
    }
    document.documentElement.lang = lang
    translate(document.documentElement)
    version?.(version() + 1)
    document.documentElement.style.visibility = ''
  }

  window.i18n = {
    // a setting from the config ('system' or a language); pages without the config use the last one
    setLanguage(setting) {
      localStorage.setItem(STORE, setting)
      const next = resolve(setting)
      if (next !== language) load((language = next))
    },
    ready: load(language),
  }
  window.t = (text, vars = {}) => {
    version?.()
    return (lookup(text) ?? text).replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m)
  }
})()
