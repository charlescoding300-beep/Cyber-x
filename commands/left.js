/**
 * .left — owner-only. Drops a cold, one-line-energy exit message, then
 * the bot leaves the group. No warnings, no explanations, just vibes.
 */

module.exports = {
  name:     "left",
  aliases:  ["leave", "exit"],
  desc:     "Owner only: drops an exit message and leaves the group.",
  usage:    ".left",
  category: "owner",

  async run({ sock, from, msg, isOwner, isGroup, helper }) {
    if (!isOwner) return helper.reply(sock, msg, "❌ Owner only.")
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works inside a group.")

    const farewell = `𖤍 𝙂𝙊𝙉𝙀 𖤍\n𖤍 𝘽𝙔𝙀 𝙈𝙁 𖤍`

    try {
      await sock.sendMessage(from, { text: farewell }, { quoted: msg })
    } catch (e) {
      console.error("[LEFT] send failed:", e.message)
    }

    // small pause so the message actually lands before the bot exits
    await new Promise(r => setTimeout(r, 1200))

    try {
      await sock.groupLeave(from)
      console.log(`[LEFT] 👋 Left group ${from} on request of owner`)
    } catch (e) {
      console.error("[LEFT] groupLeave failed:", e.message)
      try { await sock.sendMessage(from, { text: `❌ Couldn't leave: ${e.message}` }) } catch {}
    }
  },
}
