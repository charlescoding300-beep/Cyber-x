// commands/say.js — CYBER X CLEAN COMMAND

const fs = require("fs")
const { say } = require("../lib/say")

module.exports = {
  pattern: "say",

  run: async ({ sock, from, msg, args }) => {

    const text = args.join(" ").trim()

    if (!text) {
      return sock.sendMessage(from, {
        text: "❌ Usage: .say <text>"
      }, { quoted: msg })
    }

    try {
      const audioPath = await say(text)

      const audio = fs.readFileSync(audioPath)

      await sock.sendMessage(from, {
        audio,
        mimetype: "audio/mpeg",
        ptt: true
      }, { quoted: msg })

      fs.unlinkSync(audioPath)

    } catch (err) {
      console.log("SAY COMMAND ERROR:", err.message)

      await sock.sendMessage(from, {
        text: "❌ Voice failed. CYBER ENGINE ERROR"
      }, { quoted: msg })
    }
  }
}

