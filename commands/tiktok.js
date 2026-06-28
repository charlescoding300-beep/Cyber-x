// commands/tiktok.js — CYBER X TikTok Downloader
'use strict'

const axios = require('axios')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const AXIOS_DEFAULTS = {
  timeout: 60000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  },
}

// ── TikTok URL validator — handles all 2026 formats ──
const TIKTOK_REGEX = /https?:\/\/(www\.tiktok\.com\/@[\w.]+\/video\/\d+|vm\.tiktok\.com\/\w+|vt\.tiktok\.com\/\w+)/i

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

// ── API #1 — Tikmate ──────────────────────────────────────────────
async function getTikmate(url) {
  const res = await tryRequest(() => axios.post(
    'https://tikmate.online/api/lookup',
    { url },
    { ...AXIOS_DEFAULTS, headers: { ...AXIOS_DEFAULTS.headers, 'Content-Type': 'application/json' } }
  ))
  const data = res?.data
  if (data?.token) {
    const dl = `https://tikmate.online/download/${data.token}/${data.id}.mp4`
    return {
      download: dl,
      title:     data.desc   || 'TikTok Video',
      author:    data.author || 'Unknown',
      thumbnail: data.cover  || null,
      likes:     data.diggCount   || 0,
      views:     data.playCount   || 0,
      comments:  data.commentCount || 0,
    }
  }
  throw new Error('Tikmate returned no token')
}

