// CYBER X AI — VIDEO COMMAND (RENDER STABLE + FAST)

const fs = require("fs")
const path = require("path")
const axios = require("axios")
const { exec } = require("child_process")
const util = require("util")

const execAsync = util.promisify(exec)

const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"

// ───── SAFE TEMP DIR ─────
const TMP = path.join(process.cwd(), "tmp", "cyberx")

if (!fs.existsSync(TMP)) {
  fs.mkdirSync(TMP, { recursive: true })
}

// ───── HELPERS ─────
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
      timeout: 8000
    })
    return Buffer.from(res.data)
  } catch {
    return null
  }
}

// ───── MAIN COMMAND ─────
module.exports = {
  pattern: "video",

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(" ").trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
`🎬 𝘾𝙔𝘽𝙀𝙍 𝙓  VIDEO

.video <name>

Example:
• .video Burna Boy Last Last
• .video Ronaldo skills
• .video Funny cats

> ${CREDIT}`
      }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      text:
`⚡ 𝘾𝙔𝘽𝙀𝙍 𝙓  decrypting...🦠
🔍 Searching: ${query}`
    }, { quoted: msg })

    const file = path.join(TMP, `${Date.now()}_${cleanName(query)}.mp4`)

    try {
      // ───── DIRECT DOWNLOAD (FAST + NO PRESEARCH CRASH) ─────
      const cmd =
        `yt-dlp "ytsearch1:${query}" ` +
        `-f "bv*+ba/best" ` +
        `--merge-output-format mp4 ` +
        `--no-playlist --no-warnings ` +
        `-o "${file}"`

      await execAsync(cmd)

      if (!fs.existsSync(file)) {
        throw new Error("Video file not created")
      }

      const stat = fs.statSync(file)

      // safety: avoid huge files crashing Render
      if (stat.size > 45 * 1024 * 1024) {
        fs.unlinkSync(file)

        return sock.sendMessage(from, {
          text: "❌ Video too large (limit 45MB)"
        }, { quoted: msg })
      }

      const buffer = fs.readFileSync(file)

      await sock.sendMessage(from, {
        video: buffer,
        mimetype: "video/mp4",
        caption:
`🎬 𝘾𝙔𝘽𝙀𝙍 𝙓  VIDEO

${query}

> ${CREDIT}`
      }, { quoted: msg })

      fs.unlinkSync(file)

    } catch (e) {
      console.log("VIDEO ERROR:", e.message)

      try {
        if (fs.existsSync(file)) fs.unlinkSync(file)
      } catch {}

      await sock.sendMessage(from, {
        text:
`❌ VIDEO FAILED

Query: ${query}

Try shorter or different video`
      }, { quoted: msg })
    }
  }
}
