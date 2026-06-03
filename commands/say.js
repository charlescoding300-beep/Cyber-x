const fs = require("fs")
const { speak } = require("../lib/tts")

module.exports = {
  pattern: ".say",

  run: async ({ sock, from, msg, args }) => {

    const text = args.join(" ")

    if (!text) {
      return sock.sendMessage(from, {
        text: "❌ Usage: .say hello world"
      }, { quoted: msg })
    }

    try {

      await sock.sendPresenceUpdate("composing", from)

      // convert text → speech
      const audioPath = await speak(text, "en-US-JennyNeural")

      if (!audioPath) {
        return sock.sendMessage(from, {
          text: "⚠️ TTS failed to generate audio."
        }, { quoted: msg })
      }

      // send as voice note (PTT)
      await sock.sendMessage(from, {
        audio: fs.readFileSync(audioPath),
        mimetype: "audio/mp4",
        ptt: true
      }, { quoted: msg })

    } catch (e) {
      console.log("SAY ERROR:", e.message)

      await sock.sendMessage(from, {
        text: "⚠️ Error generating voice."
      }, { quoted: msg })
    }
  }
}
