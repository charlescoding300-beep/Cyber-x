// commands/unmute.js  —  CYBER X
// ─────────────────────────────────────────────────────────
// Usage: .unmute
//
// • Cancels any active auto-unmute timer for this group
// • Re-opens the group so everyone can message
//
// Requires:
//   • sender must be a group admin
//   • bot must be a group admin
// ─────────────────────────────────────────────────────────

const muteTimers = require('../lib/muteTimers')

module.exports = {
  pattern: 'unmute',
  desc:    'Unmute the group and cancel any active mute timer',
  usage:   '.unmute',

  run: async ({ sock, from, msg, isAdmin, isGroup, isBotAdmin }) => {

    // ── Guards ─────────────────────────────────────────────────────────────
    if (!isGroup)
      return sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg })

    if (!isAdmin)
      return sock.sendMessage(from, { text: '❌ Only admins can unmute the group.' }, { quoted: msg })

    if (!isBotAdmin)
      return sock.sendMessage(from, { text: '❌ Make me a group admin first so I can unmute.' }, { quoted: msg })

    // ── Cancel any active timer ────────────────────────────────────────────
    if (muteTimers.has(from)) {
      clearTimeout(muteTimers.get(from))
      muteTimers.delete(from)
    }

    // ── Unmute the group ───────────────────────────────────────────────────
    try {
      await sock.groupSettingUpdate(from, 'not_announcement')
    } catch (err) {
      return sock.sendMessage(from, { text: `❌ Failed to unmute: ${err.message}` }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      text: '🔊 *Group unmuted — everyone can message again.*'
    }, { quoted: msg })
  }
}
