// commands/alwaysonline.js — CYBER X
// Usage: .alwaysonline on / .alwaysonline off

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "alwaysonline",
  desc:     "Toggle always online presence",
  usage:    ".alwaysonline on/off",
  category: 'owner',

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "alwaysOnline") : false
      return sock.sendMessage(from, {
        text: `🌐 Always Online is currently *${current ? "ON" : "OFF"}*\nUsage: *.alwaysonline on/off*`
      }, { quoted: msg })
    }

    const on = ["on", "true", "yes", "1"].includes(args[0].toLowerCase())
    if (db) db.updateSettings(phone, { alwaysOnline: on })

    await sock.sendMessage(from, {
      text: `🌐 Always Online: *${on ? "ON 🟢" : "OFF 🔴"}*`
    }, { quoted: msg })
  },
}
