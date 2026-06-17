// commands/autoviewstatus.js — CYBER X
// Usage: .autoviewstatus on / .autoviewstatus off

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "autoviewstatus",
  desc:     "Toggle auto view status",
  usage:    ".autoviewstatus on/off",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "autoViewStatus") : false
      return sock.sendMessage(from, {
        text: `👁️ Auto View Status is currently *${current ? "ON" : "OFF"}*\nUsage: *.autoviewstatus on/off*`
      }, { quoted: msg })
    }

    const on = ["on", "true", "yes", "1"].includes(args[0].toLowerCase())
    if (db) db.updateSettings(phone, { autoViewStatus: on })

    await sock.sendMessage(from, {
      text: `👁️ Auto View Status: *${on ? "ON 🟢" : "OFF 🔴"}*`
    }, { quoted: msg })
  },
}
