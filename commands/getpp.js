// commands/getpp.js — CYBER X
// .getpp — get profile picture of mentioned user, replied user, or yourself

module.exports = {
  pattern:  "getpp",
  category: "UTILITY",
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

    // ── fetch profile picture ──────────────────────────────────────────────
    let ppUrl = null
    try {
      ppUrl = await sock.profilePictureUrl(targetJid, "image")
    } catch {}

    const num = targetJid.replace("@s.whatsapp.net", "").replace(/:\d+$/, "")

    if (!ppUrl) {
      return sock.sendMessage(from, {
        text:     `🤲🏻 Could not get user profile picture for @${num}`,
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
