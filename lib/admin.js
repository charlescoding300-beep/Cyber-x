// ─────────────────────────────────────────────────────────
// lib/admin.js  —  CYBER X admin helpers
// ─────────────────────────────────────────────────────────
//
// Handles the Baileys JID normalization problem:
//   sock.user.id  →  "1234567890:12@s.whatsapp.net"  (has :XX device suffix)
//   participants  →  "1234567890@s.whatsapp.net"      (no suffix)
//   @lid JIDs     →  "37555378630815@lid"             (completely different format)
//
// normJid() strips the :XX suffix so both sides match.
// All guards send a clean error message and return false so command
// files can do:  if (!await Admin.requireBotAdmin(...)) return
// ─────────────────────────────────────────────────────────

/**
 * Strip the Baileys device-suffix (:XX) so JIDs compare correctly.
 * e.g. "1234567890:12@s.whatsapp.net" → "1234567890@s.whatsapp.net"
 * e.g. "1234567890@s.whatsapp.net"    → "1234567890@s.whatsapp.net"  (unchanged)
 */
function normJid(jid = "") {
  return jid.replace(/:.*@/, "@").toLowerCase().trim()
}

/**
 * Fetch live group metadata and return admin status for both the
 * sender and the bot.  Always uses fresh data from Baileys.
 *
 * @param {object} sock    - Baileys socket
 * @param {string} groupJid
 * @param {string} senderJid
 * @returns {{ admins: string[], isAdmin: boolean, isBotAdmin: boolean }}
 */
async function getAdminStatus(sock, groupJid, senderJid) {
  const meta   = await sock.groupMetadata(groupJid)
  const admins = meta.participants
    .filter(p => p.admin)
    .map(p => normJid(p.id))

  const botJid    = normJid(sock.user?.id)
  const senderNorm = normJid(senderJid)

  return {
    admins,
    isAdmin:    admins.includes(senderNorm),
    isBotAdmin: botJid ? admins.includes(botJid) : false,
  }
}

/**
 * Guard: replies with an error and returns false if the bot is NOT an admin.
 * Usage at the top of any command that needs bot-admin rights:
 *   if (!await Admin.requireBotAdmin(sock, from, isBotAdmin)) return
 */
async function requireBotAdmin(sock, from, isBotAdmin) {
  if (!isBotAdmin) {
    await sock.sendMessage(from, {
      text: "❌ I need to be a group admin to use this command."
    })
    return false
  }
  return true
}

/**
 * Guard: replies with an error and returns false if the sender is NOT an admin.
 * Usage:
 *   if (!await Admin.requireAdmin(sock, from, isAdmin)) return
 */
async function requireAdmin(sock, from, isAdmin) {
  if (!isAdmin) {
    await sock.sendMessage(from, {
      text: "❌ Only group admins can use this command."
    })
    return false
  }
  return true
}

/**
 * Guard: replies with an error and returns false if NOT in a group.
 * Usage:
 *   if (!await Admin.requireGroup(sock, from, isGroup)) return
 */
async function requireGroup(sock, from, isGroup) {
  if (!isGroup) {
    await sock.sendMessage(from, {
      text: "❌ This command only works in groups."
    })
    return false
  }
  return true
}

/**
 * Guard: replies with an error and returns false if NOT the bot owner.
 * Usage:
 *   if (!await Admin.requireOwner(sock, from, isOwner)) return
 */
async function requireOwner(sock, from, isOwner) {
  if (!isOwner) {
    await sock.sendMessage(from, {
      text: "❌ Only the bot owner can use this command."
    })
    return false
  }
  return true
}

module.exports = {
  normJid,
  getAdminStatus,
  requireBotAdmin,
  requireAdmin,
  requireGroup,
  requireOwner,
}
