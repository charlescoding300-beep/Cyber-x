// commands/play.js — CYBER X Music
const { searchTrack, downloadAudio, parseDuration } = require("../lib/play")
const axios = require("axios")

const CREDIT = "> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™"

function fmtViews(n) {
  if (!n) return "N/A"
  const num = parseInt(n.toString().replace(/,/g, ""))
  if (isNaN(num)) return "N/A"
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B 👑`
  if (num >= 1_000_000)     return `${(num / 1_000_000).toFixed(1)}M 🔥`
  if (num >= 1_000)         return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

function fmtDuration(dur) {
  if (!dur) return "N/A"
  if (typeof dur === "string") return dur
  if (typeof dur === "object" && dur.timestamp) return dur.timestamp
  const s   = Math.floor(typeof dur === "number" ? dur : 0)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`
}

async function fetchThumb(video) {
  const url =
    video.bestThumbnail?.url   ||
    video.thumbnails?.[0]?.url ||
    (video.videoId ? `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg` : null) ||
    (video.id      ? `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`      : null)

  if (!url) return null
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 8000 })
    return Buffer.from(res.data)
  } catch {
    return null
  }
}

module.exports = {
  pattern: "play",

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(" ").trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

📌 *Usage:* .play <song name>

💡 *Examples:*
  • .play Juice WRLD All Girls Are The Same
  • .play Eminem Lose Yourself
  • .play lo-fi chill beats

${CREDIT}`
      }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      react: { text: "🎵", key: msg.key }
    }).catch(() => {})

    const searching = await sock.sendMessage(from, {
      text: `🔎 *Searching:* _${query}_...\n\n${CREDIT}`
    }, { quoted: msg })

    const deleteSearching = () => {
      if (searching) sock.sendMessage(from, { delete: searching.key }).catch(() => {})
    }

    try {
      await sock.sendPresenceUpdate("composing", from)

      const results = await searchTrack(query)

      if (!results.length) {
        deleteSearching()
        return sock.sendMessage(from, {
          text: `❌ *No results found for:*\n"${query}"\n\nTry a different name.\n\n${CREDIT}`
        }, { quoted: msg })
      }

      const video = results[0]
      const id    = video.videoId || video.id

      if (parseDuration(video.duration) > 600) {
        deleteSearching()
        return sock.sendMessage(from, {
          text:
`⚠️ *Track Too Long*

🎵 ${video.title}
⏱️ ${fmtDuration(video.duration)}
🚫 Max: *10:00*

Try a shorter track.

${CREDIT}`
        }, { quoted: msg })
      }

      // Fetch thumbnail in background
      const thumbPromise = fetchThumb(video)

      const infoCard =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${video.title}
🎤 *Artist*   » ${video.author?.name || video.author || "Unknown"}
⏱️ *Duration* » ${fmtDuration(video.duration)}
👁️ *Views*    » ${fmtViews(video.views)}
📅 *Uploaded* » ${video.ago || video.uploadedAt || "N/A"}
📺 *Platform* » YouTube
🔗 *Link*     » https://youtu.be/${id}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading & converting...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${CREDIT}`

      const thumb = await thumbPromise
      deleteSearching()

      if (thumb) {
        await sock.sendMessage(from, {
          image:   thumb,
          caption: infoCard
        }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: infoCard }, { quoted: msg })
      }

      // Warn after 25s if still processing
      const slowWarn = setTimeout(() => {
        sock.sendMessage(from, {
          text: `⏳ *Still converting...*\nAlmost ready!\n\n${CREDIT}`
        }, { quoted: msg }).catch(() => {})
      }, 25_000)

      let audioBuffer
      try {
        audioBuffer = await downloadAudio(id)
      } finally {
        clearTimeout(slowWarn)
      }

      console.log(`[play] 📤 Sending ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB to ${from}`)

      // ── Send as WhatsApp audio player (ogg opus) ──
      await sock.sendMessage(from, {
        audio:    audioBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt:      false,
        ...(thumb && { jpegThumbnail: thumb })
      }, { quoted: msg })

      console.log(`[play] ✅ Sent successfully`)

      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      }).catch(() => {})

    } catch (e) {
      console.error("[play] ERROR:", e.message)
      deleteSearching()

      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})

      const friendly =
        e.message.includes("429") || e.message.includes("rate")
          ? `⚠️ *Rate Limited*\nWait 30s and retry.`
        : e.message.includes("unavailable") || e.message.includes("private")
          ? `❌ *Video Unavailable*\nTry a different song.`
        : e.message.includes("too long") || e.message.includes("duration")
          ? `⚠️ *Track too long.* Max 10 minutes.`
          : `⚠️ *Error:* ${e.message}\n\nTry again.`

      await sock.sendMessage(from, {
        text: `${friendly}\n\n${CREDIT}`
      }, { quoted: msg })
    }
  }
}
