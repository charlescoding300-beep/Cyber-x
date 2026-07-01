'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antibadword.js  —  CYBER X  |  Anti-Badword System
//
// USAGE:
//   .antibadword on              → enable for this group
//   .antibadword off             → disable for this group
//   .antibadword set delete      → delete offending message only
//   .antibadword set warn        → warn, kick after 3 warnings
//   .antibadword set kick        → kick immediately on detection
//
// DETECTION:
//   Hooked into index.js's message pipeline the same way handleAntilink is —
//   add this to index.js's messages.upsert loop:
//
//     if (!m.key.fromMe) {
//       if (typeof lib.handleBadword === "function") lib.handleBadword(sock, m, extractBody).catch(() => {})
//     }
//
//   Detection uses lib/isAdmin.js for BOTH checks:
//     - is the BOT an admin? (required to delete/kick at all)
//     - is the SENDER an admin? (admins are exempt from badword action)
//
//   NEW: Before ANY action (delete / kick / warn) is taken, the bot first
//   reacts 🫢 on the offending message itself. This fires for every mode,
//   since delete always happens first regardless of the configured action.
// ─────────────────────────────────────────────────────────────────────────────

let db
try { db = require('../lib/userDb') } catch { db = null }

let isAdminLib
try { isAdminLib = require('../lib/isAdmin') } catch { isAdminLib = null }

// Base words now live in lib/badWords.js — leetspeak normalization and
// repeated-letter collapsing below still apply on top of that list.
const BAD_WORDS = require('../lib/badWords')

// Leetspeak / symbol substitutions normalized before matching, so
// "f*ck", "f4ck", "n1gg4", "sh1t" etc all resolve to their base form.
const LEET_MAP = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g',
}

function normalizeLeet(text) {
  return text
    .toLowerCase()
    .split('')
    .map(ch => LEET_MAP[ch] || ch)
    .join('')
}

function cleanText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsBadWord(text) {
  // Pass 1: exact word match on cleaned text (handles plain bad words)
  const clean = cleanText(text)
  const words = clean.split(' ')

  for (const w of words) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }

  for (const phrase of BAD_WORDS) {
    if (phrase.includes(' ') && clean.includes(phrase)) return true
  }

  // Pass 2: leetspeak-normalized match (handles f4ck, sh1t, n1gg4, etc)
  const leetClean = cleanText(normalizeLeet(text))
  const leetWords = leetClean.split(' ')

  for (const w of leetWords) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }

  // Pass 3: collapse repeated letters (handles "fuuuuck", "shiiiit")
  const collapsed = leetClean.replace(/(.)\1{2,}/g, '$1$1')
  const collapsedWords = collapsed.split(' ')

  for (const w of collapsedWords) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }

  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-GROUP STORAGE — uses lib/userDb.js antibadword section
// Stored under the group's OWN jid as the "phone" key so it works
// per-session (each linked user's antibadword settings stay isolated)
// ─────────────────────────────────────────────────────────────────────────────

function getGroupConfig(ownerPhone, groupJid) {
  if (!db) return { enabled: false, action: 'delete' }
  const section = db.getSection(ownerPhone, 'antibadword') || { enabled: false, groups: {} }
  return section.groups?.[groupJid] || { enabled: false, action: 'delete' }
}

function setGroupConfig(ownerPhone, groupJid, updates) {
  if (!db) return
  const section = db.getSection(ownerPhone, 'antibadword') || { enabled: false, words: [], groups: {} }
  section.groups = section.groups || {}
  section.groups[groupJid] = { ...(section.groups[groupJid] || { enabled: false, action: 'delete' }), ...updates }
  db.setSection(ownerPhone, 'antibadword', section)
}

function getWarningCount(ownerPhone, groupJid, senderJid) {
  if (!db) return 0
  const section = db.getSection(ownerPhone, 'warns') || { groups: {} }
  return section.groups?.[groupJid]?.[senderJid] || 0
}

