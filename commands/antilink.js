'use strict'

let db
try { db = require('../lib/userDb') } catch { db = null }

function getCfg(phone, jid) {
  if (!db) return { enabled: false, action: 'delete' }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  return s.groups?.[jid] || { enabled: false, action: 'delete' }
}

function setCfg(phone, jid, u) {
  if (!db) return
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = { ...(s.groups[jid] || { enabled: false, action: 'delete' }), ...u }
  db.setSection(phone, 'antilink', s)
}

let OCR = false
try { require('tesseract.js'); OCR = true } catch {}

module.exports = {
  pattern: 'antilink',
  alias: ['al'],
  desc: 'Control link protection for this group',
  usage: '.antilink on|off|delete|warn|kick',
  category: 'group',

  async run({ sock, from, msg, args, isGroup, isAdmin, isBotAdmin }) {
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: 'This command can only be used in a group.',
      }, { quoted: msg })
    }
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: 'Please make me a group admin first, then try again.',
      }, { quoted: msg })
    }
    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: 'Only group admins can manage link protection.',
      }, { quoted: msg })
    }

    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()
    const cfg = getCfg(phone, from)

    if (!sub) {
      return sock.sendMessage(from, {
        text:
`*Link Protection*

Status  ·  ${cfg.enabled ? 'Enabled' : 'Disabled'}
Action  ·  ${cfg.action || 'delete'}
OCR     ·  ${OCR ? 'Available' : 'Not installed'}

*Commands*
.antilink on       Enable
.antilink off      Disable
.antilink delete   Delete link messages
.antilink warn     Warn (3 times → remove)
.antilink kick     Remove immediately`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      setCfg(phone, from, { enabled: true, action: cfg.action || 'delete' })
      return sock.sendMessage(from, {
        text: `Link protection is now *enabled*.\nAction: *${cfg.action || 'delete'}*`,
      }, { quoted: msg })
    }

    if (sub === 'off') {
      setCfg(phone, from, { enabled: false })
      return sock.sendMessage(from, {
        text: 'Link protection is now *disabled* for this group.',
      }, { quoted: msg })
    }

    if (['delete', 'warn', 'kick'].includes(sub)) {
      setCfg(phone, from, { enabled: true, action: sub })
      const lines = {
        delete: 'Link messages will be deleted.',
        warn: 'Members get 3 warnings, then they are removed.',
        kick: 'Members who share links are removed immediately.',
      }
      return sock.sendMessage(from, {
        text: `Link protection is *enabled*.\nMode: *\( {sub}*\n \){lines[sub]}`,
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: 'Unknown option. Type *.antilink* to see available commands.',
    }, { quoted: msg })
  },
}
