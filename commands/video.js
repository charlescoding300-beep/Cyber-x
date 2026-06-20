'use strict'

const yts = require('yt-search')
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
  pattern: 'video',
  alias: ['ytv', 'ytmp4', 'ytvideo', 'ytvid'],
  category: 'media',
  desc: 'Download video from YouTube',
  usage: '.video <video name or URL>',

  // Independent per call — see note in commands/song.js
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
      const ytId = (ytUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1]
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

      // ── Resolve + download via shared 4-API fallback chain ──────
      // Video is sent as a buffer (not a remote URL passthrough) so
      // a slow/expiring CDN link from the source API can't break the
      // WhatsApp upload — and so we know for certain bytes arrived.
      const { buffer, title } = await downloadMedia(ytUrl, 'mp4')

      // ── Send immediately the moment it's ready ───────────────────
      const safeName = (title || v.title || 'video').replace(/[^\w\s]/g, '').trim()
      await sock.sendMessage(from, {
        video: buffer,
        mimetype: 'video/mp4',
        fileName: `${safeName}.mp4`,
        caption: `🎬 *${title || v.title}*\n\n${CREDIT}`,
      }, { quoted: msg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[VIDEO]', e.message)
      await sock.sendMessage(from, {
        text: `${friendlyError(e)}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
