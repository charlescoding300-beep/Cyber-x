// ─────────────────────────────────────────────────────────────────────────────
// commands/greetwelcome.js  —  CYBER X
//
// Standalone welcome command — uses greetStore.js, paired with
// lib/greetListener.js. Separate from any other welcome system in this
// project.
//
// USAGE (group only, admin only):
//   .welcome          → show status
//   .welcome on       → enable
//   .welcome off      → disable
//   .welcome set <text>
//   .welcome reset
//
// Variables: {name} {mention} {group} {count} {date}
// ─────────────────────────────────────────────────────────────────────────────

const greetStore = require("../lib/greetStore")
const { DEFAULT_WELCOME } = require("../lib/greetListener")

module.exports = {
  pattern:  "welcome",
  alias:    [],
  desc:     "Standalone welcome message toggle (admin only)",
  usage:    ".welcome on/off/set <text>/reset",
  category: "group",

  async run({ sock, from, msg, args, isGroup, isOwner }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: "❌ This command only works in groups." }, { quoted: msg })
    }

    // Independent admin re-check — same defensive pattern as mute.js,
    // does not depend on any flag passed in from elsewhere.
    let verifiedAdmin = isOwner
    if (!verifiedAdmin) {
      try {
        const meta = await sock.groupMetadata(from)
        const senderNum = (msg.key.participant || from).split("@")[0].split(":")[0]
        verifiedAdmin = meta.participants.some(p => {
          const pNum = (p.id || "").split("@")[0].split(":")[0]
          return pNum === senderNum && (p.admin === "admin" || p.admin === "superadmin")
        })
      } catch (e) {
        verifiedAdmin = false
      }
    }
    if (!verifiedAdmin) {
      return sock.sendMessage(from, { text: "❌ Only group admins can use this command." }, { quoted: msg })
    }

    const sub = (args[0] || "").toLowerCase()

    if (!sub) {
      const enabled = greetStore.get(from, "welcomeEnabled", false)
      const text    = greetStore.get(from, "welcomeText", DEFAULT_WELCOME)
      return sock.sendMessage(from, {
        text:
          `👋 *Welcome Messages (standalone)*\n\n` +
          `Status: ${enabled ? "🟢 ON" : "🔴 OFF"}\n\n` +
          `*Current message:*\n${text}\n\n` +
          `_Variables: {name} {mention} {group} {count} {date}_\n\n` +
          `• .welcome on/off\n` +
          `• .welcome set <text>\n` +
          `• .welcome reset`
      }, { quoted: msg })
    }

    if (sub === "on") {
      greetStore.set(from, "welcomeEnabled", true)
      return sock.sendMessage(from, { text: "✅ Welcome messages *enabled*." }, { quoted: msg })
    }

    if (sub === "off") {
      greetStore.set(from, "welcomeEnabled", false)
      return sock.sendMessage(from, { text: "🔴 Welcome messages *disabled*." }, { quoted: msg })
    }

    if (sub === "set") {
      const newText = args.slice(1).join(" ").trim()
      if (!newText) {
        return sock.sendMessage(from, {
          text: "❌ Provide a message.\nExample: .welcome set Welcome {mention} to {group}!"
        }, { quoted: msg })
      }
      greetStore.set(from, "welcomeText", newText)
      return sock.sendMessage(from, { text: `✅ Welcome message updated:\n\n${newText}` }, { quoted: msg })
    }

    if (sub === "reset") {
      greetStore.set(from, "welcomeText", DEFAULT_WELCOME)
      return sock.sendMessage(from, { text: "♻️ Welcome message reset to default." }, { quoted: msg })
    }

    return sock.sendMessage(from, { text: "❓ Unknown option. Usage: .welcome on/off/set/reset" }, { quoted: msg })
  },
}
