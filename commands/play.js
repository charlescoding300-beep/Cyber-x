'use strict'

const { searchTrack, downloadAudio } = require('../lib/play')

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
  pattern: 'play',

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(' ').trim()

    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.play <song name>*\nExample: .play Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── 1. Send searching message ────────────────────────────────
    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 2. Search YouTube ──────────────────────────────────────
      const results = await searchTrack(query, 1)

      // ── 3. Delete searching message ────────────────────────────
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      if (!results.length) {
        return sock.sendMessage(from, {
          text: `❌ No results found for *${query}*\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      const v     = results[0]
      const ytUrl = `https://youtu.be/${v.videoId}`

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${v.title}
🎤 *Artist*   » ${v.author.name}
⏱️ *Duration* » ${fmtDuration(v.duration.seconds)}
👁️ *Views*    » ${fmtViews(v.views)}
📅 *Uploaded* » ${v.ago}
📺 *Platform* » YouTube
🔗 *Link*     » ${ytUrl}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading audio...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
${CREDIT}`

      // ── 4. Send thumbnail + card ───────────────────────────────
      const infoMsg = await (async () => {
        try {
          if (v.thumb) {
            return await sock.sendMessage(from, {
              image:   { url: v.thumb },
              caption: card,
            }, { quoted: msg })
          }
        } catch {}
        return sock.sendMessage(from, { text: card }, { quoted: msg })
      })()

      // ── 5. Download audio (parallel starts here) ───────────────
      const audio = await downloadAudio(v.videoId)

      // ── 6. Send audio immediately ──────────────────────────────
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mp4',
        ptt:      false,
      }, { quoted: infoMsg })

    } catch (e) {
      // Clean up searching message on error too
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[PLAY]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Error:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
