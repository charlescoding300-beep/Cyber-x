// ═══════════════════════════════════════════════════════════════
// commands/welcome.js — CYBER X WELCOME & GOODBYE COMMAND
//
// Usage:
//   .welcome          → show current welcome status
//   .welcome on       → enable welcome message
//   .welcome off      → disable welcome message
//   .welcome set      → reply to a message to set as custom welcome
//   .welcome reset    → reset to default welcome message
//   .welcome test     → test welcome message on yourself
//
//   .goodbye on/off/set/reset/test → same but for goodbye
// ═══════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "welcome",
  desc:     "Set welcome/goodbye messages for new members",
  usage:    ".welcome on | off | set | reset | test",

  async run({ sock, from, msg, text, args, sender, lib, isAdmin, isOwner, isGroup }) {

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

    // ── .welcome (no args) — show status ──
    if (!sub) {
      const config   = lib.getWelcomeConfig(from)
      const wStatus  = config.welcomeEnabled ? "✅ ON"  : "❌ OFF"
      const gStatus  = config.goodbyeEnabled ? "✅ ON"  : "❌ OFF"
      const wMsg     = config.welcomeMsg     ? "📝 Custom" : "🔘 Default"
      const gMsg     = config.goodbyeMsg     ? "📝 Custom" : "🔘 Default"

      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  👋 *WELCOME SETTINGS* ║
╚════════════════════════╝

┌─────〔 ℹ️ *STATUS* 〕─────
│ 🟢 *Welcome:* ${wStatus}
│ 🔴 *Goodbye:* ${gStatus}
│ 📝 *Welcome Msg:* ${wMsg}
│ 📝 *Goodbye Msg:* ${gMsg}
│
│ 📌 *Commands:*
│  *.welcome on/off*
│  *.welcome set* (reply to a msg)
│  *.welcome reset*
│  *.welcome test*
│  *.goodbye on/off/set/reset/test*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .welcome on ──
    if (sub === "on") {
      lib.enableWelcome(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ✅ *WELCOME ENABLED*  ║
╚════════════════════════╝

┌─────〔 👋 *ACTIVE* 〕─────
│ New members will now be
│ welcomed with their photo
│ and a tag when they join.
│
│ 💡 Use *.welcome set* to
│    customize the message.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .welcome off ──
    if (sub === "off") {
      lib.disableWelcome(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ❌ *WELCOME DISABLED* ║
╚════════════════════════╝

│ Welcome messages are now off.
│ Use *.welcome on* to re-enable.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .welcome set (reply to a message) ──
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

Type your custom welcome message,
then *reply to it* with:
  *.welcome set*

📌 *You can use these placeholders:*
  *{tag}*   → tags the new member
  *{name}*  → member's number
  *{group}* → group name
  *{count}* → total members

Example message:
_Welcome to {group}, {tag}! 🎉
We now have {count} members._`,
          quoted: msg
        })
      }

      lib.setWelcomeMsg(from, quotedText)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ✅ *WELCOME MSG SET!* ║
╚════════════════════════╝

Your custom welcome message has
been saved! New members will see
it when they join. ✅

Use *.welcome test* to preview it.
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .welcome reset ──
    if (sub === "reset") {
      lib.resetWelcomeMsg(from)
      return sock.sendMessage(from, {
        text: "✅ *Welcome message reset to default.*",
        quoted: msg
      })
    }

    // ── .welcome test ──
    if (sub === "test") {
      const config = lib.getWelcomeConfig(from)
      const template = config.welcomeMsg || lib.DEFAULT_WELCOME

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

    // ── Unknown ──
    return sock.sendMessage(from, {
      text: "❓ Unknown option. Use: *.welcome on | off | set | reset | test*",
      quoted: msg
    })
  }
}

