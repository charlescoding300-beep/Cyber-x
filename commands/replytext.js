// commands/replytext.js — CYBER X
// Usage: .replytext I'm busy, will reply later

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "replytext",
  desc:     "Set your auto reply message",
  usage:    ".replytext <message>",
  category: "settings",

  async run({ sock, from, msg, args, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    if (!args.length) {
      const current = db ? db.getSetting(phone, "autoReplyText") : null
      return sock.sendMessage(from, {
        text: `💬 Current auto reply text:\n_${current || "(not set)"}_ \n\nUsage: *.replytext <your message>*`
      }, { quoted: msg })
    }

    const text = args.join(" ").trim()
    if (db) db.updateSettings(phone, { autoReplyText: text })

    await sock.sendMessage(from, {
      text: `💬 Auto reply text set to:\n_${text}_`
    }, { quoted: msg })
  },
}
