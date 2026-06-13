'use strict'

const { searchVideo, downloadVideo } = require('../lib/video')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function fmtDuration(sec) {
  if (!sec) return 'N/A'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtViews(raw) {
  if (!raw) return 'N/A'
  const n = parseInt(raw.toString().replace(/[^0-9]/g, ''))
  if (isNaN(n)) return raw
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B 🔥`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M 🔥`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern: 'video',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()

    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.video <title>*\nExample: .video Starboy Weeknd\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── 1. Send searching message ────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 2. Search YouTube ──────────────────────────────────────
      const results = await searchVideo(query, 1)

      // ── 3. Delete searching message ────────────────────────────
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      if (!results.length) {
        return sock.sendMessage(from, {
          text: `❌ No results found for *${query}*\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      const v     = results[0]
      const ytUrl = `https://youtu.be/${v.id}`

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙑𝙄𝘿𝙀𝙊* 🎬
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎞️ *Title*    » ${v.title.text || v.title}
📺 *Channel*  » ${v.author?.name || 'N/A'}
⏱️ *Duration* » ${fmtDuration(v.duration?.seconds)}
👁️ *Views*    » ${fmtViews(v.view_count?.text)}
📅 *Uploaded* » ${v.published?.text || 'N/A'}
🔗 *Link*     » ${ytUrl}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading video...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── 4. Send thumbnail + card ───────────────────────────────
      const thumb = v.thumbnails?.[v.thumbnails.length - 1]?.url

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

      // ── 5. Download video buffer ───────────────────────────────
      const buffer = await downloadVideo(v.id)

      // ── 6. Send video ──────────────────────────────────────────
      await sock.sendMessage(from, {
        video:    buffer,
        mimetype: 'video/mp4',
        caption:  CREDIT,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[VIDEO]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Error:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
