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

    // ── Independent admin re-check ─────────────────────────
    // Same as mute.js — don't only trust the isAdmin flag passed in from
    // index.js. Fetch fresh group metadata and verify the sender is
    // actually listed as admin/superadmin before allowing the unmute.
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
        // Can't verify → fail closed, do NOT allow the unmute.
        verifiedAdmin = false
      }
    }

    if (!verifiedAdmin) {
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
