// commands/play.js — CYBER X Play Command (Powerful Standalone)
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
    const r = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: HEADERS, validateStatus: s => s >= 200 && s < 400
    })
    return Buffer.from(r.data)
  } catch {
    const r = await axios.get(url, {
      responseType: 'stream', timeout: 90000,
      maxContentLength: Infinity, maxBodyLength: Infinity,
      headers: HEADERS, validateStatus: s => s >= 200 && s < 400
    })
    const chunks = []
    await new Promise((res, rej) => {
      r.data.on('data', c => chunks.push(c))
      r.data.on('end', res)
      r.data.on('error', rej)
    })
    return Buffer.concat(chunks)
  }
}

// ── More download sources than song.js ──
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
  {
    name: 'Y2Mate',
    get: async (url) => {
      const r = await tryGet(() => axios.post(
        'https://www.y2mate.com/mates/analyzeV2/ajax',
        `k_query=${encodeURIComponent(url)}&k_page=home&hl=en&q_auto=0`,
        { timeout: 30000, headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } }
      ))
      const vid = r?.data?.vid
      if (!vid) throw new Error('No vid')
      const r2 = await tryGet(() => axios.post(
        'https://www.y2mate.com/mates/convertV2/index',
        `vid=${vid}&k=140`,
        { timeout: 30000, headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } }
      ))
      if (r2?.data?.dlink) return r2.data.dlink
      throw new Error('No URL')
    }
  },
  {
    name: 'Cobalt',
    get: async (url) => {
      const r = await tryGet(() => axios.post(
        'https://api.cobalt.tools/',
        { url, isAudioOnly: true, filenamePattern: 'basic' },
        { timeout: 30000, headers: { ...HEADERS, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
      ))
      if (r?.data?.url) return r.data.url
      throw new Error('No URL')
    }
  },
  {
    name: 'SaveFrom',
    get: async (url) => {
      const r = await tryGet(() => axios.get(
        `https://worker.savefrom.net/api/convert?url=${encodeURIComponent(url)}&audio=true`,
        { timeout: 30000, headers: HEADERS }
      ))
      const link = r?.data?.url || r?.data?.data?.url
      if (link) return link
      throw new Error('No URL')
    }
  },
]

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`
  return n.toLocaleString()
}

async function downloadMp3(ytUrl) {
  for (const api of MP3_APIS) {
    try {
      console.log(`[PLAY] Trying ${api.name}...`)
      const dlUrl = await api.get(ytUrl)
      const buf   = await fetchBuffer(dlUrl)
      if (buf?.length > 10000) {
        console.log(`[PLAY] ✅ ${api.name} (${(buf.length/1e6).toFixed(1)}MB)`)
        return { buf, source: api.name }
      }
    } catch (e) { console.log(`[PLAY] ❌ ${api.name}: ${e.message}`) }
  }
  throw new Error('All download sources failed — try again later')
}

// ── Smarter search — tries multiple results ──
async function smartSearch(query) {
  const isUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(query)
  if (isUrl) {
    const r = await yts({ videoId: query.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1] || '' })
    if (r?.title) return r
  }
  const search = await yts(query)
  if (!search?.videos?.length) throw new Error(`No results found for "${query}"`)

  // pick best result — prefer official/topic channels
  const best = search.videos.find(v =>
    v.author?.name?.toLowerCase().includes('topic') ||
    v.author?.name?.toLowerCase().includes('official') ||
    v.author?.verified
  ) || search.videos[0]

  return best
}

module.exports = {
  pattern:  'play',
  alias:    ['music', 'mp3'],
  desc:     'Search and download music from YouTube',
  usage:    '.play <song name or YouTube link>',
  category: 'download',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🎵 *CYBER X MUSIC*       ║
╚═══════════════════════════╝

*How to use:*
• *.play <song name>* — Search and download
• *.play <YouTube link>* — Direct download
• *.music <song name>* — Also works
• *.mp3 <song name>* — Also works

💡 *Examples:*
  _.play Burna Boy Last Last_
  _.play Wizkid Essence_
  _.play https://youtu.be/xxxxx_

${CREDIT}`,
        quoted: msg
      })
    }

    // ── React immediately ──
    sock.sendMessage(from, {
      react: { text: '🎧', key: msg.key }
    }).catch(() => {})

    // ── Send searching message ──
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* _${query}_...`,
    }, { quoted: msg })

    try {
      // ── Smart search ──
      const v = await smartSearch(query)

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓 𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${v.title}
🎤 *Artist*   » ${v.author?.name || 'Unknown'}
⏱️ *Duration* » ${v.timestamp || 'N/A'}
👁️ *Views*    » ${fmtViews(v.views)}
📅 *Uploaded* » ${v.ago || 'N/A'}
📺 *Platform* » YouTube
🔗 *Link*     » ${v.url}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading audio...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── Send thumbnail + card ──
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

      // ── Delete search message ──
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── Download ──
      const { buf, source } = await downloadMp3(v.url)
      const { ext } = detectFormat(buf)
      const audio   = await toAudio(buf, ext)

      // ── Send audio ──
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${v.title.replace(/[^\w\s]/g, '').trim()}.mp3`,
        ptt: false,
      }, { quoted: infoMsg })

      // ── React success ──
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

      console.log(`[PLAY] ✅ Sent "${v.title}" via ${source}`)

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[PLAY]', e.message)

      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      await sock.sendMessage(from, {
        text: `❌ *Failed:* ${e.message}\n\nTry a different song name or YouTube link.\n\n${CREDIT}`,
        quoted: msg
      })
    }
  }
}
