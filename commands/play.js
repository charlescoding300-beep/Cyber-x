'use strict'

const axios = require('axios')
const yts   = require('yt-search')
const { toAudio, detectFormat } = require('../lib/converter')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
}

async function tryGet(fn, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      last = e
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw last
}

async function fetchBuffer(url) {
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: HEADERS, validateStatus: s => s >= 200 && s < 400 })
    return Buffer.from(r.data)
  } catch {
    const r = await axios.get(url, { responseType: 'stream', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: HEADERS, validateStatus: s => s >= 200 && s < 400 })
    const chunks = []
    await new Promise((res, rej) => {
      r.data.on('data', c => chunks.push(c))
      r.data.on('end', res)
      r.data.on('error', rej)
    })
    return Buffer.concat(chunks)
  }
}

const MP3_APIS = [
  {
    name: 'EliteProTech',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.success && r?.data?.downloadURL) return r.data.downloadURL
      throw new Error('No URL')
    }
  },
  {
    name: 'Yupra',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.success && r?.data?.data?.download_url) return r.data.data.download_url
      throw new Error('No URL')
    }
  },
  {
    name: 'Okatsu',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.dl) return r.data.dl
      throw new Error('No URL')
    }
  },
]

async function downloadMp3(ytUrl) {
  for (const api of MP3_APIS) {
    try {
      console.log(`[PLAY] Trying ${api.name}...`)
      const dlUrl = await api.get(ytUrl)
      const buf   = await fetchBuffer(dlUrl)
      if (buf?.length > 0) {
        console.log(`[PLAY] ✅ ${api.name} (${(buf.length/1e6).toFixed(1)}MB)`)
        return buf
      }
    } catch (e) { console.log(`[PLAY] ❌ ${api.name}: ${e.message}`) }
  }
  throw new Error('All download sources failed')
}

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern: 'play',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.play <song name>*\nExample: .play Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── 1. Send searching message ──────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

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

      // ── 5. Download + convert ────────────────────────────────────
      const raw   = await downloadMp3(ytUrl)
      const { ext } = detectFormat(raw)
      const audio = await toAudio(raw, ext)

      // ── 6. Send audio ────────────────────────────────────────────
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${v.title.replace(/[^\w\s]/g, '').trim()}.mp3`,
        ptt: false,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[PLAY]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Failed:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
