// commands/autorecording.js — CYBER X
// Usage: .autorecording on / .autorecording off

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "autorecording",
  desc:     "Toggle auto recording presence",
  usage:    ".autorecording on/off",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "autoRecording") : false
      return sock.sendMessage(from, {
        text: `🎙️ Auto Recording is currently *${current ? "ON" : "OFF"}*\nUsage: *.autorecording on/off*`
      }, { quoted: msg })
    }

    const on = ["on", "true", "yes", "1"].includes(args[0].toLowerCase())
    if (db) db.updateSettings(phone, { autoRecording: on })

    await sock.sendMessage(from, {
      text: `🎙️ Auto Recording: *${on ? "ON 🟢" : "OFF 🔴"}*`
    }, { quoted: msg })
  },
}
