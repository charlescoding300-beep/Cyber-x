// commands/botname.js — CYBER X
// Usage: .botname MyBot

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "botname",
  desc:     "Change the bot name",
  usage:    ".botname <name>",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "botName") : "CYBER X"
      return sock.sendMessage(from, {
        text: `📛 Bot name is currently *${current || "CYBER X"}*\nUsage: *.botname <name>*`
      }, { quoted: msg })
    }

    const name = args.join(" ").trim()
    if (db) db.updateSettings(phone, { botName: name })

    await sock.sendMessage(from, {
      text: `📛 Bot name changed to: *${name}*`
    }, { quoted: msg })
  },
}
