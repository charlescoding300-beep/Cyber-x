// commands/del.js — CYBER X AI (Simple Delete)

const CREDIT = "© 𝕮𝖄𝕭𝙀𝙍 𝖃"

let isAdminLib
try { isAdminLib = require("../lib/isAdmin") } catch { isAdminLib = null }

module.exports = {
  pattern: "del",
  alias:   ["delete"],
  category: 'utility',

  run: async ({ sock, from, msg, sender, isOwner }) => {

    const isGroup = from.endsWith("@g.us")

    // ── Get replied message ─────────────────────────────
    const quoted = msg.message?.extendedTextMessage?.contextInfo

    if (!quoted?.stanzaId) {
      return sock.sendMessage(from, {
        text:
          `❌ Reply to a message to delete it\n\n> ${CREDIT}`
      }, { quoted: msg })
    }

    // ── Group admin check ───────────────────────────────
    // Uses lib/isAdmin.js instead of a manual participants.filter check.
    // The manual version checked `p.admin !== null`, which misjudges
    // admins on setups where WhatsApp returns @lid-keyed participants
    // with admin info split across p.lid/p.phoneNumber instead of a
    // plain p.admin string on the matching id — the exact issue already
    // fixed in lib/isAdmin.js's buildAdminSet(), which indexes every
    // identity form (id, lid, phoneNumber) for each admin. Reusing that
    // here instead of re-implementing a second, less reliable check.
    if (isGroup && !isOwner) {
      let isAdmin = false

      if (isAdminLib) {
        try {
          const meta = await sock.groupMetadata(from)
          const groupCache = { [from]: meta }
          const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
          isAdmin = isAdminLib.isAdmin(groupCache, from, sender, sock, null, senderAlt)
        } catch (e) {
          console.error("DEL ADMIN CHECK ERROR:", e.message)
          isAdmin = false
        }
      } else {
        // Fallback if lib/isAdmin.js somehow isn't available
        try {
          const meta = await sock.groupMetadata(from)
          const admins = meta.participants
            .filter(p => p.admin === "admin" || p.admin === "superadmin")
            .map(p => p.id)
          isAdmin = admins.includes(sender)
        } catch (e) {
          isAdmin = false
        }
      }

      if (!isAdmin) {
        return sock.sendMessage(from, {
          text:
            `❌ Only group admins can delete messages\n\n> ${CREDIT}`
        }, { quoted: msg })
      }
    }

    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: quoted.stanzaId,
          participant: quoted.participant
        }
      })

      await sock.sendMessage(from, {
        text: `🗑️ Message deleted\n\n> ${CREDIT}`
      }, { quoted: msg })

    } catch (e) {
      console.error("DELETE ERROR:", e.message)

      await sock.sendMessage(from, {
        text: `❌ Failed to delete message\n\n> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}
