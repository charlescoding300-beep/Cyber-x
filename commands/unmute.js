// ─────────────────────────────────────────────────────────
// commands/unmute.js — ZEN X UNMUTE COMMAND
//
// Usage:
//   .unmute   → unmute group + cancel any running mute timer
// ─────────────────────────────────────────────────────────

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

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
    let adminContext
    try {
      adminContext = await adminLib.getGroupAdminContext(
        sock, from, sender,
        msg.key?.participantPn || msg.key?.participantAlt || msg.participantPn || msg.participantAlt,
      )
    } catch (e) {
      console.error('[UNMUTE] group role check failed:', e.message)
    }
    if (!adminContext?.available) {
      return sock.sendMessage(from, {
        text: `> ⚠️ *I could not verify current group permissions. Please try again.*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }
    const verifiedAdmin = isOwner || adminContext.senderAdmin

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *Only group admins can use this command.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    if (!adminContext.botAdmin) {
      return sendBotNotAdmin(sock, from, msg)
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
        text: `> ❌ *Failed to unmute:* ${e.message}\n>\n${CREDIT}`,
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
