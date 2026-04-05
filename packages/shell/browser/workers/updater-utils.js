import { parentPort } from 'worker_threads'
import { Readable } from 'stream'
import https from 'https'
import http from 'http'
import HttpsProxyAgent from 'https-proxy-agent'
import SocksProxyAgent from 'socks-proxy-agent'

let proxyUrl = null

function applyProxySettings(url) {
  proxyUrl = url
  console.log('Worker proxy set to:', proxyUrl)
}

function getProxyUrl() {
  return proxyUrl
}

function getProxyAgent() {
  if (!proxyUrl) return undefined
  if (proxyUrl.startsWith('socks')) return new SocksProxyAgent(proxyUrl)
  return new HttpsProxyAgent(proxyUrl)
}

const onUpdateStarted = function (name) {
  parentPort.postMessage({ type: 'update-process-started', data: { name } })
}
const onUpdateProgress = function (name, phase, current, total, type) {
  parentPort.postMessage({
    type: 'update-process-progress',
    data: { name, phase, current, total, type },
  })
}
const onUpdateCompleted = function (name) {
  parentPort.postMessage({ type: 'update-process-completed', data: { name } })
}

const proxyFetch = function (url) {
  return new Promise((resolve, reject) => {
    const mod = new URL(url).protocol === 'https:' ? https : http
    const options = {}
    const agent = getProxyAgent()
    if (agent) options.agent = agent

    const req = mod.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(proxyFetch(res.headers.location))
      }
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: { get: (name) => res.headers[name.toLowerCase()] },
        body: res,
        async json() {
          const chunks = []
          for await (const chunk of res) chunks.push(chunk)
          return JSON.parse(Buffer.concat(chunks).toString())
        },
      })
    })
    req.on('error', reject)
  })
}

const fetchWithProgress = async function (url, onProgress) {
  const res = await proxyFetch(url)

  if (!res.ok) {
    throw new Error({
      message: `Failed to fetch ${url}: ${res.status} ${res.statusText}`,
      status: res.status,
    })
  }

  const totalSize = Number(res.headers.get('content-length')) || 0

  let downloaded = 0

  const readable = res.body
  readable.on('data', (chunk) => {
    downloaded += chunk.length
    if (totalSize) {
      const pct = ((downloaded / totalSize) * 100).toFixed(2)
      onProgress(downloaded, totalSize, pct)
    } else {
      onProgress(downloaded, 0, null)
    }
  })

  return readable
}

export { applyProxySettings, getProxyUrl, getProxyAgent, proxyFetch }
export { onUpdateStarted, onUpdateProgress, onUpdateCompleted, fetchWithProgress }
