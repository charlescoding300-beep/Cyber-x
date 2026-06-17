// commands/mode.js — CYBER X
// Usage: .mode public / .mode private

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "mode",
  desc:     "Set bot mode to public or private",
  usage:    ".mode public/private",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "mode") : "public"
      return sock.sendMessage(from, {
        text: `🔒 Mode is currently *${current || "public"}*\nUsage: *.mode public/private*`
      }, { quoted: msg })
    }

    const val = args[0].toLowerCase()
    if (!["public", "private"].includes(val)) {
      return sock.sendMessage(from, {
        text: `❌ Invalid mode. Use *public* or *private*`
      }, { quoted: msg })
    }

    if (db) db.updateSettings(phone, { mode: val })

    await sock.sendMessage(from, {
      text: `🔒 Mode set to: *${val}*`
    }, { quoted: msg })
  },
}