function incrementWarning(ownerPhone, groupJid, senderJid) {
  if (!db) return 1
  const section = db.getSection(ownerPhone, 'warns') || { maxWarns: 3, groups: {} }
  section.groups = section.groups || {}
  section.groups[groupJid] = section.groups[groupJid] || {}
  section.groups[groupJid][senderJid] = (section.groups[groupJid][senderJid] || 0) + 1
  db.setSection(ownerPhone, 'warns', section)
  return section.groups[groupJid][senderJid]
}

function resetWarning(ownerPhone, groupJid, senderJid) {
  if (!db) return
  const section = db.getSection(ownerPhone, 'warns') || { groups: {} }
  if (section.groups?.[groupJid]) {
    section.groups[groupJid][senderJid] = 0
    db.setSection(ownerPhone, 'warns', section)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND — .antibadword on/off/set
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  'antibadword',
  alias:    ['abw'],
  desc:     'Toggle bad word filtering in this group',
  usage:    '.antibadword on/off | .antibadword set delete/warn/kick',
  category: 'group/admin',

  async run({ sock, from, msg, args, sender, isGroup, isAdmin, isBotAdmin }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg })
    }

    // Bot must be a group admin for antibadword to be usable AT ALL —
    // without admin rights it can't delete/kick, so the command is gated
    // off entirely until someone promotes the bot.
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: '⚠️ I need to be a group admin first. Promote me, then any group admin can use *.antibadword*.',
      }, { quoted: msg })
    }

    // Any group admin can use this command — not just the bot owner.
    if (!isAdmin) {
      return sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg })
    }

    const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()

    if (!sub) {
      const cfg = getGroupConfig(ownerPhone, from)
      return sock.sendMessage(from, {
        text:
          `*🛡️ ANTIBADWORD SETUP*\n\n` +
          `Status: ${cfg.enabled ? '🟢 ON' : '🔴 OFF'}\n` +
          `Action: ${cfg.action || 'delete'}\n\n` +
          `*.antibadword on* — Turn on antibadword\n` +
          `*.antibadword off* — Turn off antibadword\n` +
          `*.antibadword set delete* — Delete message only\n` +
          `*.antibadword set warn* — Warn, kick after 3 warnings\n` +
          `*.antibadword set kick* — Kick immediately`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      const cfg = getGroupConfig(ownerPhone, from)
      if (cfg.enabled) {
        return sock.sendMessage(from, { text: 'ℹ️ AntiBadword is already enabled.' }, { quoted: msg })
      }
      setGroupConfig(ownerPhone, from, { enabled: true, action: cfg.action || 'delete' })
      return sock.sendMessage(from, {
        text: '✅ AntiBadword *enabled*. Default action: delete.\nUse *.antibadword set <action>* to customize.',
      }, { quoted: msg })
    }

    if (sub === 'off') {
      const cfg = getGroupConfig(ownerPhone, from)
      if (!cfg.enabled) {
        return sock.sendMessage(from, { text: 'ℹ️ AntiBadword is already disabled.' }, { quoted: msg })
      }
      setGroupConfig(ownerPhone, from, { enabled: false })
      return sock.sendMessage(from, { text: '✅ AntiBadword *disabled* for this group.' }, { quoted: msg })
    }

    if (sub === 'set') {
      const action = (args[1] || '').toLowerCase()
      if (!['delete', 'kick', 'warn'].includes(action)) {
        return sock.sendMessage(from, {
          text: '❌ Invalid action. Choose: *delete*, *kick*, or *warn*',
        }, { quoted: msg })
      }
      setGroupConfig(ownerPhone, from, { action })
      return sock.sendMessage(from, { text: `✅ AntiBadword action set to: *${action}*` }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: '❌ Invalid usage. Type *.antibadword* to see options.',
    }, { quoted: msg })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION HANDLER — called from index.js on every incoming group message.
// Exported separately so index.js's lib loader can pick it up as
// lib.handleBadword (same pattern as lib.handleAntilink).
// ─────────────────────────────────────────────────────────────────────────────

async function handleBadword(sock, msg, extractBody) {
  const from = msg.key.remoteJid
  if (!from?.endsWith('@g.us')) return
  if (msg.key.fromMe) return

  const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
  const cfg = getGroupConfig(ownerPhone, from)

  // DEBUG — remove once confirmed working
  console.log('[ABW]', { from, enabled: cfg.enabled, action: cfg.action })

  if (!cfg.enabled) return

  const body = extractBody(msg)
  console.log('[ABW] body:', body)
  if (!body || !containsBadWord(body)) return

  const sender = msg.key.participant || from
  const senderAlt = msg.key.participantPn || null

  // ── Bot must be admin to take action ────────────────────────────────────────
  let isBotAdmin = false
  let isSenderAdmin = false

  if (isAdminLib) {
    try {
      const meta = await sock.groupMetadata(from)
      const groupCache = { [from]: meta }
      isBotAdmin    = isAdminLib.isBotAdmin(groupCache, from, sock)
      isSenderAdmin = isAdminLib.isAdmin(groupCache, from, sender, sock, null, senderAlt)
    } catch (e) {
      console.error('[ANTIBADWORD] isAdmin check failed:', e.message)
      return
    }
  } else {
    // Fallback if lib/isAdmin.js isn't available — check metadata directly
    try {
      const meta = await sock.groupMetadata(from)
      const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net'
      const bot = meta.participants.find(p => p.id === botId)
      const participant = meta.participants.find(p => p.id === sender)
      isBotAdmin    = !!bot?.admin
      isSenderAdmin = !!participant?.admin
    } catch (e) {
      console.error('[ANTIBADWORD] metadata fetch failed:', e.message)
      return
    }
  }

  if (!isBotAdmin) return        // can't enforce without admin rights
  if (isSenderAdmin) return      // admins are exempt

  // ── React 🫢 on the offending message BEFORE taking any action ──────────────
  // Fires for every mode (delete / kick / warn) since delete always
  // happens first regardless of the configured action.
  try {
    await sock.sendMessage(from, { react: { text: '🫢', key: msg.key } })
  } catch (e) {
    console.error('[ANTIBADWORD] react failed:', e.message)
  }

  // ── Delete the offending message ─────────────────────────────────────────────
  try {
    await sock.sendMessage(from, { delete: msg.key })
  } catch (e) {
    console.error('[ANTIBADWORD] delete failed:', e.message)
    return
  }

  // ── Take action based on configured mode ─────────────────────────────────────
  const action = cfg.action || 'delete'

  if (action === 'delete') {
    await sock.sendMessage(from, {
      text: `⚠️ @${sender.split('@')[0]} bad words are not allowed here.`,
      mentions: [sender],
    }).catch(() => {})
    return
  }

  if (action === 'kick') {
    try {
      await sock.groupParticipantsUpdate(from, [sender], 'remove')
      await sock.sendMessage(from, {
        text: `🚫 @${sender.split('@')[0]} has been kicked for using bad words.`,
        mentions: [sender],
      })
    } catch (e) {
      console.error('[ANTIBADWORD] kick failed:', e.message)
    }
    return
  }

  if (action === 'warn') {
    const count = incrementWarning(ownerPhone, from, sender)
    if (count >= 3) {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove')
        resetWarning(ownerPhone, from, sender)
        await sock.sendMessage(from, {
          text: `🚫 @${sender.split('@')[0]} has been kicked after 3 warnings.`,
          mentions: [sender],
        })
      } catch (e) {
        console.error('[ANTIBADWORD] kick-after-warn failed:', e.message)
      }
    } else {
      await sock.sendMessage(from, {
        text: `⚠️ @${sender.split('@')[0]} warning ${count}/3 for using bad words.`,
        mentions: [sender],
      }).catch(() => {})
    }
  }
}

module.exports.handleBadword = handleBadword

