// CYBER X AI — PLAY COMMAND (FAST CYBER EDITION)

const fs = require("fs")
const path = require("path")
const axios = require("axios")
const ytdlp = require("yt-dlp-exec")

const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"
const TMP = path.join(process.cwd(), "tmp", "cyberx")

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

function cleanName(str = "") {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)
}

function formatDuration(sec = 0) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

async function getThumb(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000
    })
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
`╔═══〔 🎵 𝘾𝙔𝘽𝙀𝙍 𝙓  PLAY 〕═══╗

.play <song name>

Examples:
• .play Burna Boy Last Last
• .play Drake One Dance
• .play Asake Lonely At The Top

╚══════════════════════╝
> ${CREDIT}`
      }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      text:
`⚡ 𝘾𝙔𝘽𝙀𝙍 𝙓  decrypting...🖕
🔍 Searching: ${query}
⏳ Please wait...`
    }, { quoted: msg })

    try {

      // ───── FIX 1: safer search (prevents crash JSON parse issues)
      const info = await ytdlp(`ytsearch1:${query}`, {
        dumpSingleJson: true,
        noPlaylist: true,
        quiet: true,
        defaultSearch: "ytsearch1"
      })

      if (!info || !info.title) {
        throw new Error("No video found")
      }

      const title = info.title || query
      const url = info.webpage_url || info.url
      const duration = info.duration || 0

      if (duration > 600) {
        return sock.sendMessage(from, {
          text:
`❌ 𝘾𝙔𝘽𝙀𝙍 𝙓  LIMIT ERROR
Song too long (max 10 min)

🎵 ${title}`
        }, { quoted: msg })
      }

      // ───── FIX 2: thumbnail safety + faster response
      let thumb = null
      if (info.thumbnail) {
        thumb = await getThumb(info.thumbnail)
      }

      if (thumb) {
        await sock.sendMessage(from, {
          image: thumb,
          caption:
`╔═══〔 🎧 𝘾𝙔𝘽𝙀𝙍 𝙓  MUSIC 〕═══╗

🎵 Title: ${title}
⏱ Duration: ${formatDuration(duration)}

⚡ Downloading audio...

╚══════════════════════╝
> ${CREDIT}`
        }, { quoted: msg })
      }

      const file = path.join(TMP, `${Date.now()}_${cleanName(title)}.mp3`)

      // ───── FIX 3: more stable download flags for Render
      await ytdlp(url, {
        extractAudio: true,
        audioFormat: "mp3",
        audioQuality: 0,
        output: file,
        noWarnings: true,
        noPlaylist: true,
        quiet: true,
        retries: 3
      })

      if (!fs.existsSync(file)) {
        throw new Error("Download failed")
      }

      const audio = fs.readFileSync(file)

      await sock.sendMessage(from, {
        audio,
        mimetype: "audio/mpeg",
        ptt: false,
        fileName: `${title}.mp3`
      }, { quoted: msg })

      fs.unlinkSync(file)

    } catch (e) {
      console.log("𝘾𝙔𝘽𝙀𝙍 𝙓  PLAY ERROR:", e.message)

      await sock.sendMessage(from, {
        text:
`❌ CYBER ENGINE FAILED

Try again or use another song
Query: ${query}`
      }, { quoted: msg })
    }
  }
}
