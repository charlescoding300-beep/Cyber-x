'use strict'

let db
try { db = require('../lib/userDb') } catch { db = null }
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

let OCR = false
try { require('tesseract.js'); OCR = true } catch {}

const DEFAULT_WARN_LIMIT = 3
const ACTIONS = new Set(['delete', 'warn', 'kick'])

function getCfg(phone, jid) {
  if (!db) return { enabled: false, action: 'delete', maxWarns: DEFAULT_WARN_LIMIT }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  return s.groups?.[jid] || { enabled: false, action: 'delete', maxWarns: DEFAULT_WARN_LIMIT }
}

function setCfg(phone, jid, updates) {
  if (!db) return
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = { ...(s.groups[jid] || { enabled: false, action: 'delete' }), ...updates }
  db.setSection(phone, 'antilink', s)
}

function panel(title, rows) {
  return [
    `╭───「 ${title} 」───╮`,
    ...rows.map(row => `│ ${row}`),
    '╰────────────────────╯',
  ].join('\n')
}

function getAction(cfg) {
  return ACTIONS.has(cfg.action) ? cfg.action : 'delete'
}

function getWarnLimit(cfg) {
  const limit = Number.parseInt(cfg.maxWarns, 10)
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_WARN_LIMIT
}

function actionDescription(action, warnLimit) {
  if (action === 'warn') return `Warn only; persistent count (limit ${warnLimit})`
  if (action === 'kick') return 'Delete the link message and remove the sender immediately'
  return 'Delete the link message and send one deletion notice'
}

module.exports = {
  pattern: 'antilink',
  alias: ['al'],
  desc: 'Set how this group handles links',
  usage: '.antilink [on|off|delete|warn|kick]',
  category: 'group',

  async run({ sock, from, msg, args, isGroup, isAdmin, isBotAdmin }) {
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: 'Use *.antilink* inside a group.',
      }, { quoted: msg })
    }
    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: 'Only group admins can change link protection settings.',
      }, { quoted: msg })
    }

    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()
    const cfg = getCfg(phone, from)
    const action = getAction(cfg)
    const warnLimit = getWarnLimit(cfg)

    if (!sub) {
      return sock.sendMessage(from, {
        text:
          `${panel('ANTI-LINK', [
            `Status: ${cfg.enabled ? 'On' : 'Off'}`,
            `Mode: ${actionDescription(action, warnLimit)}`,
            `Admins: ${cfg.applyToAdmins ? 'included' : 'skipped'}`,
            `Image link scan: ${OCR ? 'Available' : 'Text only (OCR unavailable)'}`,
            'Warning counts: saved across VPS restarts',
          ])}\n\n` +
          `*Settings*\n` +
          `.antilink on — default delete mode\n` +
          `.antilink off — turn protection off\n` +
          `.antilink delete — delete and send one notice\n` +
          `.antilink warn — send one warning; count persists until reset\n` +
          `.antilink kick — remove a member immediately\n` +
          `.resetwarn antilink — reset a member's saved count (reply or mention)`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      const defaultAction = 'delete'
      if (!isBotAdmin) return sendBotNotAdmin(sock, from, msg)
      setCfg(phone, from, { enabled: true, action: defaultAction })
      return sock.sendMessage(from, {
        text: panel('ANTI-LINK', [
          '✅ Protection is on',
          `Mode: ${actionDescription(defaultAction, warnLimit)}`,
          'Warnings are saved across VPS restarts.',
        ]),
      }, { quoted: msg })
    }

    if (sub === 'off') {
      setCfg(phone, from, { enabled: false })
      return sock.sendMessage(from, {
        text: panel('ANTI-LINK', [
          '✅ Protection is off for this group',
          `Saved mode: ${actionDescription(action, warnLimit)}`,
        ]),
      }, { quoted: msg })
    }

    if (ACTIONS.has(sub)) {
      if (sub !== 'warn' && !isBotAdmin) return sendBotNotAdmin(sock, from, msg)
      setCfg(phone, from, { enabled: true, action: sub })
      return sock.sendMessage(from, {
        text: panel('ANTI-LINK', [
          '✅ Protection is on',
          `Mode: ${actionDescription(sub, warnLimit)}`,
        ]),
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: `❌ Unknown option: *${sub}*\nType *.antilink* to see the available settings.`,
    }, { quoted: msg })
  },
}
