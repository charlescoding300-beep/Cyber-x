// ─────────────────────────────────────────────────────────────────────────────
// commands/welcome.js  —  CYBER X
//
// USAGE (group only, admin only):
//   .welcome          → show current status + message
//   .welcome on       → enable welcome messages
//   .welcome off      → disable welcome messages
//   .welcome set Welcome to {group}, {mention}! 🎉
//   .welcome reset    → restore default welcome message
//
// Template variables: {name} {mention} {group} {count} {date}
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb           = require("../lib/welcomeDb")
const { DEFAULT_WELCOME } = require("../lib/groupParticipants")

const WELCOME_IMAGE = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"

module.exports = {
  pattern:  "welcome",
  desc:     "Enable/disable & customise welcome messages (admin only)",
  usage:    ".welcome on/off/set <text>/reset",
  category: "group",

  async run({ sock, from, msg, args, isGroup, isAdmin }) {
    // ── Group only ────────────────────────────────────────────────────────────
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ This command only works in groups."
      }, { quoted: msg })
    }

    // ── Admin only ────────────────────────────────────────────────────────────
    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: "❌ Only group admins can use this command."
      }, { quoted: msg })
    }

    const sub = (args[0] || "").toLowerCase()

    // ── No args → show status ─────────────────────────────────────────────────
    if (!sub) {
      const enabled = welcomeDb.get(from, "welcome", false)
      const text    = welcomeDb.get(from, "welcomeText", DEFAULT_WELCOME)

      return sock.sendMessage(from, {
        image:   { url: WELCOME_IMAGE },
        caption:
          `👋 *Welcome Messages*\n\n` +
          `Status: ${enabled ? "🟢 ON" : "🔴 OFF"}\n\n` +
          `*Current message:*\n${text}\n\n` +
          `_Variables: {name} {mention} {group} {count} {date}_\n\n` +
          `• .welcome on/off\n` +
          `• .welcome set <your message>\n` +
          `• .welcome reset`
      }, { quoted: msg })
    }

    // ── ON ────────────────────────────────────────────────────────────────────
    if (sub === "on") {
      welcomeDb.set(from, "welcome", true)
      return sock.sendMessage(from, {
        image:   { url: WELCOME_IMAGE },
        caption:
          `✅ *Welcome messages enabled!*\n\n` +
          `New members will be greeted automatically with this image.\n\n` +
          `_Type .welcome set <text> to customise the message_`
      }, { quoted: msg })
    }

    // ── OFF ───────────────────────────────────────────────────────────────────
    if (sub === "off") {
      welcomeDb.set(from, "welcome", false)
      return sock.sendMessage(from, {
        text: "🔴 Welcome messages *disabled* for this group."
      }, { quoted: msg })
    }

    // ── SET ───────────────────────────────────────────────────────────────────
    if (sub === "set") {
      const newText = args.slice(1).join(" ").trim()
      if (!newText) {
        return sock.sendMessage(from, {
          text:
            "❌ Please provide a message.\n\n" +
            "Example:\n*.welcome set Welcome to {group}, {mention}! 🎉*\n\n" +
            "_Variables: {name} {mention} {group} {count} {date}_"
        }, { quoted: msg })
      }
      welcomeDb.set(from, "welcomeText", newText)
      return sock.sendMessage(from, {
        image:   { url: WELCOME_IMAGE },
        caption:
          `✅ *Welcome message updated!*\n\n` +
          `*Preview:*\n${newText}\n\n` +
          `_Use .welcome on to activate it_`
      }, { quoted: msg })
    }

    // ── RESET ─────────────────────────────────────────────────────────────────
    if (sub === "reset") {
      welcomeDb.set(from, "welcomeText", DEFAULT_WELCOME)
      return sock.sendMessage(from, {
        text: "♻️ Welcome message reset to default."
      }, { quoted: msg })
    }

    // ── Unknown ───────────────────────────────────────────────────────────────
    return sock.sendMessage(from, {
      text:
        "❓ Unknown option.\n\n" +
        "• *.welcome on* — enable\n" +
        "• *.welcome off* — disable\n" +
        "• *.welcome set <text>* — custom message\n" +
        "• *.welcome reset* — restore default"
    }, { quoted: msg })
  },
}
