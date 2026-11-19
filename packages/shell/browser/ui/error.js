// Shown in a tab whose page failed to load or whose renderer crashed (main.js handlePageFailures).
// ?kind=load|crash&url=<the page>&detail=<Chromium's error or the crash reason>
// &proxy=proxy|kccp&address=<host:port> when it was the proxy that couldn't be reached
const params = new URLSearchParams(location.search)
const url = params.get('url') || ''
const crashed = params.get('kind') === 'crash'
const proxy = params.get('proxy')
const address = params.get('address')

// the settings page each proxy is set on (settings.js configPages)
const SETTINGS_PAGES = { proxy: 2, kccp: 4 }

i18n.ready.then(() => {
  const heading = t(
    crashed
      ? 'This page crashed'
      : proxy === 'kccp'
        ? "Can't connect to KCCP"
        : proxy
          ? "Can't connect to the proxy"
          : "This page couldn't load",
  )
  document.title = heading
  document.getElementById('heading').textContent = heading
  document.getElementById('message').textContent = crashed
    ? t('Its process stopped unexpectedly. Reload to open it again.')
    : proxy === 'kccp'
      ? t("KCCP at {address} isn't responding. Check that it is running, then reload.", { address })
      : proxy
        ? t(
            "The proxy server at {address} isn't responding. Check that it is running, then reload.",
            { address },
          )
        : t('Check your connection and the proxy settings, then reload.')
  if (proxy) {
    const settings = document.getElementById('open-settings')
    settings.textContent = t(proxy === 'kccp' ? 'KCCP settings' : 'Proxy settings')
    settings.hidden = false
    settings.addEventListener('click', () => {
      localStorage.setItem('damecon-settings-page', SETTINGS_PAGES[proxy])
      ipc.send('webui-message', { type: 'open-settings' })
    })
  }
})
document.getElementById('detail').textContent = [url, params.get('detail')]
  .filter(Boolean)
  .join(' — ')

// main loads it: this page can't send the tab to another extension's page (KC3's game page), and
// main also drops this page from the history, so Back goes to the one before the failure
const reload = () => url && ipc.send('webui-message', { type: 'reload-failed-page' }, { url })
document.getElementById('reload').addEventListener('click', reload)
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') reload()
})
