'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/song.js  —  CYBER X  |  YouTube Audio Downloader
//
// USAGE:
//   .play <song name or YouTube link>
//   .song <song name or YouTube link>
//
// FLOW (matches the Knight Bot Mini "card" style you asked for):
//   1. React with 🎧 headset emoji instantly
//   2. Search YouTube (or use link directly)
//   3. Send thumbnail + info card: title, artist, duration, views, link
//   4. Download via lib/ytdl.js (direct Innertube — no flaky scraper APIs)
//   5. Convert via lib/converter.js (fast streaming path)
//   6. Send final audio, quoting the card message
// ─────────────────────────────────────────────────────────────────────────────

const ytdl  = require('../lib/ytdl')
const { toAudio, detectFormat } = require('../lib/converter')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function fmtViews(n) {
  if (!n) return 'N/A'
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`
  return n.toLocaleString()
}

module.exports = {
  pattern: 'song',
  alias: ['play', 'music', 'yta'],
  category: 'media',
  desc: 'Download audio from YouTube',
  usage: '.song <song name or YouTube link>\n.play <song name or YouTube link>',

  run: async ({ sock, from, msg, args }) => {
    // ── 1. Headset reaction — instant feedback ─────────────────────────────
    sock.sendMessage(from, { react: { text: '🎧', key: msg.key } }).catch(() => {})

    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.play <song name>*\nExample: .play Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const searchMsg = await sock.sendMessage(from, {
      text: `🔎 *Searching:* ${query}...`,
    }, { quoted: msg })

    try {
      // ── 2. Search YouTube directly via Innertube ──────────────────────────
      const v = await ytdl.search(query)

      if (!v) {
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        return sock.sendMessage(from, {
          text: `❌ No results found for *${query}*\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      // ── 3. Build the info card — thumbnail, title, artist, duration, link ──
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
🔗 *Link*     » ${v.url}

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

      // ── 4. Download via Innertube (no third-party scraper APIs needed) ─────
      const raw = await ytdl.download(v.id || v.url, 'audio')
      const { ext } = detectFormat(raw)

      // ── 5. Convert to WhatsApp-compatible MP3 (fast streaming path) ────────
      const audio = await toAudio(raw, ext)

      // ── 6. Send final audio, quoting the card so they stay linked ──────────
      await sock.sendMessage(from, {
        audio,
        mimetype: 'audio/mpeg',
        fileName: `${v.title.replace(/[^\w\s]/g, '').trim()}.mp3`,
        ptt: false,
      }, { quoted: infoMsg })

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[SONG]', e.message)
      await sock.sendMessage(from, {
        text: `❌ *Failed:* ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
