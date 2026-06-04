// commands/tagall.js — CYBER X AI
const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"

module.exports = {
  pattern: ".tagall",

  run: async ({ sock, from, msg, args }) => {
    // ── Group only ────────────────────────────────────────────────────────────
    if (!from.endsWith("@g.us")) {
      return sock.sendMessage(from, {
        text: `❌ This command only works in groups.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }

    try {
      const meta    = await sock.groupMetadata(from)
      const members = meta.participants
      const title   = args.join(" ").trim() || "📢 Attention everyone!"

      // ── Build mention list ────────────────────────────────────────────────
      const mentions = members.map(m => m.id)

      // ── Build tag text ────────────────────────────────────────────────────
      const tags = members.map(m => {
        const num  = m.id.split("@")[0]
        const role = m.admin === "superadmin" ? "👑" : m.admin ? "⚡" : "👤"
        return `${role} @${num}`
      }).join("\n")

      const message =
        `╔═══════════════════╗\n` +
        `║   🤖 *𝘾𝙔𝘽𝙀𝙍 𝙓 AI*   ║\n` +
        `╚═══════════════════╝\n\n` +
        `📣 *${title}*\n\n` +
        `${tags}\n\n` +
        `👥 *${members.length} members tagged*\n\n` +
        `> ${CREDIT}`

      await sock.sendMessage(from, {
        text: message,
        mentions
      }, { quoted: msg })

    } catch (e) {
      console.error("TAGALL ERROR:", e.message)
      await sock.sendMessage(from, {
        text: `⚠️ Failed to tag members. Try again.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}

