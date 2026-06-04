// commands/kick.js — CYBER X AI
const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"

module.exports = {
  pattern: ".kick",

  run: async ({ sock, from, msg, sender }) => {
    // ── Group only ────────────────────────────────────────────────────────────
    if (!from.endsWith("@g.us")) {
      return sock.sendMessage(from, {
        text: `❌ This command only works in groups.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }

    try {
      const meta = await sock.groupMetadata(from)

      // ── Sender must be admin ──────────────────────────────────────────────
      const senderData = meta.participants.find(p => p.id === sender)
      const isAdmin    = senderData?.admin === "admin" || senderData?.admin === "superadmin"

      if (!isAdmin) {
        return sock.sendMessage(from, {
          text: `❌ Only admins can use this command.\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Must be a reply ───────────────────────────────────────────────────
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant
                  || msg.message?.imageMessage?.contextInfo?.participant
                  || msg.message?.videoMessage?.contextInfo?.participant

      if (!quoted) {
        return sock.sendMessage(from, {
          text: `❌ Reply to someone's message to kick them.\n\nExample: Reply to a message then type *.kick*\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Can't kick yourself ───────────────────────────────────────────────
      if (quoted === sender) {
        return sock.sendMessage(from, {
          text: `😂 You can't kick yourself!\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Can't kick the bot ────────────────────────────────────────────────
      const botId = sock.user.id.replace(/:.*@/, "@")
      if (quoted === botId) {
        return sock.sendMessage(from, {
          text: `😅 I won't kick myself out!\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Can't kick another admin ──────────────────────────────────────────
      const targetData = meta.participants.find(p => p.id === quoted)
      const targetIsAdmin = targetData?.admin === "admin" || targetData?.admin === "superadmin"

      if (targetIsAdmin) {
        return sock.sendMessage(from, {
          text: `❌ You can't kick an admin.\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Kick ──────────────────────────────────────────────────────────────
      const num = quoted.split("@")[0]

      await sock.sendMessage(from, {
        text: `╔═══════════════════╗\n` +
              `║   🤖 *𝘾𝙔𝘽𝙀𝙍 𝙓 AI*   ║\n` +
              `╚═══════════════════╝\n\n` +
              `🦵 @${num} has been kicked from the group!\n\n` +
              `> ${CREDIT}`,
        mentions: [quoted]
      })

      await sock.groupParticipantsUpdate(from, [quoted], "remove")

    } catch (e) {
      console.error("KICK ERROR:", e.message)
      await sock.sendMessage(from, {
        text: `⚠️ Failed to kick. Make sure I'm an admin.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}