// ── API #2 — SnapTik ──────────────────────────────────────────────
async function getSnapTik(url) {
  const res = await tryRequest(() => axios.post(
    'https://snaptik.app/abc2.php',
    new URLSearchParams({ url, lang: 'en' }).toString(),
    { ...AXIOS_DEFAULTS, headers: { ...AXIOS_DEFAULTS.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
  ))
  const html  = res?.data || ''
  const match = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/)
  if (match?.[1]) return { download: match[1], title: 'TikTok Video', author: 'Unknown', thumbnail: null }
  throw new Error('SnapTik returned no download')
}

// ── API #3 — SSSTik ───────────────────────────────────────────────
async function getSSSRik(url) {
  const res = await tryRequest(() => axios.post(
    'https://ssstik.io/abc?url=dl',
    new URLSearchParams({ id: url, locale: 'en', tt: 'a2VsbHk=' }).toString(),
    { ...AXIOS_DEFAULTS, headers: { ...AXIOS_DEFAULTS.headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://ssstik.io/' } }
  ))
  const html  = res?.data || ''
  const match = html.match(/href="(https:\/\/[^"]+)"[^>]*>\s*Without watermark/i)
  if (match?.[1]) return { download: match[1], title: 'TikTok Video', author: 'Unknown', thumbnail: null }
  throw new Error('SSSTik returned no download')
}

// ── API #4 — Yupra ────────────────────────────────────────────────
async function getYupra(url) {
  const res = await tryRequest(() => axios.get(
    `https://api.yupra.my.id/api/downloader/tiktok?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data?.data
  if (data?.video_nowm || data?.video) {
    return {
      download:  data.video_nowm || data.video,
      title:     data.title      || 'TikTok Video',
      author:    data.author     || 'Unknown',
      thumbnail: data.cover      || null,
      likes:     data.likes      || 0,
      views:     data.views      || 0,
    }
  }
  throw new Error('Yupra TikTok returned no download')
}

// ── API #5 — Okatsu ───────────────────────────────────────────────
async function getOkatsu(url) {
  const res = await tryRequest(() => axios.get(
    `https://okatsu-rolezapiiz.vercel.app/downloader/tiktok?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data
  if (data?.dl || data?.download || data?.result?.download) {
    return {
      download:  data.dl || data.download || data.result?.download,
      title:     data.title  || data.result?.title  || 'TikTok Video',
      author:    data.author || data.result?.author || 'Unknown',
      thumbnail: data.thumb  || data.result?.thumb  || null,
    }
  }
  throw new Error('Okatsu TikTok returned no download')
}

// ── API #6 — EliteProTech ─────────────────────────────────────────
async function getEliteProTech(url) {
  const res = await tryRequest(() => axios.get(
    `https://eliteprotech-apis.zone.id/tiktokdl?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data
  if (data?.success && (data?.downloadURL || data?.nowatermark)) {
    return {
      download:  data.nowatermark || data.downloadURL,
      title:     data.title  || 'TikTok Video',
      author:    data.author || 'Unknown',
      thumbnail: data.cover  || null,
      likes:     data.likes  || 0,
      views:     data.views  || 0,
    }
  }
  throw new Error('EliteProTech TikTok returned no download')
}

function fmtNum(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern:  'tiktok',
  alias:    ['tt', 'ttdl', 'tiktokdl'],
  category: 'download',
  desc:     'Download TikTok videos without watermark',
  usage:    '.tiktok <TikTok link>',

  run: async ({ sock, from, msg, args }) => {

    // ── React immediately ──
    sock.sendMessage(from, { react: { text: '🎦', key: msg.key } }).catch(() => {})

    const url = args.join(' ').trim()

    if (!url) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🎦 *CYBER X TIKTOK DL*   ║
╚═══════════════════════════╝

*How to use:*
• *.tiktok <link>* — Download video
• *.tt <link>* — Also works
• *.ttdl <link>* — Also works

💡 *Supported link formats:*
  _https://www.tiktok.com/@user/video/123_
  _https://vm.tiktok.com/ZMrXxxxxx/_
  _https://vt.tiktok.com/ZSxxxxxxx/_

✅ *Downloads WITHOUT watermark!*

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Validate TikTok URL ──
    if (!TIKTOK_REGEX.test(url)) {
      return sock.sendMessage(from, {
        text: `❌ *Invalid TikTok link!*\n\nSupported formats:\n• https://www.tiktok.com/@user/video/123\n• https://vm.tiktok.com/ZMrXxxxxx/\n• https://vt.tiktok.com/ZSxxxxxxx/\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send searching message ──
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Fetching TikTok video...*`,
    }, { quoted: msg })

    try {
      // ── Try all APIs in order ──
      const APIs = [
        { name: 'Tikmate',      method: () => getTikmate(url)      },
        { name: 'Yupra',        method: () => getYupra(url)        },
        { name: 'Okatsu',       method: () => getOkatsu(url)       },
        { name: 'EliteProTech', method: () => getEliteProTech(url) },
        { name: 'SnapTik',      method: () => getSnapTik(url)      },
        { name: 'SSSTik',       method: () => getSSSRik(url)       },
      ]

      let videoData = null

      for (const api of APIs) {
        try {
          videoData = await api.method()
          if (videoData?.download) {
            console.log(`[TIKTOK] ✅ ${api.name} resolved`)
            break
          }
        } catch (e) {
          console.log(`[TIKTOK] ❌ ${api.name}: ${e.message}`)
        }
      }

      if (!videoData?.download) {
        throw new Error('All download sources failed')
      }

      // ── Build info card ──
      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎦 *𝘾𝙔𝘽𝙀𝙍 𝙓 𝙏𝙄𝙆𝙏𝙊𝙆* 🎦
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎬 *Title*    » ${videoData.title}
👤 *Author*   » ${videoData.author}
❤️ *Likes*    » ${fmtNum(videoData.likes)}
👁️ *Views*    » ${fmtNum(videoData.views)}
💬 *Comments* » ${fmtNum(videoData.comments)}
🔗 *Link*     » ${url}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading without watermark...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── Send thumbnail + card ──
      const infoMsg = await (async () => {
        try {
          if (videoData.thumbnail) {
            return await sock.sendMessage(from, {
              image:   { url: videoData.thumbnail },
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
        fileName: `${videoData.title.replace(/[^\w\s-]/g, '').trim() || 'tiktok'}.mp4`,
        caption:  `🎦 *${videoData.title}*\n\n✅ _No watermark_\n\n${CREDIT}`,
      }, { quoted: infoMsg })

      // ── React success ──
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[TIKTOK]', e.message)

      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      const friendly =
        e.message.includes('All download')
          ? '❌ *All sources failed.* The video may be private or deleted. Try another link.'
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
