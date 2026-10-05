'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antibadword.js  —  ZENX  |  Anti-Badword System
//
// USAGE (all in one step):
//   .antibadword on          → enable (keeps current action)
//   .antibadword off         → disable
//   .antibadword delete      → enable + action = delete
//   .antibadword warn        → enable + action = warn (3x = kick)
//   .antibadword kick        → enable + action = kick immediately
//   .antibadword             → show current status
//
// Aliases: .abw
// ─────────────────────────────────────────────────────────────────────────────

let db
try { db = require('../lib/userDb') } catch { db = null }

let isAdminLib
try { isAdminLib = require('../lib/isAdmin') } catch { isAdminLib = null }

// Prefer the expanded engine if present, otherwise fall back to simple list
let detectFn = null
let BAD_WORDS = []
try {
  const engine = require('../lib/antibadword')
  if (typeof engine.detectBadWordFull === 'function') {
    detectFn = engine.detectBadWordFull
  } else if (typeof engine.detectBadWord === 'function') {
    detectFn = async (t) => engine.detectBadWord(t)
  }
  if (Array.isArray(engine.WORD_LIST)) BAD_WORDS = engine.WORD_LIST
} catch {}

if (!BAD_WORDS.length) {
  try { BAD_WORDS = require('../lib/badWords') } catch { BAD_WORDS = [] }
}

// ── Leetspeak helpers (used only if advanced engine is missing) ───────────────
const LEET_MAP = {
  '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a',
  '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g',
}

function normalizeLeet(text) {
  return text.toLowerCase().split('').map(ch => LEET_MAP[ch] || ch).join('')
}

function cleanText(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function containsBadWordSimple(text) {
  const clean = cleanText(text)
  const words = clean.split(' ')
  for (const w of words) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }
  for (const phrase of BAD_WORDS) {
    if (phrase.includes(' ') && clean.includes(phrase)) return true
  }
  const leetClean = cleanText(normalizeLeet(text))
  for (const w of leetClean.split(' ')) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }
  const collapsed = leetClean.replace(/(.)\1{2,}/g, '$1$1')
  for (const w of collapsed.split(' ')) {
    if (w.length < 2) continue
    if (BAD_WORDS.includes(w)) return true
  }
  return false
}

