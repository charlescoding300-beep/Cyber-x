'use strict'

const axios = require('axios')
const yts   = require('yt-search')
const { toAudio, detectFormat } = require('../lib/converter')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

const AXIOS_DEFAULTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  },
}

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

// ── API #1 — EliteProTech ─────────────────────────────────────────
async function getEliteProTechDownloadByUrl(youtubeUrl) {
  const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.success && res?.data?.downloadURL) {
    return { download: res.data.downloadURL, title: res.data.title }
  }
  throw new Error('EliteProTech ytdown returned no download')
}

// ── API #2 — Yupra ─────────────────────────────────────────────────
async function getYupraDownloadByUrl(youtubeUrl) {
  const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`
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

// ── API #3 — Okatsu ────────────────────────────────────────────────
async function getOkatsuDownloadByUrl(youtubeUrl) {
  const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.dl) {
    return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb }
  }
  throw new Error('Okatsu ytmp3 returned no download')
}

// ── API #4 — Keith ─────────────────────────────────────────────────
async function getKeithDownloadByUrl(youtubeUrl) {
  const apiUrl = `https://apis-keith.vercel.app/download/dlmp3?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return { download: res.data.result.downloadUrl, title: res.data.result.title }
  }
  throw new Error('Keith returned no download')
}

// ── Download the actual file bytes from a resolved URL ─────────────
// arraybuffer first, falls back to stream mode, treats 451 as blocked
async function fetchBuffer(url) {
  const headers = {
    'User-Agent': AXIOS_DEFAULTS.headers['User-Agent'],
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  }
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      decompress: true, validateStatus: s => s >= 200 && s < 400,
      headers,
    })
    const buf = Buffer.from(res.data)
    if (buf?.length > 0) return buf
    throw new Error('Empty buffer (arraybuffer mode)')
  } catch (err) {
    const status = err.response?.status || err.status
    if (status === 451) {
      const blocked = new Error('Content blocked (451) — unavailable or region-restricted')
      blocked.code = 451
      throw blocked
    }
    const res = await axios.get(url, {
      responseType: 'stream', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      validateStatus: s => s >= 200 && s < 400,
      headers,
    })
    const chunks = []
    await new Promise((resolve, reject) => {
      res.data.on('data', c => chunks.push(c))
      res.data.on('end', resolve)
      res.data.on('error', reject)
    })
    const buf = Buffer.concat(chunks)
    if (buf?.length > 0) return buf
    throw new Error('Empty buffer (stream mode)')
  }
}

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

function friendlyError(err) {
  if (err?.code === 451 || err?.response?.status === 451) {
    return '❌ Content unavailable (451) — likely region-restricted or blocked.'
  }
  if (err?.message?.includes('All sources failed')) {
    return '❌ All download sources failed. The content may be unavailable right now — try again shortly.'
  }
  return `❌ Failed: ${err?.message || 'unknown error'}`
}

module.exports = {
  pattern: 'song',
  alias: ['play', 'music', 'yta'],
  category: 'media',
  desc: 'Download audio from YouTube',
  usage: '.song <song name or YouTube link>',

  run: async ({ sock, from, msg, args }) => {
    sock.sendMessage(from, { react: { text: '🎧', key: msg.key } }).catch(() => {})

    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.song <song name>*\nExample: .song Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 1. Resolve a YouTube video (link or search) ──────────────
      let v
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        const ytId = (query.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1]
        v = {
          url: query, title: query, timestamp: '', views: 0,
          author: { name: '' }, ago: '',
          thumbnail: ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : '',
        }
      } else {
        const search = await yts(query)
        if (!search?.videos?.length) {
          sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
          return sock.sendMessage(from, {
            text: `❌ No results found for *${query}*\n\n${CREDIT}`,
          }, { quoted: msg })
        }
        v = search.videos[0]
      }

      const ytUrl = v.url

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${v.title}
🎤 *Artist*   » ${v.author?.name || 'Unknown'}
⏱️ *Duration* » ${v.timestamp || 'N/A'}
👁️ *Views*    » ${fmtViews(v.views)}
📅 *Uploaded* » ${v.ago || 'N/A'}
📺 *Platform* » YouTube
🔗 *Link*     » ${ytUrl}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading audio...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── 2. Send thumbnail + card immediately ──────────────────────
      const infoMsg = await (async () => {
        try {
          if (v.thumbnail) {
            return await sock.sendMessage(from, {
              image: { url: v.thumbnail }, caption: card,
            }, { quoted: msg })
          }
        } catch {}
        return sock.sendMessage(from, { text: card }, { quoted: msg })
      })()

      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── 3. Try each API in order: EliteProTech → Yupra → Okatsu → Keith ──
      const apiMethods = [
        { name: 'EliteProTech', method: () => getEliteProTechDownloadByUrl(ytUrl) },
        { name: 'Yupra', method: () => getYupraDownloadByUrl(ytUrl) },
        { name: 'Okatsu', method: () => getOkatsuDownloadByUrl(ytUrl) },
        { name: 'Keith', method: () => getKeithDownloadByUrl(ytUrl) },
      ]

      let rawBuffer, resolvedTitle, downloadSuccess = false

      for (const api of apiMethods) {
        try {
          const data = await api.method()
          const url = data.download || data.dl || data.url
          if (!url) {
            console.log(`[SONG] ${api.name} returned no download URL, trying next...`)
            continue
          }
          rawBuffer = await fetchBuffer(url)
          resolvedTitle = data.title
          console.log(`[SONG] ✅ ${api.name} (${(rawBuffer.length / 1e6).toFixed(1)}MB)`)
          downloadSuccess = true
          break
        } catch (e) {
          console.log(`[SONG] ❌ ${api.name}: ${e.message}`)
        }
      }

      if (!downloadSuccess || !rawBuffer) {
        throw new Error('All sources failed. The content may be unavailable or blocked in your region.')
      }

      // ── 4. Convert via your shared, concurrency-safe converter.js ─
      const { ext } = detectFormat(rawBuffer)
      const audio = await toAudio(rawBuffer, ext)

      // ── 5. Send immediately, the moment it's ready ────────────────
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${(resolvedTitle || v.title || 'song').replace(/[^\w\s]/g, '').trim()}.mp3`,
        ptt: false,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[SONG]', e.message)
      await sock.sendMessage(from, {
        text: `${friendlyError(e)}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
