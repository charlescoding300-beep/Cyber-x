// commands/delete.js — CYBER X AI (Simple Delete)

const CREDIT = "© 𝕮𝖄𝕭𝙀𝙍 𝖃"

module.exports = {
  pattern: "del",

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
    if (isGroup && !isOwner) {
      const meta = await sock.groupMetadata(from)

      const admins = meta.participants
        .filter(p => p.admin !== null)
        .map(p => p.id)

      const isAdmin = admins.includes(sender)

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
