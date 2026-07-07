// ─────────────────────────────────────────────────────────
// commands/mode.js — CYBER X SESSION MODE
//
// Each WhatsApp session controls its OWN private/public setting,
// completely independent of every other session. In private mode,
// only the session owner (the number the bot is paired to) can
// trigger ANY command — everyone else is silently ignored, even
// in shared groups. In public mode, anyone can use commands as usual.
//
// Usage:
//   .mode private → only you can use this session's commands
//   .mode public  → anyone can use this session's commands
//   .mode status  → show current mode
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "mode",
  desc:     "Set this session to private (owner-only) or public",
  category: "settings",

  async run({ sock, from, msg, settings, args, isOwner }) {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: "❌ *Only the session owner can change this.*\n\nThis keeps your bot's privacy setting from being changed by anyone else — even group admins.",
        quoted: msg
      })
    }

    const sub = (args[0] || "").toLowerCase().trim()

    if (sub === "private") {
      settings.set("mode", "private")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔒 *PRIVATE MODE*  ║
╚════════════════════╝

┌─────〔 ✅ *SET* 〕─────
│ 🔐 Only YOU can trigger commands now
│ 👥 Everyone else — even in groups — is ignored
│ ℹ️ Use *.mode public* to reverse this
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "public") {
      settings.set("mode", "public")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🌐 *PUBLIC MODE*   ║
╚════════════════════╝

┌─────〔 ✅ *SET* 〕─────
│ 👥 Anyone can trigger commands now
│ ℹ️ Use *.mode private* to restrict again
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // status / no args
    const current = settings.get("mode") || "public"
    return sock.sendMessage(from, {
      text:
`╔════════════════════╗
║  📊 *MODE STATUS*   ║
╚════════════════════╝

┌─────〔 ℹ️ *INFO* 〕─────
│ Current mode: *${current.toUpperCase()}*
│
│ 📌 *Commands:*
│  *.mode private* — owner-only
│  *.mode public*  — everyone
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      quoted: msg
    })
  }
}
