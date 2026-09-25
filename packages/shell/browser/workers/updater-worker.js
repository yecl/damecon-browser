import { parentPort } from 'worker_threads'

import KC3Updater from './kc3updater.js'
import { applyProxySettings, getProxyGeneration } from './updater-utils.js'

let isKc3Updating = false
let kc3Channel
let lastFailedUpdate = null // retried when the proxy settings change

let kc3Updater = new KC3Updater()

parentPort.on('message', async (msg) => {
  console.log('updater-worker.js received message from Main', msg.type)
  // msg: { type, data }
  if (!msg?.type)
    throw new Error('Messages sent to update worker must be in the format { type, data }')

  switch (msg.type) {
    case 'get-is-kc3-updating':
      parentPort.postMessage({
        type: 'status-kc3-is-updating',
        data: { isUpdating: isKc3Updating, channel: kc3Channel },
      })
      break
    case 'do-kc3-update':
      if (!msg.data || !msg.data.path || !msg.data.channel)
        throw new Error('do-kc3-update data must be in the format { path, channel }')
      await doUpdateKc3(msg.data.path, msg.data.channel)
      break
    case 'set-proxy':
      // A running update is aborted by the change and retries itself; a failed one retries here.
      if (applyProxySettings(msg.data.proxyUrl) && !isKc3Updating && lastFailedUpdate)
        doUpdateKc3(lastFailedUpdate.extensionsPath, lastFailedUpdate.channel)
      break
    default:
      throw new Error(`Unknown message type ${msg.type}`)
  }
})

const doUpdateKc3 = async function (extensionsPath, updateChannel) {
  if (isKc3Updating) {
    parentPort.postMessage({ type: 'error-do-kc3-update', data: 'Update already in progress.' })
    return
  }
  isKc3Updating = true
  kc3Channel = updateChannel
  parentPort.postMessage({
    type: 'status-kc3-is-updating',
    data: { isUpdating: isKc3Updating, channel: kc3Channel },
  })

  let result
  try {
    while (!result) {
      const proxyGeneration = getProxyGeneration()
      try {
        await kc3Updater.update(extensionsPath, updateChannel)
        result = { ok: true }
      } catch (error) {
        if (getProxyGeneration() !== proxyGeneration) {
          console.log('Proxy settings changed during the KC3 update; restarting it.')
          continue
        }
        console.error('KC3 update failed:', error)
        result = { ok: false, error: error?.message || String(error) }
      }
    }
  } finally {
    lastFailedUpdate = result?.ok ? null : { extensionsPath, channel: updateChannel }
    isKc3Updating = false
    parentPort.postMessage({
      type: 'status-kc3-is-updating',
      data: { isUpdating: isKc3Updating, channel: kc3Channel },
    })
    parentPort.postMessage({
      type: 'kc3-update-finished',
      data: { channel: updateChannel, ...result },
    })
  }
}
