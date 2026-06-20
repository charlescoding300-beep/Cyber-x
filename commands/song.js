'use strict'

const yts = require('yt-search')
const { toAudio, detectFormat } = require('../lib/converter')
const { downloadMedia, friendlyError } = require('../lib/ytdownload')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern: 'song',
  alias: ['play', 'music', 'yta'],
  category: 'media',
  desc: 'Download audio from YouTube',
  usage: '.song <song name or YouTube link>',

  // NOTE: this run() is called independently per session, per user,
  // per message. Nothing here is shared state between calls except
  // the download fallback chain and the ffmpeg concurrency limiter
  // in lib/converter.js — both of which are designed to be safely
  // hit by many simultaneous callers without blocking each other.
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

      // ── Resolve + download via shared 4-API fallback chain ──────
      const { buffer: raw, title } = await downloadMedia(ytUrl, 'mp3')

      // ── Convert (goes through the shared, concurrency-capped
      //    ffmpeg queue in lib/converter.js — safe under multi-user
      //    multi-session load on Render free tier) ──────────────
      const { ext } = detectFormat(raw)
      const audio = await toAudio(raw, ext)

      // ── Send immediately the moment it's ready, no extra delay ──
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${(title || v.title || 'song').replace(/[^\w\s]/g, '').trim()}.mp3`,
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
