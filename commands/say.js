// CYBER X SAY — USA FEMALE VOICE (EDGE TTS)

const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")
const util = require("util")

const execAsync = util.promisify(exec)

const TMP = path.join(process.cwd(), "tmp", "cyberx")

if (!fs.existsSync(TMP)) {
  fs.mkdirSync(TMP, { recursive: true })
}

module.exports = {
  pattern: "say",

  run: async ({ sock, from, msg, args }) => {
    const text = args.join(" ").trim()

    if (!text) {
      return sock.sendMessage(from, {
        text: "❌ Usage: .say <text>"
      }, { quoted: msg })
    }

    const file = path.join(TMP, `${Date.now()}.mp3`)

    try {
      // 🇺🇸 USA FEMALE VOICE (GEMINI-LIKE STYLE)
      await execAsync(
        `npx edge-tts --text "${text}" --voice en-US-JennyNeural --write-media "${file}"`
      )

      const audio = fs.readFileSync(file)

      await sock.sendMessage(from, {
        audio,
        mimetype: "audio/mpeg",
        ptt: true
      }, { quoted: msg })

      fs.unlinkSync(file)

    } catch (err) {
      console.log("TTS ERROR:", err.message)

      await sock.sendMessage(from, {
        text: "❌ Voice failed. Try again."
      }, { quoted: msg })
    }
  }
}