async function isBad(text) {
  if (!text) return false
  if (detectFn) {
    const hit = await detectFn(text)
    return !!hit
  }
  return containsBadWordSimple(text)
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-GROUP STORAGE
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
  section.groups[groupJid] = {
    ...(section.groups[groupJid] || { enabled: false, action: 'delete' }),
    ...updates,
  }
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
// COMMAND — .antibadword <action>
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  'antibadword',
  alias:    ['abw'],
  desc:     'Toggle bad word filtering in this group',
  usage:    '.antibadword on|off|delete|warn|kick',
  category: 'group',

  async run({ sock, from, msg, args, sender, isGroup, isAdmin, isBotAdmin }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: '❌ This command only works in groups.' }, { quoted: msg })
    }

    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: '⚠️ I need to be a group admin first. Promote me, then any group admin can use *.antibadword*.',
      }, { quoted: msg })
    }

    if (!isAdmin) {
      return sock.sendMessage(from, { text: '❌ Only group admins can use this command.' }, { quoted: msg })
    }

    const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()

    if (!sub) {
      const cfg = getGroupConfig(ownerPhone, from)
      return sock.sendMessage(from, {
        text:
`*🛡️ ANTIBADWORD*

Status : ${cfg.enabled ? '🟢 ON' : '🔴 OFF'}
Action : *${cfg.action || 'delete'}*

*Quick commands (one step):*
.antibadword on       → turn on
.antibadword off      → turn off
.antibadword delete   → on + delete message
.antibadword warn     → on + warn (3× = kick)
.antibadword kick     → on + kick immediately`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      const cfg = getGroupConfig(ownerPhone, from)
      setGroupConfig(ownerPhone, from, { enabled: true, action: cfg.action || 'delete' })
      return sock.sendMessage(from, {
        text: `✅ AntiBadword *ON*\nAction: *${cfg.action || 'delete'}*`,
      }, { quoted: msg })
    }

    if (sub === 'off') {
      setGroupConfig(ownerPhone, from, { enabled: false })
      return sock.sendMessage(from, { text: '✅ AntiBadword *OFF* for this group.' }, { quoted: msg })
    }

    if (['delete', 'warn', 'kick'].includes(sub)) {
      setGroupConfig(ownerPhone, from, { enabled: true, action: sub })
      const desc = {
        delete: 'Message will be deleted only',
        warn:   'Warn → kick after 3 warnings',
        kick:   'Kick immediately',
      }[sub]
      return sock.sendMessage(from, {
        text: `✅ AntiBadword *ON*\nAction set to: *\( {sub}*\n \){desc}`,
      }, { quoted: msg })
    }

    if (sub === 'set') {
      const action = (args[1] || '').toLowerCase()
      if (!['delete', 'kick', 'warn'].includes(action)) {
        return sock.sendMessage(from, {
          text: '❌ Use: *.antibadword delete / warn / kick*',
        }, { quoted: msg })
      }
      setGroupConfig(ownerPhone, from, { enabled: true, action })
      return sock.sendMessage(from, {
        text: `✅ AntiBadword *ON*\nAction set to: *${action}*`,
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: '❌ Invalid. Type *.antibadword* to see options.',
    }, { quoted: msg })
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION HANDLER — reply quoted + delete at the same time
// ─────────────────────────────────────────────────────────────────────────────

async function handleBadword(sock, msg, extractBody) {
  const from = msg.key?.remoteJid
  if (!from?.endsWith('@g.us')) return
  if (msg.key.fromMe) return

  const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
  const cfg = getGroupConfig(ownerPhone, from)
  if (!cfg.enabled) return

  const body = extractBody(msg)
  if (!body) return

  let wordHit = null
  if (detectFn) {
    try { wordHit = await detectFn(body) } catch {}
  }
  if (!wordHit && !(await isBad(body))) return
  if (!wordHit) wordHit = 'bad language'

  const sender = msg.key.participant || from
  const senderAlt = msg.key.participantPn || null
  const tag = String(sender.split('@')[0] || '').replace(/:\d+$/, '')

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

  // Admins exempt
  if (isSenderAdmin) return

  // Bot not admin → quoted notice only
  if (!isBotAdmin) {
    await sock.sendMessage(from, {
      text:
`🫢 *Bad word detected*

@${tag} used inappropriate language, but I am *not a group admin*, so I cannot delete it. 🔕

Please promote me to admin to enforce this filter.`,
      mentions: [sender],
    }, { quoted: msg }).catch(() => {})
    return
  }

  // React
  try {
    await sock.sendMessage(from, { react: { text: '🫢', key: msg.key } })
  } catch {}

  // Delete
  try {
    await sock.sendMessage(from, { delete: msg.key })
  } catch (e) {
    console.error('[ANTIBADWORD] delete failed:', e.message)
  }

  const action = cfg.action || 'delete'
  const wordLabel = String(wordHit).replace(/\s*\(fuzzy≈.*\)$/i, '').slice(0, 40)

  // Reply quoted (same style as antilink)
  if (action === 'delete') {
    await sock.sendMessage(from, {
      text:
`╔══════════════════════╗
║  🫢  BAD WORD REMOVED ║
╚══════════════════════╝

👤 @${tag}
🔤 Word: \`${wordLabel}\`
📌 Keep the group clean.

> © Zen X`,
      mentions: [sender],
    }, { quoted: msg }).catch(() => {})
    return
  }

  if (action === 'kick') {
    try {
      await sock.groupParticipantsUpdate(from, [sender], 'remove')
    } catch (e) {
      console.error('[ANTIBADWORD] kick failed:', e.message)
    }
    await sock.sendMessage(from, {
      text:
`╔══════════════════════╗
║  🚫  MEMBER REMOVED   ║
╚══════════════════════╝

👤 @${tag}
🔤 Word: \`${wordLabel}\`
📌 Removed for using bad language.

> © Zen X`,
      mentions: [sender],
    }, { quoted: msg }).catch(() => {})
    return
  }

  if (action === 'warn') {
    const count = incrementWarning(ownerPhone, from, sender)
    const maxW = 3
    if (count >= maxW) {
      resetWarning(ownerPhone, from, sender)
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove')
      } catch (e) {
        console.error('[ANTIBADWORD] kick-after-warn failed:', e.message)
      }
      await sock.sendMessage(from, {
        text:
`╔════════════════════════╗
║  🚫  REMOVED (WARN MAX) ║
╚════════════════════════╝

👤 @${tag}
🔤 Word: \`${wordLabel}\`
⚠️ Warnings: *\( {count}/ \){maxW}*
📌 Too many bad-word warnings.

> © zen X`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
    } else {
      const left = maxW - count
      await sock.sendMessage(from, {
        text:
`╔══════════════════════╗
║  ⚠️  WARNING \( {count}/ \){maxW}      ║
╚══════════════════════╝

👤 @${tag}
🔤 Word: \`${wordLabel}\`
⏳ *\( {left}* more warning \){left === 1 ? '' : 's'} → removal

> © zenX`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
    }
  }
}

module.exports.handleBadword = handleBadword
