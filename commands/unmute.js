// ════════════════════════════════════════════════════════════
//  commands/unmute.js  —  CYBER X  |  Group Unmute Command
//  Usage : .unmute   → lift mute instantly (cancels any timer)
//  Requires: bot + caller must both be group admins
// ════════════════════════════════════════════════════════════

// ── Shared timer registry (same global as mute.js) ──────────
if (!global.muteTimers) global.muteTimers = new Map()
const muteTimers = global.muteTimers

// ── Human-readable ms helper ────────────────────────────────
function humanMs(ms) {
  const s  = Math.floor(ms / 1_000)
  const m  = Math.floor(s  / 60)
  const h  = Math.floor(m  / 60)
  const d  = Math.floor(h  / 24)
  const mo = Math.floor(d  / 30)
  const y  = Math.floor(d  / 365)

  if (y  >= 1) return `${y} year${y  > 1 ? "s" : ""}`
  if (mo >= 1) return `${mo} month${mo > 1 ? "s" : ""}`
  if (d  >= 1) return `${d} day${d  > 1 ? "s" : ""}`
  if (h  >= 1) return `${h} hour${h  > 1 ? "s" : ""}`
  if (m  >= 1) return `${m} minute${m > 1 ? "s" : ""}`
  return `${s} second${s > 1 ? "s" : ""}`
}

// ════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ════════════════════════════════════════════════════════════
module.exports = {
  pattern: "unmute",
  desc:    "Unmute the group and cancel any active mute timer. Only admins.",
  usage:   ".unmute",

  run: async ({ sock, from, msg, sender, args, isAdmin, isBotAdmin, isGroup, settings }) => {

    // ── Guard: group only ──────────────────────────────────
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  ⚠️  GROUP ONLY          ║\n` +
              `╚══════════════════════════╝\n` +
              `_.unmute_ can only be used inside a group.`,
      }, { quoted: msg })
    }

    // ── Guard: caller must be admin ────────────────────────
    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🚫  ADMINS ONLY         ║\n` +
              `╚══════════════════════════╝\n` +
              `Only group admins can unmute the group.`,
      }, { quoted: msg })
    }

    // ── Guard: bot must be admin ───────────────────────────
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🤖  BOT NOT ADMIN       ║\n` +
              `╚══════════════════════════╝\n` +
              `Please make *${settings.botName}* a group admin first.`,
      }, { quoted: msg })
    }

    // ── Cancel any running auto-unmute timer ───────────────
    let timerWasCancelled  = false
    let timeRemaining      = null

    const existing = muteTimers.get(from)
    if (existing) {
      clearTimeout(existing.handle)
      muteTimers.delete(from)
      timerWasCancelled = true
      const msLeft = existing.endsAt - Date.now()
      timeRemaining = msLeft > 0 ? humanMs(msLeft) : null
    }

    // ── Unlock the group (allow everyone to send) ──────────
    try {
      await sock.groupSettingUpdate(from, "not_announcement")
    } catch (err) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  ❌  FAILED TO UNMUTE    ║\n` +
              `╚══════════════════════════╝\n` +
              `Error: ${err.message}`,
      }, { quoted: msg })
    }

    // ── Build confirmation message ─────────────────────────
    let timerLine = ""
    if (timerWasCancelled && timeRemaining) {
      timerLine = `*Timer:*     ⏹️ Cancelled (${timeRemaining} was left)\n`
    } else if (timerWasCancelled) {
      timerLine = `*Timer:*     ⏹️ Cancelled\n`
    }

    await sock.sendMessage(from, {
      text: `╔══════════════════════════╗\n` +
            `║  🔊  GROUP UNMUTED       ║\n` +
            `╚══════════════════════════╝\n\n` +
            `*Status:*    🟢 Open\n` +
            timerLine +
            `*By:*        @${sender.split("@")[0]}\n\n` +
            `Everyone can send messages again.`,
      mentions: [sender],
    }, { quoted: msg })
  },
}
