'use strict'

const axios = require('axios')
const yts   = require('yt-search')
const { toVideo } = require('../lib/converter')

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
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: HEADERS, validateStatus: s => s >= 200 && s < 400 })
    return Buffer.from(r.data)
  } catch {
    const r = await axios.get(url, { responseType: 'stream', timeout: 120000,
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

const MP4_APIS = [
  {
    name: 'EliteProTech',
    get: async (url, quality) => {
      const r = await tryGet(() => axios.get(
        `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4&quality=${quality}`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.success && r?.data?.downloadURL) return r.data.downloadURL
      throw new Error('No URL')
    }
  },
  {
    name: 'Yupra',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.success && r?.data?.data?.download_url) return r.data.data.download_url
      throw new Error('No URL')
    }
  },
  {
    name: 'Okatsu',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS }))
      if (r?.data?.dl) return r.data.dl
      throw new Error('No URL')
    }
  },
]

async function downloadMp4(ytUrl, quality = '480') {
  for (const api of MP4_APIS) {
    try {
      console.log(`[VIDEO] Trying ${api.name}...`)
      const dlUrl = await api.get(ytUrl, quality)
      const buf   = await fetchBuffer(dlUrl)
      if (buf?.length > 0) {
        console.log(`[VIDEO] ✅ ${api.name} (${(buf.length/1e6).toFixed(1)}MB)`)
        return buf
      }
    } catch (e) { console.log(`[VIDEO] ❌ ${api.name}: ${e.message}`) }
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

const QUALITIES = ['360', '480', '720', '1080']

module.exports = {
  pattern: 'video',
  desc: 'Download YouTube video',
  category: 'media',

  run: async ({ sock, from, msg, args }) => {
    let queryArgs = [...args]
    let quality   = '480'
    if (QUALITIES.includes(queryArgs[queryArgs.length - 1])) quality = queryArgs.pop()
    const query = queryArgs.join(' ').trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
`🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓 VIDEO*

• *.video <title>*       → 480p
• *.video <title> 360*   → 360p
• *.video <title> 720*   → 720p

Example: *.video Burna Boy Last Last*

${CREDIT}`,
      }, { quoted: msg })
    }

    sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {})

    // ── 1. Send searching message ──────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔍 *Searching:* ${query} *(${quality}p)*...`,
    }, { quoted: msg })

    try {
      // ── 2. Search YouTube ────────────────────────────────────────
      const search = await yts(query)

      if (!search?.videos?.length) {
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
        return sock.sendMessage(from, {
          text: `❌ No results found for *${query}*\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      const v     = search.videos[0]
      const ytUrl = v.url

      const caption =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙑𝙄𝘿𝙀𝙊* 🎬
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎬 *Title*    » ${v.title}
🎤 *Artist*   » ${v.author?.name || 'Unknown'}
⏱️ *Duration* » ${v.timestamp || 'N/A'}
👁️ *Views*    » ${fmtViews(v.views)}
📅 *Uploaded* » ${v.ago || 'N/A'}
🎯 *Quality*  » ${quality}p
🔗 *Link*     » ${ytUrl}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading video...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── 3. Send thumbnail + card ─────────────────────────────────
      const infoMsg = await (async () => {
        try {
          if (v.thumbnail) {
            return await sock.sendMessage(from, {
              image: { url: v.thumbnail }, caption,
            }, { quoted: msg })
          }
        } catch {}
        return sock.sendMessage(from, { text: caption }, { quoted: msg })
      })()

      // ── 4. Delete searching message AFTER thumbnail ──────────────
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── 5. Download + convert ────────────────────────────────────
      const raw    = await downloadMp4(ytUrl, quality)
      const buffer = await toVideo(raw, 'mp4')

      // ── 6. Send video ────────────────────────────────────────────
      await sock.sendMessage(from, {
        video:    buffer,
        mimetype: 'video/mp4',
        caption:  `🎬 *${v.title}*\n${CREDIT}`,
        fileName: `${v.title.replace(/[^\w\s]/g, '').trim()}.mp4`,
      }, { quoted: infoMsg })

      sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      console.error('[VIDEO]', e.message)
      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ❌ *VIDEO FAILED* ║
╚════════════════════╝

│ *Error:* ${e.message.slice(0,100)}
│ 💡 Try: .video ${query} 360

${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
