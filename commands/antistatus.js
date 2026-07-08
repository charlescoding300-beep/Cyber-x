// ─────────────────────────────────────────────────────────
// commands/antistatus.js — CYBER X ANTISTATUS
//
// Actions taken when a NORMAL member (not admin, not owner) tags this
// group in their personal WhatsApp status. Admins and the bot owner
// can configure this, but are themselves always exempt from being
// actioned by it.
//
// IMPORTANT: WhatsApp does not allow deleting another person's actual
// personal status post — that's a WhatsApp protocol restriction, not
// a bug here. "delete" mode attempts it but may not succeed; "warn"
// and "kick" are the actions that reliably work every time.
//
// Usage:
//   .antistatus on          → enable (warn mode)
//   .antistatus off         → disable
//   .antistatus delete      → delete-only mode (best-effort, see above)
//   .antistatus warn        → warn 3x then kick
//   .antistatus kick        → instant kick
//   .antistatus status      → show current settings
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "antistatus",
  desc:     "Action normal members who tag this group in their WhatsApp status",
  category: "group/admin",

  async run({ sock, from, msg, args, isOwner, isAdmin, isGroup }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: "❌ *Antistatus only works in groups.*", quoted: msg })
    }
    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, { text: "❌ *Only the bot owner or a group admin can use this command.*", quoted: msg })
    }

    const phone = (sock.user?.id || "").split("@")[0].split(":")[0]
    const sub = (args[0] || "").toLowerCase().trim()

    if (sub === "on") {
      global.__antistatusEnable(phone, from, "warn")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  📱 *ANTISTATUS ON!* ║
╚════════════════════╝

┌─────〔 ✅ *ENABLED* 〕─────
│ 📱 Normal members who tag this group
│    in their status get actioned
│ ⚙️ Mode: *warn* (3 warns = kick)
│ 👑 Admins + owner are exempt
│
│ ⚠️ Note: WhatsApp doesn't allow deleting
│ someone else's status — warn/kick are
│ what actually works reliably.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "off") {
      global.__antistatusDisable(phone, from)
      return sock.sendMessage(from, {
        text: `╔════════════════════╗\n║  🔓 *ANTISTATUS OFF* ║\n╚════════════════════╝\n\n┌─────〔 ❌ *DISABLED* 〕─────\n│ 📱 Status tags allowed again\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (["delete", "warn", "kick"].includes(sub)) {
      global.__antistatusEnable(phone, from, sub)
      const label = { delete: "🗑️ DELETE MODE", warn: "⚠️ WARN MODE", kick: "👢 KICK MODE" }[sub]
      return sock.sendMessage(from, {
        text: `╔════════════════════╗\n║  ${label}  ║\n╚════════════════════╝\n\n┌─────〔 ⚙️ *MODE SET* 〕─────\n│ Mode: *${sub}*\n${sub === "delete" ? "│ ⚠️ Best-effort only — WhatsApp restricts deleting others' status\n" : ""}└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    const enabled = global.__antistatusIsEnabled(phone, from)
    const mode    = global.__antistatusGetMode(phone, from)
    return sock.sendMessage(from, {
      text:
`╔════════════════════╗
║  📊 *ANTISTATUS STATUS*║
╚════════════════════╝

┌─────〔 ℹ️ *INFO* 〕─────
│ 🛡️ *Status:* ${enabled ? "✅ ENABLED" : "❌ DISABLED"}
│ ⚙️ *Mode:* ${mode.toUpperCase()}
│
│ 📌 *Commands:*
│  *.antistatus on/off*
│  *.antistatus delete/warn/kick*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      quoted: msg
    })
  }
}
