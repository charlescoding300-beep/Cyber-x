// commands/add.js — CYBER X AI
const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"

// ── Clean and format phone number ─────────────────────────────────────────────
function formatNumber(num) {
  // Remove all non-digits
  const cleaned = num.replace(/\D/g, "")
  if (!cleaned) return null
  return `${cleaned}@s.whatsapp.net`
}

module.exports = {
  pattern: ".add",

  run: async ({ sock, from, msg, sender, args }) => {
    // ── Group only ────────────────────────────────────────────────────────────
    if (!from.endsWith("@g.us")) {
      return sock.sendMessage(from, {
        text: `❌ This command only works in groups.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }

    try {
      const meta = await sock.groupMetadata(from)

      // ── Sender must be admin ──────────────────────────────────────────────
      const senderData  = meta.participants.find(p => p.id === sender)
      const isAdmin     = senderData?.admin === "admin" || senderData?.admin === "superadmin"

      if (!isAdmin) {
        return sock.sendMessage(from, {
          text: `❌ Only admins can use this command.\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Bot must be admin ─────────────────────────────────────────────────
      const botId      = sock.user.id.replace(/:.*@/, "@")
      const botData    = meta.participants.find(p => p.id === botId)
      const botIsAdmin = botData?.admin === "admin" || botData?.admin === "superadmin"

      if (!botIsAdmin) {
        return sock.sendMessage(from, {
          text: `❌ I need to be an admin to add members.\n\n> ${CREDIT}`
        }, { quoted: msg })
      }

      let targets = []

      // ── Method 1: Reply to a message ──────────────────────────────────────
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant
                  || msg.message?.imageMessage?.contextInfo?.participant
                  || msg.message?.videoMessage?.contextInfo?.participant

      if (quoted) {
        targets.push(quoted)

      // ── Method 2: .add 2348012345678 or .add 234 801 234 5678 ─────────────
      } else if (args.length > 0) {
        const rawNumbers = args.join("").split(/[,\s]+/).filter(Boolean)
        for (const raw of rawNumbers) {
          const formatted = formatNumber(raw)
          if (formatted) targets.push(formatted)
        }

      } else {
        return sock.sendMessage(from, {
          text: `❌ *How to use .add:*\n\n` +
                `1️⃣ Reply to someone's message:\n_Reply + .add_\n\n` +
                `2️⃣ Single number:\n_.add 2348012345678_\n\n` +
                `3️⃣ Multiple numbers:\n_.add 2348012345678 2347012345678_\n\n` +
                `> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Remove duplicates ─────────────────────────────────────────────────
      targets = [...new Set(targets)]

      // ── Already in group? ─────────────────────────────────────────────────
      const existingIds = meta.participants.map(p => p.id)
      const toAdd       = targets.filter(t => !existingIds.includes(t))
      const alreadyIn   = targets.filter(t => existingIds.includes(t))

      if (alreadyIn.length > 0) {
        const nums = alreadyIn.map(t => t.split("@")[0])
        await sock.sendMessage(from, {
          text: `ℹ️ Already in group: ${nums.map(n => `@${n}`).join(", ")}\n\n> ${CREDIT}`,
          mentions: alreadyIn
        })
      }

      if (toAdd.length === 0) return

      // ── Add members ───────────────────────────────────────────────────────
      const results = await sock.groupParticipantsUpdate(from, toAdd, "add")

      let added   = []
      let failed  = []
      let notOnWA = []

      for (const r of results) {
        const num = r.jid?.split("@")[0]
        if (r.status === "200") {
          added.push(num)
        } else if (r.status === "408" || r.status === "403") {
          // 403 = privacy settings block add, 408 = not on WhatsApp
          notOnWA.push(num)
        } else {
          failed.push(num)
        }
      }

      // ── Build result message ──────────────────────────────────────────────
      let response =
        `╔═══════════════════╗\n` +
        `║   🤖 *𝘾𝙔𝘽𝙀𝙍 𝙓  AI*   ║\n` +
        `╚═══════════════════╝\n\n`

      if (added.length > 0) {
        response += `✅ *Added successfully:*\n${added.map(n => `👤 @${n}`).join("\n")}\n\n`
      }
      if (notOnWA.length > 0) {
        response += `⚠️ *Couldn't add (privacy/not on WhatsApp):*\n${notOnWA.map(n => `❌ ${n}`).join("\n")}\n\n`
      }
      if (failed.length > 0) {
        response += `❌ *Failed:*\n${failed.map(n => `❌ ${n}`).join("\n")}\n\n`
      }

      response += `> ${CREDIT}`

      await sock.sendMessage(from, {
        text: response,
        mentions: toAdd
      }, { quoted: msg })

    } catch (e) {
      console.error("ADD ERROR:", e.message)
      await sock.sendMessage(from, {
        text: `⚠️ Failed to add member. Make sure I'm an admin.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}
