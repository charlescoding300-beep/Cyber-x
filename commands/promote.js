'use strict'
/**
 * commands/promote.js — ZENX | Promote Member to Admin
 *
 * Usage:
 *   .promote @user        ← tag someone
 *   reply to msg + .promote  ← reply to their message
 *
 * ✅ Uses lib/isAdmin.js — zero network calls
 * ✅ Works with @mention OR reply-to
 * ✅ Checks sender is admin or owner
 * ✅ Checks bot is admin
 * ✅ Guards: already admin, no target, not a group
 * ✅ Quoted reply + instant reaction
 */

const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

function getTarget(msg) {
  // Priority 1: @mention
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  if (mentioned.length) return mentioned[0]

  // Priority 2: reply-to quoted message sender
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  if (ctx?.participantPn || ctx?.participantAlt || ctx?.participant) return ctx.participantPn || ctx.participantAlt || ctx.participant
  if (ctx?.remoteJid?.endsWith('@s.whatsapp.net')) return ctx.remoteJid

  return null
}

module.exports = {
  pattern:  'promote',
  desc:     'Promote a member to admin',
  usage:    '.promote @user  OR  reply to message + .promote',
  category: 'group',

  run: async ({ sock, from, msg, sender, isOwner, isAdmin, isBotAdmin }) => {

    if (!from.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: `❌ This command works in *groups only!*\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, {
        text: `❌ You need to be an *admin* to promote members.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const target = getTarget(msg)
    if (!target) {
      return sock.sendMessage(from, {
        text: `❌ Tag someone or reply to their message:\n*.promote @user*\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    let context
    try { context = await adminLib.getGroupAdminContext(sock, from, sender, msg.key?.participantPn || msg.key?.participantAlt) }
    catch (error) { console.error('[PROMOTE] admin lookup failed:', error.message) }
    if (!context?.available) {
      return sock.sendMessage(from, { text: `⚠️ I could not verify current group permissions. Please try again.\n\n${CREDIT}` }, { quoted: msg })
    }
    if (!context.botAdmin && !isBotAdmin) return sendBotNotAdmin(sock, from, msg)
    if (!isOwner && !context.senderAdmin && !isAdmin) {
      return sock.sendMessage(from, { text: `❌ You need to be a group admin to promote members.\n\n${CREDIT}` }, { quoted: msg })
    }
    const targetParticipant = context.meta.participants.find(p => adminLib.participantMatches(p, target))
    if (!targetParticipant) {
      return sock.sendMessage(from, { text: `⚠️ I could not find that member in this group.\n\n${CREDIT}` }, { quoted: msg })
    }
    const targetJid = targetParticipant.id || targetParticipant.jid || targetParticipant.lid || target
    const targetNum = `@${(targetParticipant.phoneNumber || targetJid).split('@')[0].split(':')[0]}`
    const byNum     = `@${String(sender || '').split('@')[0].split(':')[0]}`

    if (adminLib.isAdminParticipant(targetParticipant)) {
      return sock.sendMessage(from, {
        text: `⚠️ ${targetNum} is *already an admin!*\n\n${CREDIT}`,
        mentions: [target],
      }, { quoted: msg })
    }

    // React instantly
    sock.sendMessage(from, {
      react: { text: '⬆️', key: msg.key }
    }).catch(() => {})

    await sock.groupParticipantsUpdate(from, [targetJid], 'promote')

    await sock.sendMessage(from, {
      text:
`╔══════════════════════════╗
║   ⬆️ *PROMOTED TO ADMIN*  ║
╚══════════════════════════╝

👤 *User:* ${targetNum}
👑 *By:*   ${byNum}

✅ Now has *admin privileges*

${CREDIT}`,
      mentions: [targetJid, sender],
    }, { quoted: msg })
  },
}
