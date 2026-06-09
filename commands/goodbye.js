// ═══════════════════════════════════════════════════════════════
// commands/goodbye.js — CYBER X GOODBYE COMMAND
//
// Usage:
//   .goodbye          → show current goodbye status
//   .goodbye on       → enable goodbye message
//   .goodbye off      → disable goodbye message
//   .goodbye set      → reply to a message to set as custom goodbye
//   .goodbye reset    → reset to default goodbye message
//   .goodbye test     → test goodbye message on yourself
// ═══════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "goodbye",
  desc:     "Set goodbye messages for members who leave",
  usage:    ".goodbye on | off | set | reset | test",

  async run({ sock, from, msg, args, sender, lib, isAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ *This command only works in groups.*",
        quoted: msg
      })
    }

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, {
        text: "❌ *Only admins can use this command.*",
        quoted: msg
      })
    }

    const sub = (args[0] || "").toLowerCase()

    // ── .goodbye (no args) ──
    if (!sub) {
      const config  = lib.getWelcomeConfig(from)
      const gStatus = config.goodbyeEnabled ? "✅ ON" : "❌ OFF"
      const gMsg    = config.goodbyeMsg     ? "📝 Custom" : "🔘 Default"

      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  👋 *GOODBYE SETTINGS* ║
╚════════════════════════╝

┌─────〔 ℹ️ *STATUS* 〕─────
│ 🔴 *Goodbye:* ${gStatus}
│ 📝 *Message:* ${gMsg}
│
│ 📌 *Commands:*
│  *.goodbye on/off*
│  *.goodbye set* (reply to msg)
│  *.goodbye reset*
│  *.goodbye test*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .goodbye on ──
    if (sub === "on") {
      lib.enableGoodbye(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ✅ *GOODBYE ENABLED*  ║
╚════════════════════════╝

│ Members who leave will now
│ get a goodbye message with
│ their photo and tag. 👋
│
│ 💡 Use *.goodbye set* to
│    customize the message.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .goodbye off ──
    if (sub === "off") {
      lib.disableGoodbye(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ❌ *GOODBYE DISABLED* ║
╚════════════════════════╝

│ Goodbye messages are now off.
│ Use *.goodbye on* to re-enable.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .goodbye set ──
    if (sub === "set") {
      const ctx        = msg.message?.extendedTextMessage?.contextInfo
      const quotedText =
        ctx?.quotedMessage?.conversation ||
        ctx?.quotedMessage?.extendedTextMessage?.text ||
        null

      if (!quotedText) {
        return sock.sendMessage(from, {
          text:
`╔════════════════════════╗
║  ℹ️ *HOW TO SET*       ║
╚════════════════════════╝

Type your custom goodbye message,
then *reply to it* with:
  *.goodbye set*

📌 *Placeholders you can use:*
  *{tag}*   → tags the member
  *{name}*  → member's number
  *{group}* → group name
  *{count}* → remaining members

Example:
_Goodbye {tag}! 👋
We hope to see you again in {group}._`,
          quoted: msg
        })
      }

      lib.setGoodbyeMsg(from, quotedText)
      return sock.sendMessage(from, {
        text: "✅ *Custom goodbye message saved!*\nUse *.goodbye test* to preview it.",
        quoted: msg
      })
    }

    // ── .goodbye reset ──
    if (sub === "reset") {
      lib.resetGoodbyeMsg(from)
      return sock.sendMessage(from, {
        text: "✅ *Goodbye message reset to default.*",
        quoted: msg
      })
    }

    // ── .goodbye test ──
    if (sub === "test") {
      const config   = lib.getWelcomeConfig(from)
      const template = config.goodbyeMsg || lib.DEFAULT_GOODBYE

      let groupName   = "this group"
      let memberCount = 0
      try {
        const meta  = await sock.groupMetadata(from)
        groupName   = meta.subject || "this group"
        memberCount = meta.participants?.length || 0
      } catch {}

      const tag  = `@${sender.split("@")[0]}`
      const text = template
        .replace(/{tag}/g,   tag)
        .replace(/{name}/g,  tag)
        .replace(/{group}/g, groupName)
        .replace(/{count}/g, memberCount)

      let ppUrl = null
      try { ppUrl = await sock.profilePictureUrl(sender, "image") } catch {}

      if (ppUrl) {
        return sock.sendMessage(from, {
          image:    { url: ppUrl },
          caption:  `🧪 *TEST PREVIEW:*\n\n${text}`,
          mentions: [sender],
        }, { quoted: msg })
      }
      return sock.sendMessage(from, {
        text:     `🧪 *TEST PREVIEW:*\n\n${text}`,
        mentions: [sender],
        quoted:   msg
      })
    }

    return sock.sendMessage(from, {
      text: "❓ Unknown option. Use: *.goodbye on | off | set | reset | test*",
      quoted: msg
    })
  }
}
