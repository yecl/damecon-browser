// Pin KC3Kai's extension ID per update channel.
//
// An unpacked extension's ID is a hash of its folder path, and KC3 keeps its data (localStorage,
// IndexedDB) under that ID. A portable data folder sits at a different path on every computer and
// system (/Volumes/<drive>/..., E:\...), so KC3 would find an empty store each time. A manifest
// `key` fixes the ID instead; each channel gets its own so their data stays separate, as before.
// Only public keys are needed; the matching private keys were never kept.

const fs = require('fs')
const path = require('path')

const KEYS = {
  // kgkoahdpkeagchfclnfehajfnjaiabpi
  release:
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAztgbAuwyyqbqBFsg1kYcjsGQP6r+fr91xSJz7NmgjGErdL58FgTYZ36K1SCsbRhZ2FKQnuRWx3ZPIBW2dwILQC+dRFvmOi2GWCqXgGb2EPPIHp0KSI1lAj7jgPliW9ujivWf7lbs5bo+0aZp7aRUcIX96nUAntR1aLbaIfQL7batiFxM9bxrtxEY6eXjpr/tYNHPtEUqn4iULT7GGBCDqeWzyv1Z5knUsqVfvgLkoRRqjSYaSFZbmBDqt4/HisfP3C+/Fm3eyqEZ/G/ciI3yA+Ve1FZ+k0I3fKta3tI9bKt+d6Ax3hApuTjpLGG/TQYjL1leEsvCnh9VaIlfZRRDsQIDAQAB',
  // mmeejfmkimhkcalaljbdflgbnpgmnpad
  master:
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5NjxgXxxcohRdO8BnG7i1Ytd0YJ4U0ngnJSFF+uneZFzSzEGXWGfU7SHRVahlJyJ9mLW1InJDNs04GJuBW658P2yUwIZJbqdsN1WLfpCJtOFxshN2QYhiQzwy6wc2y9vioILvCwlI2RXugRtSRaQtjfEj06AQ0ae2lZSTrTzTZUVNTmZNShAgYUmdO+PZa0ARw8FNv20v1Lge+6XBIRvij3II1W+OKTQGOfXhXEZV833tF9tM88zgzjcXP5a28sqUEUPBsV0yoWfI9sOpT5B1yXVHw06s5StSiJ1DjKLN8XHnitBr9DaaoU1d+ZREXHae5ZKBajbrDESEuxt6LiwpwIDAQAB',
  // jilknjhmlgmblcaaidpobcoicmhipbmd
  develop:
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmgFIH4HGOiPbscQLYc4XStMJods+lUj/Jz3azaYjpnJvFnQiVdIzYQgoZMyvKquwVbASGynegZzZ7iqzD/UaHXIorIgZ0HAYZm1w1b0kMrye4SCVaC8kSslmHPIfJBYcDiDIXWQvMowkhxieKZsRNVUbbsR0BnbNA4SyEIAczuuwwROGPOoAcdAC8vE0Nw4Bf1M6GR28+S7wwR8KMxm4VBk1qmaovBC4HF9sCnqYuRLnwI3vc6t7seFiIM1OIzoWYsIVIP5owfiwtoWQK2mdAg6nbEaCzklUMWlr+Btkl0M8Fe2V6n3Voa9PRS6ESojnSnVwFidi3F/tbQLHLLzSxQIDAQAB',
}

// Writes the channel's key into the KC3 manifest in `extensionPath`. Custom channels are the
// user's own folders and keep their path-based ID.
function pinKc3Id(extensionPath, channel) {
  const key = KEYS[channel]
  if (!key) return
  const manifestPath = path.join(extensionPath, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.key === key) return
  manifest.key = key
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

module.exports = { pinKc3Id, KEYS }
