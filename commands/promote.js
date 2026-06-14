'use strict'
/**
 * commands/promote.js — CYBER X | Promote Member to Admin
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

const { getAdmins, toNum } = require('../lib/isAdmin')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function getTarget(msg) {
  // Priority 1: @mention
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  if (mentioned.length) return mentioned[0]

  // Priority 2: reply-to quoted message sender
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  if (ctx?.participant) return ctx.participant
  if (ctx?.remoteJid?.endsWith('@s.whatsapp.net')) return ctx.remoteJid

  return null
}

module.exports = {
  pattern:  'promote',
  desc:     'Promote a member to admin',
  usage:    '.promote @user  OR  reply to message + .promote',
  category: 'admin',

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

    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `❌ I need to be an *admin* to promote members.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const target = getTarget(msg)
    if (!target) {
      return sock.sendMessage(from, {
        text: `❌ Tag someone or reply to their message:\n*.promote @user*\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const targetNum = `@${target.split('@')[0]}`
    const byNum     = `@${sender.split('@')[0]}`

    const admins = getAdmins(from)
    if (admins.has(toNum(target))) {
      return sock.sendMessage(from, {
        text: `⚠️ ${targetNum} is *already an admin!*\n\n${CREDIT}`,
        mentions: [target],
      }, { quoted: msg })
    }

    // React instantly
    sock.sendMessage(from, {
      react: { text: '⬆️', key: msg.key }
    }).catch(() => {})

    await sock.groupParticipantsUpdate(from, [target], 'promote')

    await sock.sendMessage(from, {
      text:
`╔══════════════════════════╗
║   ⬆️ *PROMOTED TO ADMIN*  ║
╚══════════════════════════╝

👤 *User:* ${targetNum}
👑 *By:*   ${byNum}

✅ Now has *admin privileges*

${CREDIT}`,
      mentions: [target, sender],
    }, { quoted: msg })
  },
}
