'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/add.js  —  CYBER X  |  Add member to group
//
// USAGE (group only — admin or bot owner only):
//   .add 234812345678        → add by international number
//   .add (reply to a message from someone who left) → add that person back
//
// PERMISSIONS:
//   - Group admins: allowed
//   - Bot owner: allowed even if NOT a group admin in this group
//   - Regular members: blocked entirely
//   Uses isAdmin/isOwner exactly as passed in from index.js's checkGroupAdmin.
//
// GROUP SETTINGS CHECK:
//   Before attempting the add, reads groupMetadata.memberAddMode. If it's
//   "admin_add" (only admins may add members) AND the person running the
//   command is NOT actually a group admin (i.e. they're only here via the
//   owner bypass), the command refuses with:
//     "*settings as prohibited me from adding*"
//   This only blocks the owner-bypass case — a real admin is always
//   allowed to add regardless of this setting, since the setting itself
//   is about restricting non-admins.
//
// REACTIONS (exactly two, per spec):
//   ✅ — person was added successfully
//   ❗ — add call did not error, but WhatsApp blocked it due to the
//        target's privacy settings (status 403). Bot fetches the group's
//        invite link and DMs it directly to that person, and reports
//        their number back in the group chat.
//   ❌ — total failure for any other reason (bot not admin, invalid
//        number, not on WhatsApp, already a member, etc) — the specific
//        reason is included in the chat reply.
//
// Baileys' groupParticipantsUpdate returns Promise<Array<{ status, jid }>>
// — one status per participant, not a single throw/success. Status "200"
// = added. "403" = privacy-restricted, needs invite link. Anything else
// (401/404/408/etc, or simply not "200") falls into the ❌ branch with
// whatever status code WhatsApp returned, since not every non-success
// code is officially documented and a generic message is safer than
// guessing at meanings that may not hold.
// ─────────────────────────────────────────────────────────────────────────────

function extractTargetJid(args, msg) {
  // Method 1: .add <number> — supports any formatting style:
  //   .add 2348123456789
  //   .add 234 3556 2663 3663      (spaced)
  //   .add +234 812 345 6789       (with + and spaces)
  //   .add 234-812-345-6789        (dashed)
  //   .add (234) 812 345 6789      (parenthesized)
  // args is already split on whitespace by the message handler, so a
  // spaced number arrives as multiple args — join them all back together
  // BEFORE stripping non-digits, otherwise only args[0] (the first chunk)
  // would be read and the rest of the number would be silently dropped.
  const joined = args.join('')
  const rawNum = joined.replace(/\D/g, '')
  if (rawNum.length >= 8) {
    return `${rawNum}@s.whatsapp.net`
  }

  // Method 2: reply to a message from someone who left the group
  const quotedParticipant =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.participant ||
    null

  if (quotedParticipant) return quotedParticipant

  return null
}

module.exports = {
  pattern:  'add',
  alias:    [],
  desc:     'Add a member to this group (admin/owner only)',
  usage:    '.add 234812345678  |  reply to someone\'s message with .add',
  category: 'group',

  async run({ sock, from, msg, args, isAdmin, isOwner, isGroup }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg })
    }

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: '❌ Only group admins or the bot owner can use this command.' }, { quoted: msg })
    }

    const target = extractTargetJid(args, msg)
    if (!target) {
      return sock.sendMessage(from, {
        text:
          '❌ Usage:\n' +
          '*.add 234812345678* — add by number\n' +
          '*.add* (reply to a message from someone who left) — add them back',
      }, { quoted: msg })
    }

    // ── Group settings check ──────────────────────────────────────────────
    // Only blocks the OWNER-bypass path. A real group admin is always
    // allowed regardless of memberAddMode, since that setting exists
    // specifically to restrict non-admins.
    if (!isAdmin && isOwner) {
      try {
        const meta = await sock.groupMetadata(from)
        if (meta.memberAddMode === 'admin_add') {
          return sock.sendMessage(from, {
            text: '*settings as prohibited me from adding*',
          }, { quoted: msg })
        }
      } catch (e) {
        // If metadata fetch fails, fall through and let the actual
        // groupParticipantsUpdate call be the source of truth.
      }
    }

    // ── Attempt the add ────────────────────────────────────────────────────
    let results
    try {
      results = await sock.groupParticipantsUpdate(from, [target], 'add')
    } catch (e) {
      await sock.sendMessage(from, { react: { text: ' ❌', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `❌ Couldn't add *${target.split('@')[0]}* — ${e.message}`,
      }, { quoted: msg }).catch(() => {})
    }

    const result = Array.isArray(results) ? results[0] : null
    const status = result?.status
    const num    = target.split('@')[0]

    // ── ✅ Success ──────────────────────────────────────────────────────────
    if (status === '200' || status === 200) {
      await sock.sendMessage(from, { react: { text: ' ✅', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `✅ Added *${num}* to the group.`,
      }, { quoted: msg }).catch(() => {})
    }

    // ── ❗ Privacy-blocked — send invite link directly to the person ───────
    if (status === '403' || status === 403) {
      await sock.sendMessage(from, { react: { text: ' ❗', key: msg.key } }).catch(() => {})

      let inviteSent = false
      try {
        const code = await sock.groupInviteCode(from)
        const link = `https://chat.whatsapp.com/${code}`
        await sock.sendMessage(target, {
          text: `You've been invited to join a group! Tap to join:\n${link}`,
        })
        inviteSent = true
      } catch (e) {
        // Could fail if the person also blocks DMs from unknown numbers —
        // that's reported below regardless of which way it fails.
      }

      return sock.sendMessage(from, {
        text:
          `❗ Couldn't add *${num}* directly due to their privacy settings.\n` +
          (inviteSent
            ? `An invite link was sent to their DM instead.`
            : `Tried sending an invite link to their DM, but that failed too — they may have DM privacy restrictions as well.`),
      }, { quoted: msg }).catch(() => {})
    }

    // ── ❌ Any other failure ─────────────────────────────────────────────────
    await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
    return sock.sendMessage(from, {
      text: `❌ Couldn't add *${num}* — WhatsApp returned status: ${status ?? 'unknown'}.`,
    }, { quoted: msg }).catch(() => {})
  },
}
