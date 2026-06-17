// commands/mysettings.js — CYBER X
// Usage: .mysettings  →  shows all current settings

let db
try { db = require("../lib/userDb") } catch {}

module.exports = {
  pattern:  "mysettings",
  desc:     "View all your current bot settings",
  usage:    ".mysettings",
  category: "settings",

  async run({ sock, from, msg, sender }) {
    const phone = sender.replace(/\D/g, "").split("@")[0] ||
                  from.replace(/\D/g, "").split("@")[0]

    const s = db ? db.getSection(phone, "settings") : {}

    const on   = "🟢 ON"
    const off  = "🔴 OFF"
    const bool = v => v ? on : off

    const text =
      `⚙️ *CYBER X — Your Settings*\n\n` +
      `📛 Bot Name:           *${s.botName     || "CYBER X"}*\n` +
      `🔣 Prefix:             *${s.prefix      || "."}*\n` +
      `🔒 Mode:               *${s.mode        || "public"}*\n\n` +
      `*Auto Features:*\n` +
      `⌨️  Auto Typing:        ${bool(s.autoTyping)}\n` +
      `🎙️  Auto Recording:     ${bool(s.autoRecording)}\n` +
      `✅  Auto Read:          ${bool(s.autoRead)}\n` +
      `💬  Auto Reply:         ${bool(s.autoReply)}\n` +
      `👁️  Auto View Status:   ${bool(s.autoViewStatus)}\n` +
      `❤️  Auto React Status:  ${bool(s.autoReactStatus)}\n` +
      `🌐  Always Online:      ${bool(s.alwaysOnline)}\n\n` +
      `*Commands to change settings:*\n` +
      `› .autotyping on/off\n` +
      `› .autorecording on/off\n` +
      `› .autoread on/off\n` +
      `› .autoreply on/off\n` +
      `› .replytext <message>\n` +
      `› .autoviewstatus on/off\n` +
      `› .autoreactstatus on/off\n` +
      `› .alwaysonline on/off\n` +
      `› .mode public/private\n` +
      `› .botname <name>\n` +
      `› .prefix <symbol>`

    return sock.sendMessage(from, { text }, { quoted: msg })
  },
}
