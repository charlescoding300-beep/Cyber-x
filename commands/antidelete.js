'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antidelete.js  —  CYBER X  |  Antidelete toggle
//
// USAGE (owner only):
//   .antidelete on   → enable
//   .antidelete off  → disable
//   .antidelete      → show current status
//
// The actual detection/recovery/reporting engine lives directly inside
// index.js (storeMessage, handleMessageRevocation, antideleteReport) —
// this command is ONLY the on/off switch. It calls the
// antideleteGetEnabled / antideleteSetEnabled functions that index.js
// passes into every command's run() context.
//
// One global toggle PER SESSION (per linked WhatsApp account) — applies
// automatically to every DM and every group that session's bot is in.
// Supports text, image, video, GIF, sticker, voice note, and audio —
// all of it gets cached on arrival and re-sent to the owner's own DM if
// deleted, with who deleted it and where.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  'antidelete',
  alias:    [],
  desc:     'Toggle antidelete — recovers deleted messages/media to owner DM',
  usage:    '.antidelete on/off',
  category: 'group/admin',

  async run({ sock, from, msg, args, isOwner, antideleteGetEnabled, antideleteSetEnabled }) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '❌ Only the bot owner can use this command.' }, { quoted: msg })
    }

    if (typeof antideleteGetEnabled !== 'function' || typeof antideleteSetEnabled !== 'function') {
      return sock.sendMessage(from, {
        text: '❌ Antidelete engine not available — check that index.js was updated with the antidelete functions.',
      }, { quoted: msg })
    }

    const sub = (args[0] || '').toLowerCase()

    if (!sub) {
      const enabled = antideleteGetEnabled()
      return sock.sendMessage(from, {
        text:
          `🗑️ *Antidelete*\n\n` +
          `Status: ${enabled ? '🟢 ON' : '🔴 OFF'}\n\n` +
          `Applies automatically to every DM and every group this bot is in.\n` +
          `Recovers: text, image, video, GIF, sticker, voice note, audio.\n` +
          `Sends recovered content + who deleted it + where, straight to your DM.\n\n` +
          `*.antidelete on* — enable\n` +
          `*.antidelete off* — disable`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      antideleteSetEnabled(true)
      return sock.sendMessage(from, {
        text: '✅ Antidelete *enabled*. Deleted messages/media across every chat will now be sent here.',
      }, { quoted: msg })
    }

    if (sub === 'off') {
      antideleteSetEnabled(false)
      return sock.sendMessage(from, { text: '🔴 Antidelete *disabled*.' }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: '❌ Invalid usage. Type *.antidelete* to see options.',
    }, { quoted: msg })
  },
}
