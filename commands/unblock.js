'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/unblock.js  —  CYBER X  |  Owner-only DM unblock
//
// USAGE (DM only, owner only):
//   .unblock   → unblocks whoever the owner is currently DMing with
//
// Mirrors commands/block.js exactly — no arguments needed, just run
// .unblock inside the DM you want to unblock. Uses Baileys'
// updateBlockStatus("unblock") against `from`.
//
// NOTE: this works even though the contact is currently blocked, because
// `from` still resolves to their JID for an existing chat thread — Baileys
// doesn't require the chat to be unblocked first to target it.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  'unblock',
  alias:    [],
  desc:     'Unblock the person in this DM (owner only)',
  usage:    '.unblock',
  category: 'owner',

  async run({ sock, from, msg, isOwner, isGroup }) {
    if (!isOwner) {
      return sock.sendMessage(from, { text: '❌ Only the owner can use this command.' }, { quoted: msg })
    }

    if (isGroup) {
      return sock.sendMessage(from, { text: '❌ This command only works in a DM, not a group.' }, { quoted: msg })
    }

    const target = from   // in a DM, `from` IS the other person's JID
    const num = target.split('@')[0]

    try {
      await sock.updateBlockStatus(target, 'unblock')
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Failed to unblock ${num}: ${e.message}`,
      }, { quoted: msg }).catch(() => {})
    }

    return sock.sendMessage(from, {
      text: `✅ Unblocked *${num}*.`,
    }, { quoted: msg }).catch(() => {})
  },
}
