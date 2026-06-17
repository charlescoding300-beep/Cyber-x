// commands/autoread.js — CYBER X
// Usage: .autoread on / .autoread off

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "autoread",
  desc:     "Toggle auto read receipts",
  usage:    ".autoread on/off",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "autoRead") : false
      return sock.sendMessage(from, {
        text: `✅ Auto Read is currently *${current ? "ON" : "OFF"}*\nUsage: *.autoread on/off*`
      }, { quoted: msg })
    }

    const on = ["on", "true", "yes", "1"].includes(args[0].toLowerCase())
    if (db) db.updateSettings(phone, { autoRead: on })

    await sock.sendMessage(from, {
      text: `✅ Auto Read: *${on ? "ON 🟢" : "OFF 🔴"}*`
    }, { quoted: msg })
  },
}
