// ─────────────────────────────────────────────────────────
// commands/antilink.js — CYBER X ANTILINK COMMAND
//
// Usage:
//   .antilink on          → enable (warn mode)
//   .antilink off         → disable
//   .antilink delete      → delete links only, no warning
//   .antilink warn        → warn 3x then kick
//   .antilink kick        → instant kick on first link, no warnings
//   .antilink ocr on/off  → enable/disable image link scanning
//   .antilink status      → show current settings
//   .antilink reset @user → reset a user's warnings
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "antilink",
  desc:     "Ultra antilink — detects every link + hidden/obfuscated/image links",
  category: 'group/admin',

  async run({ sock, from, msg, sender, args, lib, isAdmin, isOwner, isGroup, groupCache }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ *Antilink only works in groups.*",
        quoted: msg
      })
    }

    // ── Independent admin re-check ─────────────────────────
    // BUG FIX: this command was calling lib.isAdmin(sock, from, sender) —
    // wrong argument order for lib/isAdmin.js's real signature
    // isAdmin(groupCache, from, sender, sock, ownerJid, senderAlt). That
    // meant `sock` was being passed in as `groupCache`, which has no
    // participant data on it — buildAdminSet() always returned an empty
    // set, so every admin was rejected regardless of real status.
    //
    // Fixed two ways for a stronger layer, same pattern as mute.js/unmute.js:
    //   1. Use the isAdmin flag already correctly computed by index.js
    //      and passed into run() — no need to re-call lib.isAdmin at all.
    //   2. ALSO independently re-verify via fresh groupMetadata, so this
    //      command doesn't depend on index.js's flag being correct either.
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
        verifiedAdmin = false   // fail closed if we can't verify
      }
    }

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: "❌ *Only group admins can use this command.*",
        quoted: msg
      })
    }

    const sub  = (args[0] || "").toLowerCase()
    const sub2 = (args[1] || "").toLowerCase()

    // ── .antilink on ──
    if (sub === "on") {
      lib.enableAntilink(from, "warn")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🛡️ *ANTILINK ON!*  ║
╚════════════════════╝

┌─────〔 ✅ *ENABLED* 〕─────
│ 🔗 Links are now *blocked*
│ ⚙️ Mode: *warn* (3 warns = kick)
│ 🔍 OCR: *${lib.isOcrEnabled(from) ? "ON" : "OFF"}* (image scanning)
│
│ 💡 Commands:
│  *.antilink delete/warn/kick*
│  *.antilink ocr on* — scan images
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .antilink off ──
    if (sub === "off") {
      lib.disableAntilink(from)
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

    // ── .antilink delete ──
    if (sub === "delete") {
      lib.enableAntilink(from, "delete")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🗑️ *DELETE MODE*  ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ 🔗 Links deleted silently
│ 👤 No warnings, no kicks
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .antilink warn ──
    if (sub === "warn") {
      lib.enableAntilink(from, "warn")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ⚠️ *WARN MODE*    ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ ⚠️ User gets *3 warnings*
│ 👢 3rd warning = *kicked*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .antilink kick ──
    if (sub === "kick") {
      lib.enableAntilink(from, "kick")
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  👢 *KICK MODE*    ║
╚════════════════════╝

┌─────〔 ⚙️ *MODE SET* 〕─────
│ ⚡ *Instant kick* — no warnings
│ 🔗 First link = *removed immediately*
│ 🚫 Links are strictly *banned*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── .antilink ocr on/off ──
    if (sub === "ocr") {
      if (sub2 === "on") {
        lib.enableOcr(from)
        return sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  🔍 *OCR ENABLED*  ║
╚════════════════════╝

┌─────〔 ✅ *IMAGE SCAN ON* 〕─────
│ 🔍 Bot will now *scan images* for hidden links
│ 📩 Detects links in:
│  • Invitation cards
│  • Screenshots
│  • Forwarded images
│  • View-once photos
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          quoted: msg
        })
      }

      if (sub2 === "off") {
        lib.disableOcr(from)
        return sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  🔍 *OCR DISABLED* ║
╚════════════════════╝

┌─────〔 ❌ *IMAGE SCAN OFF* 〕─────
│ 🔍 Image scanning is now *off*
│ ℹ️ Use *.antilink ocr on* to re-enable
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          quoted: msg
        })
      }

      return sock.sendMessage(from, {
        text: "❓ Usage: *.antilink ocr on* or *.antilink ocr off*",
        quoted: msg
      })
    }

    // ── .antilink reset @user ──
    if (sub === "reset") {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      if (!mentioned) {
        return sock.sendMessage(from, {
          text: "❌ *Mention a user:* `.antilink reset @user`",
          quoted: msg
        })
      }
      lib.resetWarnings(from, mentioned)
      const tag = mentioned.split("@")[0]
      return sock.sendMessage(from, {
        text: `✅ Warnings reset for @${tag}`,
        mentions: [mentioned],
        quoted: msg
      })
    }

    // ── .antilink status / no args ──
    if (sub === "status" || sub === "") {
      const enabled = lib.isAntilinkEnabled(from)
      const action  = lib.getAction(from)
      const ocr     = lib.isOcrEnabled(from)
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  📊 *ANTILINK STATUS* ║
╚════════════════════╝

┌─────〔 ℹ️ *INFO* 〕─────
│ 🛡️ *Status:* ${enabled ? "✅ ENABLED" : "❌ DISABLED"}
│ ⚙️ *Mode:*   ${action.toUpperCase()}
│ 🔍 *OCR:*    ${ocr ? "✅ ON (image scan)" : "❌ OFF"}
│
│ 📌 *What it detects:*
│  • All http/https/ftp links
│  • WhatsApp & Telegram invites
│  • 40+ short URL services
│  • Bare domains (google.com)
│  • IP address links
│  • Obfuscated links (g o o g l e)
│  • Hidden unicode tricks
│  • Base64 encoded URLs
│  • Links in quoted messages
│  • Image links via OCR (if on)
│
│ 📌 *Commands:*
│  *.antilink on/off*
│  *.antilink delete/warn/kick*
│  *.antilink ocr on/off*
│  *.antilink reset @user*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── Unknown ──
    return sock.sendMessage(from, {
      text:
`❓ *Unknown option.*

Usage:
• *.antilink on/off*
• *.antilink delete/warn/kick*
• *.antilink ocr on/off*
• *.antilink status*
• *.antilink reset @user*`,
      quoted: msg
    })
  }
}
