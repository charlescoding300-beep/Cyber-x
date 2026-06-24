'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/block.js  —  CYBER X  |  Owner-only DM block
//
// USAGE (DM only, owner only):
//   .block   → blocks whoever the owner is currently DMing with
//
// No arguments, no tagging, no number needed — just run .block inside the
// DM you want to block. Uses Baileys' updateBlockStatus("block") against
// `from`, which in a DM is the other person's JID.
//
// NOTE: confirmation is sent to `from` (the blocked JID) AFTER the block
// call succeeds. Sending a message to a JID you just blocked still works
// fine on WhatsApp/Baileys — blocking only stops THEM from messaging YOU,
// it doesn't stop you from messaging them. So the confirmation will still
// arrive in that chat for the owner to see.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  'block',
  alias:    [],
  desc:     'Block the person in this DM (owner only)',
  usage:    '.block',
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
      await sock.updateBlockStatus(target, 'block')
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Failed to block ${num}: ${e.message}`,
      }, { quoted: msg }).catch(() => {})
    }

    return sock.sendMessage(from, {
      text: `🚫 Blocked *${num}*.`,
    }, { quoted: msg }).catch(() => {})
  },
}
