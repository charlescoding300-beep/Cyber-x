// ─────────────────────────────────────────────────────────
// commands/antitag.js — CYBER X ANTITAG
//
// Deletes any message that tags/mentions a member — including
// simulated "@all"/"tag everyone" — regardless of whether an admin or
// normal member sent it. Only the bot owner is exempt.
//
// Usage:
//   .antitag on   → enable in this group
//   .antitag off  → disable
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "antitag",
  desc:     "Delete any message that tags/mentions a member (admins + normal members, owner exempt)",
  category: "group/admin",

  async run({ sock, from, msg, args, isOwner, isAdmin, isGroup }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: "❌ *Antitag only works in groups.*", quoted: msg })
    }
    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, { text: "❌ *Only the bot owner or a group admin can use this command.*", quoted: msg })
    }

    const phone = (sock.user?.id || "").split("@")[0].split(":")[0]
    const sub = (args[0] || "").toLowerCase().trim()

    if (sub === "on") {
      global.__antitagEnable(phone, from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🚫 *ANTITAG ON!*   ║
╚════════════════════╝

┌─────〔 ✅ *ENABLED* 〕─────
│ 🏷️ Any tag/mention/@all gets deleted
│ 👥 Applies to admins AND normal members
│ 👑 Only the bot owner is exempt
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "off") {
      global.__antitagDisable(phone, from)
      return sock.sendMessage(from, {
        text: `╔════════════════════╗\n║  🔓 *ANTITAG OFF*   ║\n╚════════════════════╝\n\n┌─────〔 ❌ *DISABLED* 〕─────\n│ 🏷️ Tags/mentions allowed again\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    const enabled = global.__antitagIsEnabled(phone, from)
    return sock.sendMessage(from, {
      text:
`╔════════════════════╗
║  📊 *ANTITAG STATUS*║
╚════════════════════╝

┌─────〔 ℹ️ *INFO* 〕─────
│ 🛡️ *Status:* ${enabled ? "✅ ENABLED" : "❌ DISABLED"}
│
│ 📌 *Commands:*
│  *.antitag on/off*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      quoted: msg
    })
  }
}
