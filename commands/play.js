// ═══════════════════════════════════════════════════════════════
// commands/play.js — CYBER X PLAY COMMAND
// Searches YouTube (or any platform) and sends audio to WhatsApp
//
// Usage:
//   .play <song name>
//   .play <YouTube / SoundCloud / any URL>
// ═══════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "play",
  desc:     "Download and send audio from YouTube or any platform",
  category: "media",

  async run({ sock, from, msg, text, lib }) {

    if (!text) {
      return sock.sendMessage(from, {
        text:
`🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓 PLAY*

Usage:
• *.play <song name>*
• *.play <YouTube URL>*
• *.play <SoundCloud / any URL>*

Examples:
  *.play Blinding Lights*
  *.play https://youtu.be/xxxx*`,
        quoted: msg
      })
    }

    // ── React ⏳ to show bot is working ──
    await sock.sendMessage(from, {
      react: { text: "⏳", key: msg.key }
    })

    let notif = null

    try {
      const dl = lib.download || lib

      // ── Send searching message ──
      notif = await sock.sendMessage(from, {
        text: `🔍 *Searching:* _${text}_...`,
        quoted: msg
      })

      // ── Search & download ──
      const { buffer, info, size } = await dl.downloadAudio(text)

      const dur  = dl.formatDuration(info.duration)
      const sz   = dl.formatSize(size)
      const views = dl.formatViews(info.views)

      const caption =
`🎵 *${info.title}*

┌─────〔 📀 *TRACK INFO* 〕─────
│ 👤 *Artist:*   ${info.uploader}
│ ⏱️ *Duration:* ${dur}
│ 📦 *Size:*     ${sz}
│ 👁️ *Views:*    ${views}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

      // ── Delete the searching message ──
      if (notif) {
        await sock.sendMessage(from, { delete: notif.key }).catch(() => {})
        notif = null
      }

      // ── Send audio ──
      await sock.sendMessage(from, {
        audio:    buffer,
        mimetype: "audio/mpeg",
        fileName: `${info.title.replace(/[^\w\s]/g, "")}.mp3`,
        ptt:      false,
      }, { quoted: msg })

      // ── Send info caption ──
      await sock.sendMessage(from, {
        text: caption,
        quoted: msg
      })

      // ── React ✅ ──
      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      })

    } catch (err) {
      // Clean up notif if still there
      if (notif) {
        await sock.sendMessage(from, { delete: notif.key }).catch(() => {})
      }

      // React ❌
      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      })

      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ❌ *PLAY FAILED*  ║
╚════════════════════╝

┌─────〔 ⚠️ *ERROR* 〕─────
│ ${err.message}
└──────────────────────────
💡 Try a different song name or URL
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }
  }
}
