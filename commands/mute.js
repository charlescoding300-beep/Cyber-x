// commands/mute.js  —  CYBER X
// ─────────────────────────────────────────────────────────
// Usage: .mute [secs] [days] [months] [years]
//
//   .mute             → mute indefinitely  (lift with .unmute)
//   .mute 30          → 30 seconds
//   .mute 0 1         → 1 day
//   .mute 0 0 1       → 1 month  (~30 days)
//   .mute 0 0 0 1     → 1 year   (~365 days)
//   .mute 30 1 0 0    → 30 secs + 1 day combined
//
// Requires:
//   • sender must be a group admin
//   • bot must be a group admin
//
// isBotAdmin is already fixed in index.js (normJid patch).
// The "Make me admin" reply below is therefore only shown when
// the bot genuinely isn't in the admin list.
// ─────────────────────────────────────────────────────────

const muteTimers = require('../lib/muteTimers')

module.exports = {
  pattern: 'mute',
  desc:    'Mute the group for a duration or indefinitely',
  usage:   '.mute [secs] [days] [months] [years]',

  run: async ({ sock, from, msg, args, isAdmin, isGroup, isBotAdmin }) => {

    // ── Guards ─────────────────────────────────────────────────────────────
    if (!isGroup)
      return sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg })

    if (!isAdmin)
      return sock.sendMessage(from, { text: '❌ Only admins can mute the group.' }, { quoted: msg })

    if (!isBotAdmin)
      return sock.sendMessage(from, { text: '❌ Make me a group admin first so I can mute.' }, { quoted: msg })

    // ── Parse duration args ────────────────────────────────────────────────
    const secs   = Math.max(0, parseInt(args[0]) || 0)
    const days   = Math.max(0, parseInt(args[1]) || 0)
    const months = Math.max(0, parseInt(args[2]) || 0)
    const years  = Math.max(0, parseInt(args[3]) || 0)

    const totalMs =
      (secs +
       days   * 86_400 +
       months * 30  * 86_400 +
       years  * 365 * 86_400) * 1_000

    // ── Mute the group (only admins can send) ──────────────────────────────
    try {
      await sock.groupSettingUpdate(from, 'announcement')
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Failed to mute: ${err.message}` }, { quoted: msg })
    }

    // ── Timed mute ─────────────────────────────────────────────────────────
    if (totalMs > 0) {
      // Cancel any existing timer for this group
      if (muteTimers.has(from)) {
        clearTimeout(muteTimers.get(from))
        muteTimers.delete(from)
      }

      const label = formatDuration(secs, days, months, years)

      await sock.sendMessage(from, {
        text: `🔇 *Group muted for ${label}.*\nWill auto-unmute when timer expires.`
      }, { quoted: msg })

      const timer = setTimeout(async () => {
        try {
          await sock.groupSettingUpdate(from, 'not_announcement')
          await sock.sendMessage(from, { text: '🔊 *Mute expired — group is open again.*' })
        } catch {}
        muteTimers.delete(from)
      }, totalMs)

      muteTimers.set(from, timer)

    // ── Indefinite mute ────────────────────────────────────────────────────
    } else {
      // Clear any leftover timer so .unmute isn't confused
      if (muteTimers.has(from)) {
        clearTimeout(muteTimers.get(from))
        muteTimers.delete(from)
      }

      await sock.sendMessage(from, {
        text: '🔇 *Group muted indefinitely.*\nUse *.unmute* to restore messaging.'
      }, { quoted: msg })
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(secs, days, months, years) {
  const parts = []
  if (years)  parts.push(`${years} year${years   > 1 ? 's' : ''}`)
  if (months) parts.push(`${months} month${months > 1 ? 's' : ''}`)
  if (days)   parts.push(`${days} day${days     > 1 ? 's' : ''}`)
  if (secs)   parts.push(`${secs} second${secs   > 1 ? 's' : ''}`)
  return parts.join(', ')
}
