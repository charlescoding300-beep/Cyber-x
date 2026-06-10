// ═══════════════════════════════════════════════════════════════
//  commands/goodbye.js — CYBER X
// ═══════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "goodbye",
  desc:     "Manage goodbye messages for members who leave",
  usage:    ".goodbye on | off | set | reset | test",
  category: "group",

  async run({ sock, from, msg, args, sender, lib, isOwner, isGroup }) {

    if (!isGroup) return sock.sendMessage(from, {
      text: "❌ *This command only works in groups.*", quoted: msg
    })

    const { isAdmin } = require('../lib/isAdmin')
    const admin = await isAdmin(sock, from, sender)

    if (!admin && !isOwner) return sock.sendMessage(from, {
      text: "❌ *Only admins can use this command.*", quoted: msg
    })

    const sub = (args[0] || "").toLowerCase()

    // ── no args: status ───────────────────────────────────────
    if (!sub) {
      const cfg = lib.getWelcomeConfig(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  👋 *GOODBYE SETTINGS* ║
╚════════════════════════╝

┌─────〔 ℹ️ *STATUS* 〕─────
│ 🔴 *Goodbye:* ${cfg.goodbyeEnabled ? "✅ ON" : "❌ OFF"}
│ 📝 *Msg:* ${cfg.goodbyeMsg ? "📝 Custom" : "🔘 Default"}
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

    // ── on ────────────────────────────────────────────────────
    if (sub === "on") {
      lib.enableGoodbye(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ✅ *GOODBYE ENABLED*  ║
╚════════════════════════╝

│ Members who leave will get a goodbye.
│ 💡 Use *.goodbye set* to customize.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── off ───────────────────────────────────────────────────
    if (sub === "off") {
      lib.disableGoodbye(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ❌ *GOODBYE DISABLED* ║
╚════════════════════════╝

│ Use *.goodbye on* to re-enable.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── set ───────────────────────────────────────────────────
    if (sub === "set") {
      const ctx  = msg.message?.extendedTextMessage?.contextInfo
      const text = ctx?.quotedMessage?.conversation
                || ctx?.quotedMessage?.extendedTextMessage?.text
                || null

      if (!text) return sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  ℹ️ *HOW TO SET*       ║
╚════════════════════════╝

Type your message, then *reply to it* with:
  *.goodbye set*

📌 *Placeholders:*
  *{tag}*   → tags the member
  *{name}*  → member number
  *{group}* → group name
  *{count}* → remaining members`,
        quoted: msg
      })

      lib.setGoodbyeMsg(from, text)
      return sock.sendMessage(from, {
        text: "✅ *Custom goodbye message saved!*\nUse *.goodbye test* to preview.",
        quoted: msg
      })
    }

    // ── reset ─────────────────────────────────────────────────
    if (sub === "reset") {
      lib.resetGoodbyeMsg(from)
      return sock.sendMessage(from, {
        text: "✅ *Goodbye message reset to default.*", quoted: msg
      })
    }

    // ── test ──────────────────────────────────────────────────
    if (sub === "test") {
      const cfg      = lib.getWelcomeConfig(from)
      const template = cfg.goodbyeMsg || lib.DEFAULT_GOODBYE

      const meta      = lib.welcome?._store?.groupMetadata?.[from]
                     ?? await sock.groupMetadata(from).catch(() => ({}))
      const groupName = meta?.subject || 'this group'
      const count     = meta?.participants?.length || 0
      const tag       = `@${sender.split('@')[0]}`
      const text      = template
        .replace(/{tag}/g,   tag)
        .replace(/{name}/g,  tag)
        .replace(/{group}/g, groupName)
        .replace(/{count}/g, count)

      let ppUrl = null
      try { ppUrl = await sock.profilePictureUrl(sender, 'image') } catch {}

      if (ppUrl) {
        return sock.sendMessage(from, {
          image: { url: ppUrl }, caption: `🧪 *TEST PREVIEW:*\n\n${text}`, mentions: [sender]
        }, { quoted: msg })
      }
      return sock.sendMessage(from, {
        text: `🧪 *TEST PREVIEW:*\n\n${text}`, mentions: [sender], quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text: "❓ Use: *.goodbye on | off | set | reset | test*", quoted: msg
    })
  }
}
