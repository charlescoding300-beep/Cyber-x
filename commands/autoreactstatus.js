// commands/autoreactstatus.js — CYBER X
// Usage: .autoreactstatus on / .autoreactstatus off

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "autoreactstatus",
  desc:     "Toggle auto react to status",
  usage:    ".autoreactstatus on/off",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "autoReactStatus") : false
      return sock.sendMessage(from, {
        text: `❤️ Auto React Status is currently *${current ? "ON" : "OFF"}*\nUsage: *.autoreactstatus on/off*`
      }, { quoted: msg })
    }

    const on = ["on", "true", "yes", "1"].includes(args[0].toLowerCase())
    if (db) db.updateSettings(phone, { autoReactStatus: on })

    await sock.sendMessage(from, {
      text: `❤️ Auto React Status: *${on ? "ON 🟢" : "OFF 🔴"}*`
    }, { quoted: msg })
  },
}
