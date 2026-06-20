/**
 * CYBER X - YouTube Download Engine
 * ──────────────────────────────────────────────────────────────────
 * Shared by every session's .song / .video commands. There is only
 * ONE copy of this download logic — every session and every user
 * calls into it independently. That's the point: a fix here fixes
 * it everywhere, and one user's download has zero effect on another
 * user's download. Nobody waits on anybody. Nobody is blocked.
 *
 * Fallback chain (tries each in order, first success wins):
 *   1. EliteProTech
 *   2. Yupra
 *   3. Okatsu
 *   4. Keith (apis-keith) — extra 4th source, single-shot API
 *
 * All 4 are free third-party scraper APIs, so all 4 CAN go down at
 * once (that's what was happening before). Adding a 4th source
 * doesn't guarantee success, it just adds one more chance before
 * giving up. If you want a fix that doesn't depend on any of these
 * surviving, yt-dlp-exec (talking to YouTube directly) is the real
 * long-term answer — say the word and I'll wire that in as a 5th,
 * final fallback.
 * ──────────────────────────────────────────────────────────────────
 */

'use strict'

const axios = require('axios')

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
}

const AXIOS_DEFAULTS = { timeout: 60000, headers: HEADERS }

async function tryRequest(getter, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await getter()
    } catch (err) {
      lastError = err
      if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError
}

// ── Per-API getters: each returns { download, title, thumbnail? } ──

async function eliteProTech(youtubeUrl, format) {
  const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=${format}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.success && res?.data?.downloadURL) {
    return { download: res.data.downloadURL, title: res.data.title }
  }
  throw new Error('EliteProTech returned no download')
}

async function yupra(youtubeUrl, format) {
  const kind = format === 'mp3' ? 'ytmp3' : 'ytmp4'
  const apiUrl = `https://api.yupra.my.id/api/downloader/${kind}?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.success && res?.data?.data?.download_url) {
    return {
      download: res.data.data.download_url,
      title: res.data.data.title,
      thumbnail: res.data.data.thumbnail,
    }
  }
  throw new Error('Yupra returned no download')
}

async function okatsu(youtubeUrl, format) {
  const kind = format === 'mp3' ? 'ytmp3' : 'ytmp4'
  const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/${kind}?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (format === 'mp3' && res?.data?.dl) {
    return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb }
  }
  if (format === 'mp4' && res?.data?.result?.mp4) {
    return { download: res.data.result.mp4, title: res.data.result.title }
  }
  throw new Error('Okatsu returned no download')
}

async function keith(youtubeUrl, format) {
  // Keith only documented for mp3 in the reference; skip cleanly for mp4
  if (format !== 'mp3') throw new Error('Keith: mp3 only')
  const apiUrl = `https://apis-keith.vercel.app/download/dlmp3?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return { download: res.data.result.downloadUrl, title: res.data.result.title }
  }
  throw new Error('Keith returned no download')
}

const CHAIN = [
  { name: 'EliteProTech', get: eliteProTech },
  { name: 'Yupra', get: yupra },
  { name: 'Okatsu', get: okatsu },
  { name: 'Keith', get: keith },
]

/**
 * Resolve a YouTube URL to a direct download link + metadata.
 * Tries each API in order; first one that returns a usable URL wins.
 * Throws if every source fails.
 */
async function resolveDownload(youtubeUrl, format = 'mp3') {
  for (const api of CHAIN) {
    try {
      const data = await api.get(youtubeUrl, format)
      const url = data.download || data.dl || data.url
      if (!url) {
        console.log(`[YTDL] ${api.name} gave no URL, trying next...`)
        continue
      }
      console.log(`[YTDL] ✅ resolved via ${api.name}`)
      return { ...data, download: url, source: api.name }
    } catch (e) {
      console.log(`[YTDL] ❌ ${api.name}: ${e.message}`)
    }
  }
  throw new Error('All download sources failed. The content may be unavailable or blocked in your region.')
}

/**
 * Download the actual file bytes from a resolved URL.
 * Tries arraybuffer first, falls back to stream mode (handles APIs
 * that don't set Content-Length correctly). Treats HTTP 451 as a
 * clear "blocked" signal worth surfacing distinctly.
 */
async function fetchBuffer(url) {
  const baseHeaders = {
    'User-Agent': HEADERS['User-Agent'],
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  }

  try {
    const r = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      decompress: true, validateStatus: s => s >= 200 && s < 400,
      headers: baseHeaders,
    })
    const buf = Buffer.from(r.data)
    if (buf?.length > 0) return buf
    throw new Error('Empty buffer (arraybuffer mode)')
  } catch (err) {
    const status = err.response?.status || err.status
    if (status === 451) {
      const blocked = new Error('Content blocked (451) — unavailable or region-restricted')
      blocked.code = 451
      throw blocked
    }
    // fall back to stream mode
    const r = await axios.get(url, {
      responseType: 'stream', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      validateStatus: s => s >= 200 && s < 400,
      headers: baseHeaders,
    })
    const chunks = []
    await new Promise((resolve, reject) => {
      r.data.on('data', c => chunks.push(c))
      r.data.on('end', resolve)
      r.data.on('error', reject)
    })
    const buf = Buffer.concat(chunks)
    if (buf?.length > 0) return buf
    throw new Error('Empty buffer (stream mode)')
  }
}

/**
 * Full pipeline: resolve + download bytes, with automatic move to
 * the next API source if the resolved URL fails to actually download
 * (e.g. 451 blocked) rather than just failing outright.
 */
async function downloadMedia(youtubeUrl, format = 'mp3') {
  let lastErr
  for (const api of CHAIN) {
    try {
      const data = await api.get(youtubeUrl, format)
      const url = data.download || data.dl || data.url
      if (!url) continue

      try {
        const buffer = await fetchBuffer(url)
        console.log(`[YTDL] ✅ ${api.name} (${(buffer.length / 1e6).toFixed(1)}MB)`)
        return { buffer, title: data.title, thumbnail: data.thumbnail, source: api.name }
      } catch (dlErr) {
        console.log(`[YTDL] ❌ ${api.name} resolved but download failed: ${dlErr.message}`)
        lastErr = dlErr
        continue
      }
    } catch (e) {
      console.log(`[YTDL] ❌ ${api.name}: ${e.message}`)
      lastErr = e
    }
  }
  throw new Error('All download sources failed. The content may be unavailable or blocked in your region.')
}

/** Friendly error text for the WhatsApp reply, given a thrown error */
function friendlyError(err) {
  if (err?.code === 451 || err?.response?.status === 451) {
    return '❌ Content unavailable (451) — likely region-restricted or blocked.'
  }
  if (err?.message?.includes('blocked')) {
    return '❌ Download blocked. The content may be unavailable in your region.'
  }
  if (err?.message?.includes('All download sources failed')) {
    return '❌ All download sources failed. The content may be unavailable right now — try again shortly or try a different link.'
  }
  return `❌ Download failed: ${err?.message || 'unknown error'}`
}

module.exports = { resolveDownload, fetchBuffer, downloadMedia, friendlyError }
