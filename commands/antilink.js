// ─────────────────────────────────────────────────────────
// commands/antilink.js — CYBER X ANTILINK COMMAND (per-session)
//
// Usage:
//   .antilink on          → enable (warn mode), OCR auto-active if installed
//   .antilink off         → disable
//   .antilink delete      → delete links only, no warning
//   .antilink warn        → warn 3x then kick
//   .antilink kick        → instant kick on first link
//   .antilink status      → show current settings for THIS session
//   .antilink reset @user → reset a user's warnings
//
// Settings are isolated per WhatsApp session (phone number) — if you
// run multiple sessions in the same group, each has its own antilink
// config, independent of the others.
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "antilink",
  desc:     "Antilink — detects links (including obfuscated/image links via OCR)",
  category: 'group/admin',

  async run({ sock, from, msg, sender, args, lib, isAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ *Antilink only works in groups.*",
        quoted: msg
      })
    }

    let verifiedAdmin = isOwner || isAdmin
    if (!verifiedAdmin) {
      try {
        const meta = await sock.groupMetadata(from)
        const senderNum = (sender || "").split("@")[0].split(":")[0]
        verifiedAdmin = meta.participants.some(p => {
          const pNum = (p.id || "").split("@")[0].split(":")[0]
          return pNum === senderNum && (p.admin === "admin" || p.admin === "superadmin")
        })
      } catch (e) {
        verifiedAdmin = false
      }
    }

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: "❌ *Only group admins can use this command.*",
        quoted: msg
      })
    }

    // Every session (WhatsApp number) manages its own antilink config,
    // even inside the same group — derived from the bot's own JID.
    const phone = lib.normalizeNum(sock.user?.id || "")

    const sub  = (args[0] || "").toLowerCase()
    const ocrLine = lib.OCR_AVAILABLE
      ? "🔍 OCR: *ON* (auto — scans images for links)"
      : "🔍 OCR: *unavailable* (run: npm install tesseract.js)"

    if (sub === "on") {
      lib.enableAntilink(phone, from, "warn")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🛡️ *ANTILINK ON!*  ║
╚════════════════════╝

┌─────〔 ✅ *ENABLED* 〕─────
│ 🔗 Links are now *blocked*
│ ⚙️ Mode: *warn* (3 warns = kick)
│ ${ocrLine}
│
│ 💡 Commands:
│  *.antilink delete/warn/kick*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "off") {
      lib.disableAntilink(phone, from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔓 *ANTILINK OFF*  ║
╚════════════════════╝

┌─────〔 ❌ *DISABLED* 〕─────
│ 🔗 Links are now *allowed*
│ ℹ️ Use *.antilink on* to re-enable
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "delete") {
      lib.enableAntilink(phone, from, "delete")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🗑️ *DELETE MODE*  ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ 🔗 Links deleted silently
│ 👤 No warnings, no kicks
│ ${ocrLine}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "warn") {
      lib.enableAntilink(phone, from, "warn")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ⚠️ *WARN MODE*    ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ ⚠️ User gets *3 warnings*
│ 👢 3rd warning = *kicked*
│ ${ocrLine}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "kick") {
      lib.enableAntilink(phone, from, "kick")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  👢 *KICK MODE*    ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ ⚡ *Instant kick* — no warnings
│ 🔗 First link = *removed immediately*
│ 🚫 Links are strictly *banned*
│ ${ocrLine}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    if (sub === "reset") {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!mentioned) {
        return sock.sendMessage(from, {
          text: "❌ *Mention a user:* `.antilink reset @user`",
          quoted: msg
        })
      }
      lib.resetWarnings(phone, from, mentioned)
      const tag = mentioned.split("@")[0]
      return sock.sendMessage(from, {
        text: `✅ Warnings reset for @${tag}`,
        mentions: [mentioned],
        quoted: msg
      })
    }

    if (sub === "status" || sub === "") {
      const enabled = lib.isAntilinkEnabled(phone, from)
      const action  = lib.getAction(phone, from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  📊 *ANTILINK STATUS* ║
╚════════════════════╝

┌─────〔 ℹ️ *INFO (this session)* 〕─────
│ 🛡️ *Status:* ${enabled ? "✅ ENABLED" : "❌ DISABLED"}
│ ⚙️ *Mode:*   ${action.toUpperCase()}
│ ${ocrLine}
│
│ 📌 *What it detects:*
│  • All http/https/ftp links
│  • WhatsApp & Telegram invites
│  • Bare domains (google.com)
│  • Links inside images (OCR, automatic)
│  • Links in quoted messages
│
│ 📌 *Commands:*
│  *.antilink on/off*
│  *.antilink delete/warn/kick*
│  *.antilink reset @user*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text:
`❓ *Unknown option.*

Usage:
• *.antilink on/off*
• *.antilink delete/warn/kick*
• *.antilink status*
• *.antilink reset @user*`,
      quoted: msg
    })
  }
}
