// commands/prefix.js — CYBER X
// Usage: .prefix !

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "prefix",
  desc:     "Change your command prefix",
  usage:    ".prefix <symbol>",
  category: 'utility',

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "prefix") : "."
      return sock.sendMessage(from, {
        text: `🔣 Prefix is currently *${current || "."}*\nUsage: *.prefix <symbol>*`
      }, { quoted: msg })
    }

    const val = args[0]
    if (val.length > 3) {
      return sock.sendMessage(from, {
        text: `❌ Prefix must be 1-3 characters`
      }, { quoted: msg })
    }

    if (db) db.updateSettings(phone, { prefix: val })

    await sock.sendMessage(from, {
      text: `🔣 Prefix changed to: *${val}*`
    }, { quoted: msg })
  },
}
