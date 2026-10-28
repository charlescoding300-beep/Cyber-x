'use strict'

// Shared KnightBot API client. The public docs show GET endpoints that return
// { success: true, result: { download: "/files/..." } } and accept X-API-Key.
const axios = require('axios')

const env = (name, fallback) => String(process.env[name] || fallback || '').trim()
const baseUrl = () => env('KNIGHT_API_BASE', 'https://knightbotapi.stream').replace(/\/+$/, '')
const apiKey = () => env('KNIGHT_API_KEY', 'knight')

const ROUTES = {
  video: () => ({ path: env('KNIGHT_VIDEO_PATH', '/api/download/ytmp4'), param: env('KNIGHT_VIDEO_PARAM', 'url') }),
  audio: () => ({ path: env('KNIGHT_AUDIO_PATH', '/api/download/ytaudio'), param: 'url' }),
  spotify: () => ({ path: env('KNIGHT_SPOTIFY_PATH', '/api/spotify'), param: env('KNIGHT_SPOTIFY_PARAM', 'url') }),
  lyrics: () => ({ path: env('KNIGHT_LYRICS_PATH', '/api/lyrics'), param: env('KNIGHT_LYRICS_PARAM', 'query') }),
}

function routeUrl(path) {
  if (!path.startsWith('/api/')) throw new Error('Knight API paths must start with /api/')
  return new URL(path, `${baseUrl()}/`).toString()
}

async function getJson(path, params, { timeout = 30000, signal } = {}) {
  const key = apiKey()
  if (!key) throw new Error('KNIGHT_API_KEY is empty')
  let response
  try {
    response = await axios.get(routeUrl(path), {
      params,
      timeout,
      signal,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        'User-Agent': 'ZENX-Bot/1.0',
      },
    })
  } catch (error) {
    const status = error.response?.status
    const reason = status ? `HTTP ${status}` : (error.code || error.message || 'request failed')
    throw new Error(`Knight API request failed (${reason})`)
  }

  const body = response?.data
  if (!body || typeof body !== 'object') throw new Error('Knight API returned invalid JSON')
  if (body.success === false || body.status === false) {
    const reason = body.message || body.error || body.result?.message || 'request was rejected'
    throw new Error(`Knight API: ${String(reason).replace(/[\r\n]+/g, ' ').slice(0, 160)}`)
  }
  return body
}

function isDownloadCandidate(value, input) {
  if (typeof value !== 'string' || !value.trim()) return false
  const candidate = value.trim()
  if (candidate === input) return false
  return /^https?:\/\//i.test(candidate) || /^\/?files\//i.test(candidate)
}

function findDownload(body, input) {
  const preferred = ['download', 'download_url', 'downloadUrl', 'downloadURL', 'fileUrl', 'file_url', 'mediaUrl', 'media_url', 'mp4', 'mp3', 'audio', 'video', 'url', 'link', 'file']
  const seen = new Set()
  const visit = (node, depth = 0) => {
    if (!node || depth > 6 || typeof node !== 'object') return null
    if (seen.has(node)) return null
    seen.add(node)
    for (const key of preferred) {
      const value = node[key]
      if (isDownloadCandidate(value, input)) return value.trim()
      if (value && typeof value === 'object') {
        const nested = visit(value, depth + 1)
        if (nested) return nested
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (/thumb|image|cover|poster|avatar|original|source/i.test(key)) continue
      if (isDownloadCandidate(value, input)) return value.trim()
      if (value && typeof value === 'object') {
        const nested = visit(value, depth + 1)
        if (nested) return nested
      }
    }
    return null
  }
  const found = visit(body)
  if (!found) return null
  try { return new URL(found, `${baseUrl()}/`).toString() } catch { return null }
}

function getResult(body) {
  return body?.result && typeof body.result === 'object'
    ? body.result
    : body?.data && typeof body.data === 'object'
      ? body.data
      : body
}

async function getMedia(kind, input, { format, signal, timeout } = {}) {
  const value = String(input || '').trim()
  if (!value) throw new Error('A source URL is required')
  const config = ROUTES[kind]?.()
  if (!config) throw new Error(`Unsupported Knight media type: ${kind}`)

  const params = { [config.param]: value }
  if (format) params.format = format
  const body = await getJson(config.path, params, { timeout, signal })
  const download = findDownload(body, value)
  if (!download) throw new Error('Knight API returned no downloadable file')

  const result = getResult(body)
  const metadata = result.metadata || body.metadata || {}
  return {
    download,
    title: result.title || result.name || result.track || result.song || metadata.title || body.title || '',
    thumbnail: result.thumbnail || result.thumbnail_url || result.thumb || metadata.thumbnail || body.thumbnail || null,
    raw: body,
  }
}

const getVideo = (url, options = {}) => getMedia('video', url, { format: '480p', ...options })
const getAudio = (url, options = {}) => getMedia('audio', url, { format: '128kbps', ...options })
const getSpotify = (url, options = {}) => getMedia('spotify', url, options)

async function getLyrics(query, options = {}) {
  const config = ROUTES.lyrics()
  return getJson(config.path, { [config.param]: String(query || '').trim() }, options)
}

module.exports = {
  getVideo,
  getAudio,
  getSpotify,
  getLyrics,
  _internals: { ROUTES, routeUrl, findDownload, getResult },
}
