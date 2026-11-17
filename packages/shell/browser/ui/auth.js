// The prompt for a site's HTTP authentication (main.js promptLogin).
// ?id=<prompt>&origin=<site asking>&realm=<the site's name for what it protects>
const params = new URLSearchParams(location.search)
const id = Number(params.get('id'))
const realm = params.get('realm')
// the origin in full, so a site can't pass itself off as another
i18n.ready.then(() => {
  const origin = params.get('origin')
  document.getElementById('site').textContent = realm
    ? t('{origin} asks you to sign in to “{realm}”.', { origin, realm })
    : t('{origin} asks you to sign in.', { origin })
})

const answer = (data) => ipc.send('webui-message', { type: 'auth-response' }, { id, ...data })
document.getElementById('root').addEventListener('submit', (ev) => {
  ev.preventDefault()
  answer({
    username: document.getElementById('username').value,
    password: document.getElementById('password').value,
  })
})
const cancel = () => answer({ cancel: true })
document.getElementById('cancel').addEventListener('click', cancel)
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') cancel()
})
