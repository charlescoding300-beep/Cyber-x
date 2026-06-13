// ─────────────────────────────────────────────────────────
// commands/unmute.js — CYBER X UNMUTE COMMAND
//
// Usage:
//   .unmute   → unmute group + cancel any running mute timer
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "unmute",
  desc:     "Unmute the group — everyone can send messages again",
  usage:    ".unmute",
  category: "group",

  async run({ sock, from, msg, sender, args, lib, commands, isAdmin, isBotAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ *Unmute only works in groups.*",
        quoted: msg
      })
    }

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, {
        text: "❌ *Only group admins can use this command.*",
        quoted: msg
      })
    }

    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: "❌ *I need to be an admin to unmute the group.*",
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
        text: `❌ *Failed to unmute:* ${e.message}`,
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text:
`╔════════════════════╗
║  🔊 *GROUP UNMUTED* ║
╚════════════════════╝

┌─────〔 ✅ *UNLOCKED* 〕─────
│ 🔊 Everyone can *send messages*
│ ${hadTimer
  ? `⏱️ Timer cancelled *(was ${timerLabel})*`
  : `ℹ️ No active timer was running`}
│
│ 💡 Use *.mute* to lock again
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      quoted: msg
    })
  }
}
