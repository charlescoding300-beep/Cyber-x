// commands/instagram.js — CYBER X Instagram Downloader
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

// ── Instagram URL validator ──
const IG_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[\w-]+/i

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

// ── API #1 — Yupra ────────────────────────────────────────────────
async function getYupra(url) {
  const res = await tryRequest(() => axios.get(
    `https://api.yupra.my.id/api/downloader/instagram?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data?.data
  if (data?.video || data?.download_url) {
    return {
      download:  data.video || data.download_url,
      title:     data.title    || 'Instagram Video',
      author:    data.author   || 'Unknown',
      thumbnail: data.thumbnail || data.cover || null,
      likes:     data.likes    || 0,
      type:      data.type     || 'video',
    }
  }
  throw new Error('Yupra Instagram returned no download')
}

// ── API #2 — Okatsu ───────────────────────────────────────────────
async function getOkatsu(url) {
  const res = await tryRequest(() => axios.get(
    `https://okatsu-rolezapiiz.vercel.app/downloader/instagram?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data
  if (data?.dl || data?.download || data?.result?.download) {
    return {
      download:  data.dl || data.download || data.result?.download,
      title:     data.title  || data.result?.title  || 'Instagram Video',
      author:    data.author || data.result?.author || 'Unknown',
      thumbnail: data.thumb  || data.result?.thumb  || null,
      type:      'video',
    }
  }
  throw new Error('Okatsu Instagram returned no download')
}

// ── API #3 — EliteProTech ─────────────────────────────────────────
async function getEliteProTech(url) {
  const res = await tryRequest(() => axios.get(
    `https://eliteprotech-apis.zone.id/igdl?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data
  if (data?.success && (data?.downloadURL || data?.video)) {
    return {
      download:  data.downloadURL || data.video,
      title:     data.title  || 'Instagram Video',
      author:    data.author || 'Unknown',
      thumbnail: data.thumbnail || data.cover || null,
      likes:     data.likes  || 0,
      type:      'video',
    }
  }
  throw new Error('EliteProTech Instagram returned no download')
}

// ── API #4 — SaveIG ───────────────────────────────────────────────
async function getSaveIG(url) {
  const res = await tryRequest(() => axios.post(
    'https://saveig.app/api/ajaxSearch',
    new URLSearchParams({ q: url, t: 'media', lang: 'en' }).toString(),
    {
      ...AXIOS_DEFAULTS,
      headers: {
        ...AXIOS_DEFAULTS.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://saveig.app/',
      }
    }
  ))
  const html  = res?.data?.data || ''
  const match = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/)
  if (match?.[1]) {
    return {
      download:  match[1],
      title:     'Instagram Video',
      author:    'Unknown',
      thumbnail: null,
      type:      'video',
    }
  }
  throw new Error('SaveIG returned no download')
}

// ── API #5 — SnapSave ─────────────────────────────────────────────
async function getSnapSave(url) {
  const res = await tryRequest(() => axios.post(
    'https://snapsave.app/action.php',
    new URLSearchParams({ url }).toString(),
    {
      ...AXIOS_DEFAULTS,
      headers: {
        ...AXIOS_DEFAULTS.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://snapsave.app/',
      }
    }
  ))
  const html  = res?.data || ''
  const match = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/)
  if (match?.[1]) {
    return {
      download:  match[1],
      title:     'Instagram Video',
      author:    'Unknown',
      thumbnail: null,
      type:      'video',
    }
  }
  throw new Error('SnapSave returned no download')
}

// ── API #6 — Keith ────────────────────────────────────────────────
async function getKeith(url) {
  const res = await tryRequest(() => axios.get(
    `https://apis-keith.vercel.app/download/instagram?url=${encodeURIComponent(url)}`,
    AXIOS_DEFAULTS
  ))
  const data = res?.data
  if (data?.status && (data?.result?.downloadUrl || data?.result?.url)) {
    return {
      download:  data.result.downloadUrl || data.result.url,
      title:     data.result.title  || 'Instagram Video',
      author:    data.result.author || 'Unknown',
      thumbnail: data.result.thumbnail || null,
      type:      'video',
    }
  }
  throw new Error('Keith Instagram returned no download')
}

function fmtNum(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

const command = {
  pattern:  'instagram',
  alias:    ['ig', 'igdl', 'insta', 'reel'],
  category: 'download',
  desc:     'Download Instagram videos and reels without watermark',
  usage:    '.instagram <Instagram link>',

  run: async ({ sock, from, msg, args, text }) => {

    // ── React immediately ──
    sock.sendMessage(from, { react: { text: '📸', key: msg.key } }).catch(() => {})

    const url = (text || args.join(' ')).trim()

    if (!url) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  📸 *𝘾𝙔𝘽𝙀𝙍 𝙓 𝙄𝙉𝙎𝙏𝘼𝙂𝙍𝘼𝙈*   ║
╚═══════════════════════════╝

*How to use:*
• *.instagram <link>* — Download
• *.ig <link>* — Also works
• *.reel <link>* — Also works
• *.insta <link>* — Also works

💡 *Supported link formats:*
  _https://www.instagram.com/p/xxxxx/_
  _https://www.instagram.com/reel/xxxxx/_
  _https://www.instagram.com/tv/xxxxx/_

✅ *Downloads WITHOUT watermark!*

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Validate Instagram URL ──
    if (!IG_REGEX.test(url)) {
      return sock.sendMessage(from, {
        text:
`❌ *Invalid Instagram link!*

*Supported formats:*
• https://www.instagram.com/p/xxxxx/
• https://www.instagram.com/reel/xxxxx/
• https://www.instagram.com/tv/xxxxx/

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send searching message ──
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Fetching Instagram content...*`,
    }, { quoted: msg })

    try {
      // ── Try all APIs in order ──
      const APIs = [
        { name: 'Yupra',        method: () => getYupra(url)        },
        { name: 'Okatsu',       method: () => getOkatsu(url)       },
        { name: 'EliteProTech', method: () => getEliteProTech(url) },
        { name: 'Keith',        method: () => getKeith(url)        },
        { name: 'SaveIG',       method: () => getSaveIG(url)       },
        { name: 'SnapSave',     method: () => getSnapSave(url)     },
      ]

      let videoData = null

      for (const api of APIs) {
        try {
          videoData = await api.method()
          if (videoData?.download) {
            console.log(`[INSTAGRAM] ✅ ${api.name} resolved`)
            break
          }
        } catch (e) {
          console.log(`[INSTAGRAM] ❌ ${api.name}: ${e.message}`)
        }
      }

      if (!videoData?.download) {
        throw new Error('All download sources failed')
      }

      // ── Build info card ──
      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
  📸 𝘾𝙔𝘽𝙀𝙍 𝙓 𝙄𝙉𝙎𝙏𝘼𝙂𝙍𝘼𝙈 📸 
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎬 *Title*    » ${videoData.title}
👤 *Author*   » ${videoData.author}
❤️ *Likes*    » ${fmtNum(videoData.likes)}
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
        fileName: `${(videoData.title || 'instagram').replace(/[^\w\s-]/g, '').trim()}.mp4`,
        caption:  `📸 *${videoData.title}*\n\n✅ _No watermark_\n\n${CREDIT}`,
      }, { quoted: infoMsg })

      // ── React success ──
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[INSTAGRAM]', e.message)

      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      const friendly =
        e.message.includes('All download')
          ? '❌ *All sources failed.* Post may be private or deleted. Try another link.'
        : e.message.includes('blocked')
          ? '❌ *Download blocked.* Post may be restricted.'
        : e.message.includes('private')
          ? '❌ *Private account.* Only public posts can be downloaded.'
          : `❌ *Failed:* ${e.message}`

      await sock.sendMessage(from, {
        text: `${friendly}\n\n${CREDIT}`,
        quoted: msg
      })
    }
  }
}

module.exports = command
