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
async function getEliteProTechVideoByUrl(youtubeUrl) {
  const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.success && res?.data?.downloadURL) {
    return { download: res.data.downloadURL, title: res.data.title }
  }
  throw new Error('EliteProTech ytdown returned no download')
}

// ── API #2 — Yupra ─────────────────────────────────────────────────
async function getYupraVideoByUrl(youtubeUrl) {
  const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`
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
async function getOkatsuVideoByUrl(youtubeUrl) {
  const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  // shape: { status, creator, url, result: { status, title, mp4 } }
  if (res?.data?.result?.mp4) {
    return { download: res.data.result.mp4, title: res.data.result.title }
  }
  throw new Error('Okatsu ytmp4 returned no mp4')
}

// ── API #4 — Keith ─────────────────────────────────────────────────
async function getKeithVideoByUrl(youtubeUrl) {
  const apiUrl = `https://apis-keith.vercel.app/download/dlmp4?url=${encodeURIComponent(youtubeUrl)}`
  const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS))
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return { download: res.data.result.downloadUrl, title: res.data.result.title }
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
  pattern: 'video',
  alias: ['ytv', 'ytmp4', 'ytvideo', 'ytvid'],
  category: 'download',
  desc: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  run: async ({ sock, from, msg, args }) => {
    sock.sendMessage(from, { react: { text: '📺', key: msg.key } }).catch(() => {})

    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.video <video name>*\nExample: .video Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 1. Resolve a YouTube video (link or search) ──────────────
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

      // ── 2. Send thumbnail + card immediately ──────────────────────
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

      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── 3. Validate it's actually a YouTube URL ───────────────────
      const urlCheck = ytUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi)
      if (!urlCheck) {
        throw new Error('This is not a valid YouTube link!')
      }

      // ── 4. Try each API in order: EliteProTech → Yupra → Okatsu → Keith ──
      const apiMethods = [
        { name: 'EliteProTech', method: () => getEliteProTechVideoByUrl(ytUrl) },
        { name: 'Yupra', method: () => getYupraVideoByUrl(ytUrl) },
        { name: 'Okatsu', method: () => getOkatsuVideoByUrl(ytUrl) },
        { name: 'Keith', method: () => getKeithVideoByUrl(ytUrl) },
      ]

      let videoData, downloadSuccess = false

      for (const api of apiMethods) {
        try {
          videoData = await api.method()
          const check = videoData.download || videoData.dl || videoData.url
          if (!check) {
            console.log(`[VIDEO] ${api.name} returned no download URL, trying next...`)
            continue
          }
          console.log(`[VIDEO] ✅ ${api.name} resolved`)
          downloadSuccess = true
          break
        } catch (apiErr) {
          console.log(`[VIDEO] ❌ ${api.name}: ${apiErr.message}`)
        }
      }

      if (!downloadSuccess || !videoData) {
        throw new Error('All download sources failed. The content may be unavailable or blocked in your region.')
      }

      // ── 5. Send video directly using the resolved URL (no buffer
      //      download — matches Knight Bot MD's pattern: WhatsApp
      //      streams it straight from the source CDN) ───────────────
      const finalUrl = videoData.download || videoData.dl || videoData.url
      const safeName = (videoData.title || v.title || 'video').replace(/[^\w\s-]/g, '')

      await sock.sendMessage(from, {
        video: { url: finalUrl },
        mimetype: 'video/mp4',
        fileName: `${safeName}.mp4`,
        caption: `🎬 *${videoData.title || v.title || 'Video'}*\n\n${CREDIT}`,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[VIDEO]', e.message)

      let errorMessage = `❌ Failed to download video.`
      if (e.message?.includes('blocked')) {
        errorMessage = '❌ Download blocked. The content may be unavailable in your region or due to legal restrictions.'
      } else if (e.response?.status === 451 || e.status === 451) {
        errorMessage = '❌ Content unavailable (451). This may be due to legal restrictions or regional blocking.'
      } else if (e.message?.includes('All download sources failed')) {
        errorMessage = '❌ All download sources failed. The content may be unavailable or blocked.'
      } else if (e.message) {
        errorMessage = `❌ Download failed: ${e.message}`
      }

      await sock.sendMessage(from, {
        text: `${errorMessage}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
