// ─────────────────────────────────────────
//   Add this inside your main index.js
//   inside your messages.upsert event handler
//   CYBER X — Antilink Auto Handler
// ─────────────────────────────────────────

const {
  containsLink,
  isAntilinkEnabled,
  getAction,
  addWarning,
  getWarnings,
  resetWarnings,
} = require("./lib/antilink")

// ── Paste this block inside your message handler ──
// e.g. sock.ev.on("messages.upsert", async ({ messages }) => { ... })

async function handleAntilink(sock, msg) {
  try {
    const from = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    const isGroup = from.endsWith("@g.us")

    if (!isGroup) return
    if (!isAntilinkEnabled(from)) return
    if (msg.key.fromMe) return

    // Get message text
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || ""

    if (!containsLink(text)) return

    // ── Check if sender is admin (skip admins) ──
    const groupMeta = await sock.groupMetadata(from)
    const admins = groupMeta.participants
      .filter(p => p.admin)
      .map(p => p.id)

    if (admins.includes(sender)) return

    const action = getAction(from)
    const tag = sender.split("@")[0]

    // ── Always delete the message ──
    await sock.sendMessage(from, { delete: msg.key })

    if (action === "delete") {
      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔗 *LINK DETECTED!*  ║
╚════════════════════╝

┌─────〔 🚫 *BLOCKED* 〕─────
│ 👤 *User:* @${tag}
│ ❌ *Links are not allowed here!*
│ 🗑️ Message has been deleted.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })

    } else if (action === "warn" || action === "kick") {
      const warns = addWarning(from, sender)
      const maxWarns = 3

      if (warns >= maxWarns) {
        // ── Kick the user ──
        resetWarnings(from, sender)
        await sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  👢 *USER KICKED!*  ║
╚════════════════════╝

┌─────〔 🚫 *ACTION TAKEN* 〕─────
│ 👤 *User:* @${tag}
│ ⚠️ *Warnings:* ${warns}/${maxWarns}
│ 🔗 *Reason:* Sending links repeatedly
│ 👢 *Status:* Removed from group
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        await sock.groupParticipantsUpdate(from, [sender], "remove")

      } else {
        await sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  ⚠️ *LINK WARNING!*  ║
╚════════════════════╝

┌─────〔 🚫 *WARNING* 〕─────
│ 👤 *User:* @${tag}
│ 🔗 *Links are NOT allowed here!*
│ ⚠️ *Warnings:* ${warns}/${maxWarns}
│ 🗑️ Message has been deleted
│ ⚡ *${maxWarns - warns} more = KICK!*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
      }
    }

  } catch (err) {
    console.error("Antilink handler error:", err)
  }
}

module.exports = { handleAntilink }
