// ─────────────────────────────────────────────────────────────────────────────
// commands/goodbye.js  —  CYBER X
//
// USAGE (group only, admin only):
//   .goodbye          → show current status + message
//   .goodbye on       → enable goodbye messages
//   .goodbye off      → disable goodbye messages
//   .goodbye set Goodbye {name}, we'll miss you! 😢
//   .goodbye reset    → restore default goodbye message
//
// Template variables: {name} {mention} {group} {count} {date}
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb           = require("../lib/welcomeDb")
const { DEFAULT_GOODBYE } = require("../lib/groupParticipants")

const GOODBYE_IMAGE = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

module.exports = {
  pattern:  "goodbye",
  desc:     "Enable/disable & customise goodbye messages (admin only)",
  usage:    ".goodbye on/off/set <text>/reset",
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
      const enabled = welcomeDb.get(from, "goodbye", false)
      const text    = welcomeDb.get(from, "goodbyeText", DEFAULT_GOODBYE)

      return sock.sendMessage(from, {
        image:   { url: GOODBYE_IMAGE },
        caption:
          `👋 *Goodbye Messages*\n\n` +
          `Status: ${enabled ? "🟢 ON" : "🔴 OFF"}\n\n` +
          `*Current message:*\n${text}\n\n` +
          `_Variables: {name} {mention} {group} {count} {date}_\n\n` +
          `• .goodbye on/off\n` +
          `• .goodbye set <your message>\n` +
          `• .goodbye reset`
      }, { quoted: msg })
    }

    // ── ON ────────────────────────────────────────────────────────────────────
    if (sub === "on") {
      // Save the goodbye image into the db so groupParticipants picks it up
      welcomeDb.set(from, "goodbye", true)
      welcomeDb.set(from, "goodbyeImage", GOODBYE_IMAGE)
      return sock.sendMessage(from, {
        image:   { url: GOODBYE_IMAGE },
        caption:
          `✅ *Goodbye messages enabled!*\n\n` +
          `Leaving members will get a farewell with this image.\n\n` +
          `_Type .goodbye set <text> to customise the message_`
      }, { quoted: msg })
    }

    // ── OFF ───────────────────────────────────────────────────────────────────
    if (sub === "off") {
      welcomeDb.set(from, "goodbye", false)
      return sock.sendMessage(from, {
        text: "🔴 Goodbye messages *disabled* for this group."
      }, { quoted: msg })
    }

    // ── SET ───────────────────────────────────────────────────────────────────
    if (sub === "set") {
      const newText = args.slice(1).join(" ").trim()
      if (!newText) {
        return sock.sendMessage(from, {
          text:
            "❌ Please provide a message.\n\n" +
            "Example:\n*.goodbye set Goodbye {name}, we'll miss you! 😢*\n\n" +
            "_Variables: {name} {mention} {group} {count} {date}_"
        }, { quoted: msg })
      }
      welcomeDb.set(from, "goodbyeText", newText)
      welcomeDb.set(from, "goodbyeImage", GOODBYE_IMAGE)
      return sock.sendMessage(from, {
        image:   { url: GOODBYE_IMAGE },
        caption:
          `✅ *Goodbye message updated!*\n\n` +
          `*Preview:*\n${newText}\n\n` +
          `_Use .goodbye on to activate it_`
      }, { quoted: msg })
    }

    // ── RESET ─────────────────────────────────────────────────────────────────
    if (sub === "reset") {
      welcomeDb.set(from, "goodbyeText", DEFAULT_GOODBYE)
      welcomeDb.set(from, "goodbyeImage", GOODBYE_IMAGE)
      return sock.sendMessage(from, {
        text: "♻️ Goodbye message reset to default."
      }, { quoted: msg })
    }

    // ── Unknown ───────────────────────────────────────────────────────────────
    return sock.sendMessage(from, {
      text:
        "❓ Unknown option.\n\n" +
        "• *.goodbye on* — enable\n" +
        "• *.goodbye off* — disable\n" +
        "• *.goodbye set <text>* — custom message\n" +
        "• *.goodbye reset* — restore default"
    }, { quoted: msg })
  },
}
