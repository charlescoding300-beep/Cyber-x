// ─────────────────────────────────────────────────────────
// commands/unmute.js — ZEN X UNMUTE COMMAND
//
// Usage:
//   .unmute   → unmute group + cancel any running mute timer
// ─────────────────────────────────────────────────────────

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

module.exports = {
  pattern:  "unmute",
  desc:     "Unmute the group — everyone can send messages again",
  usage:    ".unmute",
  category: 'group',

  async run({ sock, from, msg, sender, args, lib, commands, isAdmin, isBotAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `> ❌ *Unmute only works in groups.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Independent admin re-check ─────────────────────────
    let verifiedAdmin = isOwner
    if (!verifiedAdmin) {
      try {
        const meta = await sock.groupMetadata(from)
        const senderNum = (sender || "").split("@")[0].split(":")[0]
        verifiedAdmin = meta.participants.some(p => {
          const pNum = (p.id || "").split("@")[0].split(":")[0]
          return pNum === senderNum && (p.admin === "admin" || p.admin === "superadmin")
        })
      } catch (e) {
        verifiedAdmin = false
      }
    }

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *Only group admins can use this command.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *I need to be an admin to unmute the group.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Cancel active mute timer if one exists ────────────
    const muteCmd   = commands.get("mute")
    const timers    = muteCmd?.muteTimers
    let   hadTimer  = false
    let   timerLabel = null

    if (timers?.has(from)) {
      const entry = timers.get(from)
      clearTimeout(entry.timeoutId)
      timerLabel = entry.label
      timers.delete(from)
      hadTimer = true
    }

    // ── Unmute the group ──────────────────────────────────
    try {
      await sock.groupSettingUpdate(from, "not_announcement")
    } catch (e) {
      return sock.sendMessage(from, {
        text: `> ❌ *Failed to unmute:* \( {e.message}\n>\n \){CREDIT}`,
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text:
`> 🔊 *GROUP UNMUTED*
>
> ✅ Everyone can send messages again
> ${hadTimer ? `⏱️ Timer cancelled *(was ${timerLabel})*` : `ℹ️ No active timer was running`}
>
> 💡 Use *.mute* to lock again
>
${CREDIT}`,
      quoted: msg
    })
  }
}
