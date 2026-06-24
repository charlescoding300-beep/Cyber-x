/**
 * CYBER X — commands/lyrics.js
 * Category: general — everyone can use this
 */

const fetch = require("node-fetch")

module.exports = {
  pattern:  "lyrics",
  alias:    ["lyric", "lyr"],
  category: "general",
  desc:     "Get lyrics for any song",
  usage:    ".lyrics <song name>",

  run: async ({ sock, from, msg, args, text }) => {
    // 📝 reaction on trigger
    await sock.sendMessage(from, {
      react: { text: "📝", key: msg.key }
    })

    if (!text) {
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   📝  *LYRICS*            ║\n` +
          `╚══════════════════════════╝\n\n` +
          `🔍 Please enter a song name!\n\n` +
          `*Usage:* .lyrics <song name>\n` +
          `*Example:* .lyrics Blinding Lights\n\n` +
          `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
      }, { quoted: msg })
    }

    const songTitle = text.trim()

    try {
      const apiUrl = `https://lyricsapi.fly.dev/api/lyrics?q=${encodeURIComponent(songTitle)}`
      const res = await fetch(apiUrl)

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(errText)
      }

      const data = await res.json()
      const lyrics = data?.result?.lyrics || null

      if (!lyrics) {
        return sock.sendMessage(from, {
          text:
            `╔══════════════════════════╗\n` +
            `║   📝  *LYRICS*            ║\n` +
            `╚══════════════════════════╝\n\n` +
            `❌ No lyrics found for *"${songTitle}"*\n\n` +
            `Try a different song name or spelling.\n\n` +
            `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
        }, { quoted: msg })
      }

      const header =
        `╔══════════════════════════╗\n` +
        `║   📝  *LYRICS*            ║\n` +
        `╚══════════════════════════╝\n\n` +
        `🎵 *${songTitle}*\n` +
        `─────────────────────────\n\n`

      const footer = `\n\n─────────────────────────\n_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`

      const maxChars = 4096 - header.length - footer.length
      const body = lyrics.length > maxChars ? lyrics.slice(0, maxChars - 3) + "..." : lyrics

      await sock.sendMessage(from, {
        text: header + body + footer
      }, { quoted: msg })

    } catch (error) {
      console.error("[lyrics] error:", error.message)
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   📝  *LYRICS*            ║\n` +
          `╚══════════════════════════╝\n\n` +
          `❌ Failed to fetch lyrics for *"${songTitle}"*\n\n` +
          `Please try again later.\n\n` +
          `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
      }, { quoted: msg })
    }
  }
}
