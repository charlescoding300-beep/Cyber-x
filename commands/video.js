'use strict'

const yts  = require('yt-search')
const axios = require('axios')

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

const MP4_APIS = [
  {
    name: 'EliteProTech',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4`,
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

async function downloadMp4(ytUrl) {
  for (const api of MP4_APIS) {
    try {
      console.log(`[VIDEO] Trying ${api.name}...`)
      const dlUrl = await api.get(ytUrl)
      console.log(`[VIDEO] ✅ ${api.name} got URL`)
      return dlUrl
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

module.exports = {
  pattern: 'video',
  alias: ['ytv', 'ytmp4', 'ytvideo', 'ytvid'],
  category: 'media',
  desc: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.video <video name>*\nExample: .video Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── 1. Send searching message ──────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 2. Search YouTube ────────────────────────────────────────
      let v
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        v = { url: query, title: query, thumbnail: '', timestamp: '', views: 0, author: { name: '' }, ago: '' }
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
      const ytId  = (ytUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1]
      const thumb = v.thumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : null)

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙑𝙄𝘿𝙀𝙊* 🎬
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎞 *Title*    » ${v.title}
📺 *Channel*  » ${v.author?.name || 'Unknown'}
⏱️ *Duration* » ${v.timestamp || 'N/A'}
👁️ *Views*    » ${fmtViews(v.views)}
📅 *Uploaded* » ${v.ago || 'N/A'}
🔗 *Link*     » ${ytUrl}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading video...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── 3. Send thumbnail + card ─────────────────────────────────
      const infoMsg = await (async () => {
        try {
          if (thumb) {
            return await sock.sendMessage(from, {
              image: { url: thumb }, caption: card,
            }, { quoted: msg })
          }
        } catch {}
        return sock.sendMessage(from, { text: card }, { quoted: msg })
      })()

      // ── 4. Delete searching message ──────────────────────────────
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── 5. Get download URL ──────────────────────────────────────
      const dlUrl = await downloadMp4(ytUrl)

      // ── 6. Delete card ───────────────────────────────────────────
      sock.sendMessage(from, { delete: infoMsg.key }).catch(() => {})

      // ── 7. Send video ────────────────────────────────────────────
      const safeName = v.title.replace(/[^\w\s]/g, '').trim()
      await sock.sendMessage(from, {
        video: { url: dlUrl },
        mimetype: 'video/mp4',
        fileName: `${safeName}.mp4`,
        caption: `🎬 *${v.title}*\n\n${CREDIT}`,
      }, { quoted: msg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[VIDEO]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Failed:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
