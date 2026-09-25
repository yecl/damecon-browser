import { parentPort } from 'worker_threads'
import { Readable } from 'stream'
import https from 'https'
import http from 'http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

const TIMEOUT_MS = 20000 // no response / no data for this long fails the request

let proxyUrl = null
let proxyGeneration = 0
const activeRequests = new Set()

// Returns whether the proxy changed. Requests still going through the old route are aborted,
// so an update stuck on an unreachable network can restart with the new settings right away.
function applyProxySettings(url) {
  url = url || null
  if (url === proxyUrl) return false
  proxyUrl = url
  proxyGeneration++
  console.log('Worker proxy set to:', proxyUrl)
  for (const req of activeRequests) req.destroy(new Error('Proxy settings changed'))
  return true
}

function getProxyUrl() {
  return proxyUrl
}

function getProxyGeneration() {
  return proxyGeneration
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

// HTTP(S) request through the configured proxy, following redirects. Resolves with the response.
const request = function (url, { method = 'GET', headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const mod = new URL(url).protocol === 'https:' ? https : http
    const req = mod.request(url, { method, headers, agent: getProxyAgent() }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).href
        return resolve(request(next, { method, headers, body }))
      }
      resolve(res)
    })
    activeRequests.add(req)
    // req.setTimeout only counts once connected, so a hanging connect needs its own timer
    const timer = setTimeout(
      () => req.destroy(new Error(`No response within ${TIMEOUT_MS / 1000}s: ${url}`)),
      TIMEOUT_MS,
    )
    req.on('response', () => clearTimeout(timer))
    req.on('close', () => {
      clearTimeout(timer)
      activeRequests.delete(req)
    })
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Connection stalled: ${url}`)))
    req.on('error', reject)
    req.end(body)
  })
}

const proxyFetch = async function (url) {
  const res = await request(url)
  return {
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
  }
}

// isomorphic-git http client with the same proxy, timeouts and abort-on-proxy-change.
const gitHttp = {
  async request({ url, method = 'GET', headers = {}, body }) {
    let data
    if (body) {
      const chunks = []
      for await (const chunk of body) chunks.push(chunk)
      data = Buffer.concat(chunks)
    }
    const res = await request(url, { method, headers, body: data })
    return {
      url,
      method,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      headers: res.headers,
      body: res,
    }
  },
}

const fetchWithProgress = async function (url, onProgress) {
  const res = await proxyFetch(url)

  if (!res.ok) {
    res.body.resume()
    throw Object.assign(new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`), {
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

export { applyProxySettings, getProxyUrl, getProxyGeneration, getProxyAgent, proxyFetch, gitHttp }
export { onUpdateStarted, onUpdateProgress, onUpdateCompleted, fetchWithProgress }
