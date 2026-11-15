'use strict'

const axios = require('axios')
const yts   = require('yt-search')
const { toAudio, detectFormat } = require('../lib/converter')
const knightApi = require('../lib/knightapi')

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
}

const API_TIMEOUT_MS = 12000
const DOWNLOAD_TIMEOUT_MS = 45000

async function fetchBuffer(url, { signal, timeout = DOWNLOAD_TIMEOUT_MS } = {}) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout,
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
    headers: HEADERS, signal,
    validateStatus: s => s >= 200 && s < 400,
  })
  return Buffer.from(r.data)
}

const MP3_APIS = [
  {
    name: 'KnightBot API',
    get: async (url, options) => (await knightApi.getAudio(url, { ...options, timeout: API_TIMEOUT_MS })).download,
  },
  {
    name: 'EliteProTech',
    get: async (url, { signal }) => {
      const r = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, { timeout: API_TIMEOUT_MS, signal, headers: HEADERS })
      if (r?.data?.success && r?.data?.downloadURL) return r.data.downloadURL
      throw new Error('No URL')
    }
  },
  {
    name: 'Yupra',
    get: async (url, { signal }) => {
      const r = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, { timeout: API_TIMEOUT_MS, signal, headers: HEADERS })
      if (r?.data?.success && r?.data?.data?.download_url) return r.data.data.download_url
      throw new Error('No URL')
    }
  },
  {
    name: 'Okatsu',
    get: async (url, { signal }) => {
      const r = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, { timeout: API_TIMEOUT_MS, signal, headers: HEADERS })
      if (r?.data?.dl) return r.data.dl
      throw new Error('No URL')
    }
  }
]

async function downloadMp3(ytUrl) {
  const controllers = new Set()
  const active = new Map()
  const failures = []
  let next = 0

  const startNext = () => {
    if (next >= MP3_APIS.length) return
    const api = MP3_APIS[next++]
    const controller = new AbortController()
    controllers.add(controller)
    const task = (async () => {
      try {
        const dlUrl = await api.get(ytUrl, { signal: controller.signal })
        if (!dlUrl) throw new Error('No download URL')
        const buf = await fetchBuffer(dlUrl, { signal: controller.signal })
        if (buf.length < 10000) throw new Error('Downloaded file is too small')
        return { api, buf }
      } catch (error) {
        return { api, error }
      }
    })()
    active.set(api.name, task)
  }

  // Race two providers at a time so one slow endpoint cannot block the others.
  startNext()
  startNext()
  while (active.size) {
    const result = await Promise.race(active.values())
    active.delete(result.api.name)
    if (result.buf) {
      for (const controller of controllers) controller.abort()
      console.log(`[SONG] ✅ ${result.api.name} (${(result.buf.length / 1e6).toFixed(1)}MB)`)
      return result.buf
    }
    failures.push(`${result.api.name}: ${result.error?.message || 'failed'}`)
    console.log(`[SONG] ❌ ${failures[failures.length - 1]}`)
    startNext()
  }
  throw new Error(`All download sources failed: ${failures.join(' | ')}`)
}

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern: 'song',
  alias: ['yta'],
  category: 'download',
  desc: 'Download audio from YouTube',
  usage: '.song <song name or YouTube link>',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.song <song name>*\nExample: .song Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── 1. Send searching message ──────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    // ── React with headset emoji ─────────────────────────────────
    sock.sendMessage(from, { react: { text: '🎧', key: msg.key } }).catch(() => {})

    try {
      // ── 2. Search YouTube ────────────────────────────────────────
      const search = await yts(query)

      if (!search?.videos?.length) {
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        return sock.sendMessage(from, {
          text: `❌ No results found for *${query}*\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      const v     = search.videos[0]
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

      const downloadResult = downloadMp3(ytUrl).then(buf => ({ buf }), error => ({ error }))

      // ── 3. Send thumbnail + card ─────────────────────────────────
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

      // ── 4. Delete searching message AFTER thumbnail ──────────────
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // Finish the parallel download and avoid re-encoding an existing MP3.
      const downloaded = await downloadResult
      if (downloaded.error) throw downloaded.error
      const raw = downloaded.buf
      const { ext } = detectFormat(raw)
      const audio = ext === 'mp3' ? raw : await toAudio(raw, ext)

      // ── 7. Send audio ────────────────────────────────────────────
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${v.title.replace(/[^\w\s]/g, '').trim()}.mp3`,
        ptt: false,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[SONG]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Failed:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
