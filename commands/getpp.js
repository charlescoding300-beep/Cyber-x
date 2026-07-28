// commands/getpp.js — CYBER X
// .getpp — get profile picture of mentioned user, replied user, or yourself

module.exports = {
  pattern:  "getpp",
  category: 'utility',
  desc:     "Get a user's profile picture",
  usage:    ".getpp @user | reply to a message",

  async run({ sock, from, msg, args }) {

    // ── resolve target JID ─────────────────────────────────────────────────
    let targetJid = null

    // 1. reply-to
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant ||
                   msg.message?.extendedTextMessage?.contextInfo?.remoteJid
    if (quoted) targetJid = quoted

    // 2. @mention
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
    if (!targetJid && mentions?.length) targetJid = mentions[0]

    // 3. fallback — sender themselves
    if (!targetJid) targetJid = msg.key.participant || msg.key.remoteJid

    // ── normalize JID (handles @lid vs @s.whatsapp.net mismatches) ─────────
    // Baileys sometimes hands back a LID (@lid) instead of the real PN jid.
    // profilePictureUrl needs the real jid to resolve correctly.
    async function normalizeJid(jid) {
      if (!jid) return jid
      if (jid.endsWith('@lid')) {
        try {
          // onWhatsApp can resolve a LID back to the PN jid in most Baileys versions
          const [result] = await sock.onWhatsApp(jid)
          if (result?.jid) return result.jid
        } catch (e) {
          console.log('[getpp] LID normalize failed:', e?.message)
        }
      }
      return jid
    }

    targetJid = await normalizeJid(targetJid)

    // ── fetch profile picture (try high-res, fall back to preview) ─────────
    let ppUrl = null
    let lastErr = null
    for (const type of ["image", "preview"]) {
      try {
        ppUrl = await sock.profilePictureUrl(targetJid, type)
        if (ppUrl) break
      } catch (e) {
        lastErr = e
      }
    }

    const num = targetJid.replace("@s.whatsapp.net", "").replace(/:\d+$/, "")

    if (!ppUrl) {
      // Log the real reason instead of swallowing it — helps you tell
      // "privacy restricted" (403/not-authorized) apart from a genuine bug.
      console.log(`[getpp] failed for ${targetJid}:`, lastErr?.message || lastErr || 'no error captured')

      return sock.sendMessage(from, {
        text:     `🤲🏻 Could not get profile picture for @${num}\n(either it's private, or they have no photo set)`,
        mentions: [targetJid],
      }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      image:    { url: ppUrl },
      caption:  `╭━━━〔 🖼 *PROFILE PICTURE* 〕━━━╮\n┃\n┃ 👤 @${num}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      mentions: [targetJid],
    }, { quoted: msg })
  }
}

