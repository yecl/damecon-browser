// Shown in a tab whose page failed to load or whose renderer crashed (main.js showErrorPage).
// ?kind=load|crash&url=<the page>&detail=<Chromium's error or the crash reason>
const params = new URLSearchParams(location.search)
const url = params.get('url') || ''
const crashed = params.get('kind') === 'crash'

i18n.ready.then(() => {
  const heading = t(crashed ? 'This page crashed' : "This page couldn't load")
  document.title = heading
  document.getElementById('heading').textContent = heading
  document.getElementById('message').textContent = t(
    crashed
      ? 'Its process stopped unexpectedly. Reload to open it again.'
      : 'Check your connection and the proxy settings, then reload.',
  )
})
document.getElementById('detail').textContent = [url, params.get('detail')]
  .filter(Boolean)
  .join(' — ')

// replace, so Back skips this page and goes to the one before the failure
const reload = () => url && location.replace(url)
document.getElementById('reload').addEventListener('click', reload)
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') reload()
})
