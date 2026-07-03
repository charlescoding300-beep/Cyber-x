'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/anticall.js  —  CYBER X  |  Anti-call toggle
//
// USAGE (owner only):
//   .anticall on      → enable: incoming calls get rejected only (no block)
//   .anticall off     → disable
//   .anticall status  → check current state
//
// State is stored per-session (per phone number) via the settings object
// that's already passed into every command's run({ settings }) — same
// pattern as autoTyping/autoRecording/etc already used in index.js.
//
// The actual call-rejection logic lives in index.js's startBot(), wired to
// Baileys' sock.ev.on('call', ...) — this file only flips the on/off flag.
// ─────────────────────────────────────────────────────────────────────────────

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

module.exports = {
  pattern:  'anticall',
  alias:    ['acall'],
  desc:     'Auto-reject incoming WhatsApp calls',
  usage:    '.anticall on | .anticall off | .anticall status',
  category: 'settings',

  async run({ sock, from, msg, args, settings, isOwner }) {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ Only the bot owner can use this command.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const action = (args[0] || '').toLowerCase()

    if (action === 'on') {
      settings.set('anticall', true)
      return sock.sendMessage(from, {
        text: `📵 *Anticall enabled.*\nIncoming calls will be auto-rejected.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    if (action === 'off') {
      settings.set('anticall', false)
      return sock.sendMessage(from, {
        text: `✅ *Anticall disabled.*\nIncoming calls will be allowed through normally.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    if (action === 'status') {
      const state = settings.get('anticall') ? '📵 Enabled' : '✅ Disabled'
      return sock.sendMessage(from, {
        text: `*Anticall status:* ${state}\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text:
        `📵 *Anticall Commands*\n\n` +
        `• *.anticall on* — reject incoming calls\n` +
        `• *.anticall off* — allow calls normally\n` +
        `• *.anticall status* — check current state\n\n` +
        `*Current:* ${settings.get('anticall') ? '📵 Enabled' : '✅ Disabled'}\n\n${CREDIT}`,
    }, { quoted: msg })
  },
}
