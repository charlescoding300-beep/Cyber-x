// ═══════════════════════════════════════════════════════════════
// commands/video.js — CYBER X VIDEO COMMAND
// Searches YouTube and sends video to WhatsApp
//
// Usage:
//   .video <title>          → 480p (default)
//   .video <title> 360      → 360p (smaller)
//   .video <title> 720      → 720p (larger)
//   .video <URL>            → direct URL download
// ═══════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "video",
  desc:     "Download and send video from YouTube or any platform",
  category: "media",

  async run({ sock, from, msg, text, args, lib }) {

    if (!text) {
      return sock.sendMessage(from, {
        text:
`🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓 VIDEO*

Usage:
• *.video <title>*             → 480p
• *.video <title> 360*         → 360p (smaller)
• *.video <title> 720*         → 720p (larger)
• *.video <YouTube URL>*       → direct URL

Examples:
  *.video Starboy Weeknd*
  *.video Starboy Weeknd 360*
  *.video https://youtu.be/xxxx*`,
        quoted: msg
      })
    }

    // ── Check if last arg is a quality number ──
    const QUALITIES = ["360", "480", "720", "1080"]
    let quality = "480"
    let query   = text

    const lastArg = args[args.length - 1]
    if (QUALITIES.includes(lastArg)) {
      quality = lastArg
      query   = args.slice(0, -1).join(" ")
    }

    if (!query.trim()) {
      return sock.sendMessage(from, {
        text: "❌ *Please provide a video title or URL.*",
        quoted: msg
      })
    }

    // ── React ⏳ ──
    await sock.sendMessage(from, {
      react: { text: "⏳", key: msg.key }
    })

    let notif = null

    try {
      const dl = lib.download || lib

      // ── Searching message ──
      notif = await sock.sendMessage(from, {
        text: `🔍 *Searching:* _${query}_ *(${quality}p)*...`,
        quoted: msg
      })

      // ── Download ──
      const { buffer, info, size } = await dl.downloadVideo(query, quality)

      const dur   = dl.formatDuration(info.duration)
      const sz    = dl.formatSize(size)
      const views = dl.formatViews(info.views)

      const caption =
`🎬 *${info.title}*

┌─────〔 🎞️ *VIDEO INFO* 〕─────
│ 👤 *Channel:*  ${info.uploader}
│ ⏱️ *Duration:* ${dur}
│ 📦 *Size:*     ${sz}
│ 👁️ *Views:*    ${views}
│ 🎯 *Quality:*  ${quality}p
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

      // ── Delete searching message ──
      if (notif) {
        await sock.sendMessage(from, { delete: notif.key }).catch(() => {})
        notif = null
      }

      // ── Send video ──
      await sock.sendMessage(from, {
        video:    buffer,
        mimetype: "video/mp4",
        caption:  caption,
        fileName: `${info.title.replace(/[^\w\s]/g, "")}.mp4`,
      }, { quoted: msg })

      // ── React ✅ ──
      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      })

    } catch (err) {
      if (notif) {
        await sock.sendMessage(from, { delete: notif.key }).catch(() => {})
      }

      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      })

      // ── Suggest lower quality if too large ──
      const isSize = err.message.includes("too large")
      const tip = isSize
        ? `\n│ 💡 *Try:* .video ${query} 360`
        : `\n│ 💡 Try a different title or URL`

      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ❌ *VIDEO FAILED* ║
╚════════════════════╝

┌─────〔 ⚠️ *ERROR* 〕─────
│ ${err.message}${tip}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }
  }
}
