'use strict'
// commands/termination.js
// .termination on | off | status   (admin-only, group-only)
// Turns the zero-tolerance link / status-tag / anti-bot kick system on or off
// for THIS group. See core/termination.js for what it actually watches for.
//
// Admin check here is done LIVE against group metadata every time — it does
// not rely on the isAdmin flag the dispatcher passes in. A command that can
// instantly kick people shouldn't have a single point of failure for who's
// allowed to turn it on.

const termination = require('../core/termination')

async function isRealGroupAdmin(sock, groupId, senderJid) {
  const senderNorm = termination.normalizeNum(senderJid)
  if (!senderNorm) return false
  try {
    const meta = await sock.groupMetadata(groupId)
    return !!meta?.participants?.some(p => {
      const ids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(termination.normalizeNum)
      return ids.includes(senderNorm) && (p.admin === 'admin' || p.admin === 'superadmin')
    })
  } catch (e) {
    console.error('[TERMINATION] live admin check failed:', e.message)
    return false // can't verify -> fail closed, never allow the toggle
  }
}

async function isBotGroupAdmin(sock, groupId) {
  const botNorm = termination.normalizeNum(sock.user?.id || '')
  try {
    const meta = await sock.groupMetadata(groupId)
    return !!meta?.participants?.some(p => {
      const ids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(termination.normalizeNum)
      return ids.includes(botNorm) && (p.admin === 'admin' || p.admin === 'superadmin')
    })
  } catch {
    return false
  }
}

module.exports = {
  pattern: 'termination',
  alias: ['terminate'],
  category: 'admin',
  desc: 'Zero-tolerance anti-link / anti-status-tag / anti-bot instant-kick mode for this group.',
  usage: '.termination on | off | status',

  run: async ({ sock, from, msg, args = [], isGroup, sender, settings }) => {
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ Termination mode is a group-only command.' }, { quoted: msg })
    }

    const admin = await isRealGroupAdmin(sock, from, sender)
    if (!admin) {
      return sock.sendMessage(from, { text: '❌ Group admin required to toggle termination mode.' }, { quoted: msg })
    }

    const phone = sock.user?.id?.replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '') || settings?.phone
    const sub = (args[0] || '').toLowerCase()

    if (sub === 'on') {
      await sock.sendMessage(from, { react: { text: '☣️', key: msg.key } }).catch(() => {})
      termination.enable(phone, from)

      const botAdmin = await isBotGroupAdmin(sock, from)
      const warn = botAdmin ? '' : '\n\n⚠️ The bot itself isn\'t a group admin here yet — detection is on, but it can\'t actually kick anyone until it is.'
      return sock.sendMessage(from, { text: termination.ACTIVATE_TEXT + warn }, { quoted: msg })
    }

    if (sub === 'off') {
      await sock.sendMessage(from, { react: { text: '☣️', key: msg.key } }).catch(() => {})
      termination.disable(phone, from)
      return sock.sendMessage(from, { text: termination.DEACTIVATE_TEXT }, { quoted: msg })
    }

    if (sub === 'status') {
      const on = termination.isEnabled(phone, from)
      return sock.sendMessage(from, {
        text: `☣️ *Termination mode:* ${on ? 'ON' : 'OFF'}\nWatching: links (incl. channel/invite links), status-tags, bot signatures + message bursts.`,
      }, { quoted: msg })
    }

    return sock.sendMessage(from, { text: `❌ Usage: *.termination on | off | status*` }, { quoted: msg })
  },
}
