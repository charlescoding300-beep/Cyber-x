// commands/youtube.js — CYBER X YouTube Downloader
'use strict'

const axios = require('axios')
const yts   = require('yt-search')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const AXIOS_DEFAULTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  },
}

// ── YouTube URL validator — handles all formats ──
const YT_REGEX = /https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i

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
async function getEliteProTech(url) {
  const res = await tryRequest(() => axios.get(
    `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4`,
    AXIOS_DEFAULTS
  ))
  if (res?.data?.success && res?.data?.downloadURL) {
    return {
      download:  res.data.downloadURL,
      title:     res.data.title     || 'YouTube Video',
      thumbnail: res.data.thumbnail || null,
    }
  }
  throw new Error('EliteProTech returned no download')
}

// ── API #2 — Yupra ────────────────────────────────────────────────
async function getYupra(url) {
  const res = await tryRequest(() => axios.get(
    `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  if (res?.data?.success && res?.data?.data?.download_url) {
    return {
      download:  res.data.data.download_url,
      title:     res.data.data.title     || 'YouTube Video',
      thumbnail: res.data.data.thumbnail || null,
    }
  }
  throw new Error('Yupra returned no download')
}

// ── API #3 — Okatsu ───────────────────────────────────────────────
async function getOkatsu(url) {
  const res = await tryRequest(() => axios.get(
    `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  if (res?.data?.result?.mp4) {
    return {
      download:  res.data.result.mp4,
      title:     res.data.result.title || 'YouTube Video',
      thumbnail: null,
    }
  }
  throw new Error('Okatsu returned no download')
}

// ── API #4 — Keith ────────────────────────────────────────────────
async function getKeith(url) {
  const res = await tryRequest(() => axios.get(
    `https://apis-keith.vercel.app/download/dlmp4?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return {
      download:  res.data.result.downloadUrl,
      title:     res.data.result.title || 'YouTube Video',
      thumbnail: null,
    }
  }
  throw new Error('Keith returned no download')
}

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern:  'youtube',
  alias:    ['yt', 'ytlink', 'ytdl'],
  category: 'media',
  desc:     'Download YouTube video by link',
  usage:    '.youtube <YouTube link>',

  run: async ({ sock, from, msg, args }) => {

    // ── React immediately ──
    sock.sendMessage(from, { react: { text: '🎦', key: msg.key } }).catch(() => {})

    const url = args.join(' ').trim()

    if (!url) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🎦 *CYBER X YOUTUBE DL*  ║
╚═══════════════════════════╝

*How to use:*
• *.youtube <link>* — Download video
• *.yt <link>* — Also works
• *.ytdl <link>* — Also works

💡 *Supported link formats:*
  _https://youtu.be/xxxxx_
  _https://www.youtube.com/watch?v=xxxxx_
  _https://www.youtube.com/shorts/xxxxx_

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Validate YouTube URL ──
    if (!YT_REGEX.test(url)) {
      return sock.sendMessage(from, {
        text: `❌ *Invalid YouTube link!*\n\nSupported formats:\n• https://youtu.be/xxxxx\n• https://www.youtube.com/watch?v=xxxxx\n• https://www.youtube.com/shorts/xxxxx\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send searching message ──
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Fetching YouTube video...*`,
    }, { quoted: msg })

    try {
      // ── Get video info from yt-search ──
      let v = null
      try {
        const ytId = (url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) || [])[1]
        if (ytId) {
          const info = await yts({ videoId: ytId })
          if (info?.title) v = info
        }
      } catch {}

      // ── Try all APIs in order ──
      const APIs = [
        { name: 'EliteProTech', method: () => getEliteProTech(url) },
        { name: 'Yupra',        method: () => getYupra(url)        },
        { name: 'Okatsu',       method: () => getOkatsu(url)       },
        { name: 'Keith',        method: () => getKeith(url)        },
      ]

      let videoData = null

      for (const api of APIs) {
        try {
          videoData = await api.method()
          if (videoData?.download) {
            console.log(`[YOUTUBE] ✅ ${api.name} resolved`)
            break
          }
        } catch (e) {
          console.log(`[YOUTUBE] ❌ ${api.name}: ${e.message}`)
        }
      }

      if (!videoData?.download) {
        throw new Error('All download sources failed')
      }

      // ── Get thumbnail ──
      const ytId    = (url.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/) || [])[1]
      const thumb   = videoData.thumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : null)
      const title   = videoData.title || v?.title || 'YouTube Video'
      const channel = v?.author?.name || 'Unknown'
      const views   = v?.views        || 0
      const duration = v?.timestamp   || 'N/A'
      const ago     = v?.ago          || 'N/A'

      // ── Build info card ──
      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓 𝙔𝙊𝙐𝙏𝙐𝘽𝙀* 🎬
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎞 *Title*    » ${title}
📺 *Channel*  » ${channel}
⏱️ *Duration* » ${duration}
👁️ *Views*    » ${fmtViews(views)}
📅 *Uploaded* » ${ago}
🔗 *Link*     » ${url}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading video...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── Send thumbnail + card ──
      const infoMsg = await (async () => {
        try {
          if (thumb) {
            return await sock.sendMessage(from, {
              image:   { url: thumb },
              caption: card,
            }, { quoted: msg })
          }
        } catch {}
        return sock.sendMessage(from, { text: card }, { quoted: msg })
      })()

      // ── Delete searching message ──
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── Send video ──
      await sock.sendMessage(from, {
        video:    { url: videoData.download },
        mimetype: 'video/mp4',
        fileName: `${title.replace(/[^\w\s-]/g, '').trim() || 'youtube'}.mp4`,
        caption:  `🎬 *${title}*\n\n${CREDIT}`,
      }, { quoted: infoMsg })

      // ── React success ──
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[YOUTUBE]', e.message)

      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      const friendly =
        e.message.includes('All download')
          ? '❌ *All sources failed.* Video may be age restricted or unavailable. Try another link.'
        : e.message.includes('blocked')
          ? '❌ *Download blocked.* Video may be restricted in your region.'
          : `❌ *Failed:* ${e.message}`

      await sock.sendMessage(from, {
        text: `${friendly}\n\n${CREDIT}`,
        quoted: msg
      })
    }
  }
}
