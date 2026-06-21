// ─────────────────────────────────────────────────────────────────────────────
// commands/greetgoodbye.js  —  CYBER X
//
// Standalone goodbye command — uses greetStore.js, paired with
// lib/greetListener.js. Separate from any other goodbye system in this
// project.
//
// USAGE (group only, admin only):
//   .goodbye          → show status
//   .goodbye on       → enable
//   .goodbye off      → disable
//   .goodbye set <text>
//   .goodbye reset
//
// Variables: {name} {mention} {group} {count} {date}
// ─────────────────────────────────────────────────────────────────────────────

const greetStore = require("../lib/greetStore")
const { DEFAULT_GOODBYE } = require("../lib/greetListener")

module.exports = {
  pattern:  "goodbye",
  alias:    [],
  desc:     "Standalone goodbye message toggle (admin only)",
  usage:    ".goodbye on/off/set <text>/reset",
  category: "group",

  async run({ sock, from, msg, args, isGroup, isOwner }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: "❌ This command only works in groups." }, { quoted: msg })
    }

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
      const enabled = greetStore.get(from, "goodbyeEnabled", false)
      const text    = greetStore.get(from, "goodbyeText", DEFAULT_GOODBYE)
      return sock.sendMessage(from, {
        text:
          `👋 *Goodbye Messages (standalone)*\n\n` +
          `Status: ${enabled ? "🟢 ON" : "🔴 OFF"}\n\n` +
          `*Current message:*\n${text}\n\n` +
          `_Variables: {name} {mention} {group} {count} {date}_\n\n` +
          `• .goodbye on/off\n` +
          `• .goodbye set <text>\n` +
          `• .goodbye reset`
      }, { quoted: msg })
    }

    if (sub === "on") {
      greetStore.set(from, "goodbyeEnabled", true)
      return sock.sendMessage(from, { text: "✅ Goodbye messages *enabled*." }, { quoted: msg })
    }

    if (sub === "off") {
      greetStore.set(from, "goodbyeEnabled", false)
      return sock.sendMessage(from, { text: "🔴 Goodbye messages *disabled*." }, { quoted: msg })
    }

    if (sub === "set") {
      const newText = args.slice(1).join(" ").trim()
      if (!newText) {
        return sock.sendMessage(from, {
          text: "❌ Provide a message.\nExample: .goodbye set Bye {mention}, we'll miss you!"
        }, { quoted: msg })
      }
      greetStore.set(from, "goodbyeText", newText)
      return sock.sendMessage(from, { text: `✅ Goodbye message updated:\n\n${newText}` }, { quoted: msg })
    }

    if (sub === "reset") {
      greetStore.set(from, "goodbyeText", DEFAULT_GOODBYE)
      return sock.sendMessage(from, { text: "♻️ Goodbye message reset to default." }, { quoted: msg })
    }

    return sock.sendMessage(from, { text: "❓ Unknown option. Usage: .goodbye on/off/set/reset" }, { quoted: msg })
  },
}
