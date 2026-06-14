// ════════════════════════════════════════════════════════════════════
//  lib/abwa.js  —  CYBER X  |  👑 Anti-Tag Engine (ADMINS ONLY)
//  • Monitors ADMINS only — normal members are ignored here
//  • Triggers on: @all / @everyone text OR 5+ mentions at once
//  • DELETE fires FIRST always, then configured action after
//  • Your index.js lib-loader picks this up automatically
// ════════════════════════════════════════════════════════════════════
'use strict'

const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'abwa.json')
let _db = {}
try { if (fs.existsSync(FILE)) _db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {}

function _save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(_db, null, 2))
  } catch (e) { console.error('[abwa] save error:', e.message) }
}

function _defaults() {
  return { enabled: false, action: 'delete', warns: {} }
}

function getSettings(from) {
  if (!_db[from]) _db[from] = _defaults()
  _db[from] = { ..._defaults(), ..._db[from] }
  return _db[from]
}

function saveSettings(from, s) { _db[from] = s; _save() }

const toNum = jid => (jid || '').replace(/:.*@/, '@').split('@')[0]

// ── Did this message try to tag everyone? ─────────────────────────
function _isTagMsg(msg) {
  const ctx = (
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo        ||
    msg.message?.videoMessage?.contextInfo        ||
    msg.message?.documentMessage?.contextInfo     || {}
  )
  const mentioned = ctx.mentionedJid || []

  const body =
    msg.message?.conversation                        ||
    msg.message?.extendedTextMessage?.text           ||
    msg.message?.imageMessage?.caption               ||
    msg.message?.videoMessage?.caption               || ''

  const hasTagText = /@everyone|@all|@here/i.test(body)
  return mentioned.length >= 5 || hasTagText
}

// ══════════════════════════════════════════════════════════════════
//  MAIN HANDLER — auto-loaded by index.js lib loader
//  Receives: { sock, from, msg, sender, isAdmin }
// ══════════════════════════════════════════════════════════════════
async function handleAbwa({ sock, from, msg, sender, isAdmin }) {
  if (!from?.endsWith('@g.us')) return   // groups only
  const s = getSettings(from)
  if (!s.enabled) return                 // feature off
  if (!isAdmin) return                   // only fires FOR admins
  if (!_isTagMsg(msg)) return            // not a tag message

  const action = s.action || 'delete'
  const MAX    = 3

  // ── STEP 1: DELETE the message FIRST, always ──────────────────
  try { await sock.sendMessage(from, { delete: msg.key }) } catch {}

  // ── STEP 2: Configured action ─────────────────────────────────
  if (action === 'delete') {
    await sock.sendMessage(from, {
      text:
`╔══════════════════════════╗
║  👑 *ABWA — TAG DELETED* ║
╚══════════════════════════╝
@${toNum(sender)} even admins can't mass tag here 😏
Message deleted.

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      mentions: [sender],
    })
    return
  }

  if (action === 'warn') {
    if (!s.warns) s.warns = {}
    s.warns[sender] = (s.warns[sender] || 0) + 1
    saveSettings(from, s)
    const count = s.warns[sender]

    if (count >= MAX) {
      // Demote first, then kick
      try { await sock.groupParticipantsUpdate(from, [sender], 'demote') } catch {}
      await sock.sendMessage(from, {
        text:
`╔══════════════════════════╗
║  👑 *ABWA — DEMOTE+KICK* ║
╚══════════════════════════╝
@${toNum(sender)} has been *demoted & removed* 👢
${MAX} tag warnings. Admin privileges revoked.

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender],
      })
      try { await sock.groupParticipantsUpdate(from, [sender], 'remove') } catch {}
      s.warns[sender] = 0
      saveSettings(from, s)
    } else {
      await sock.sendMessage(from, {
        text:
`╔══════════════════════════╗
║  👑 *ABWA — WARN*        ║
╚══════════════════════════╝
@${toNum(sender)} ⚠️ Admin Warning *${count}/${MAX}*
Mass tagging is not allowed — even for admins.
${count === MAX - 1 ? '\n🚨 *Next tag = demote + removal!*' : ''}

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender],
      })
    }
    return
  }

  if (action === 'kick') {
    // Demote first, then kick — you can't kick an admin without demoting
    try { await sock.groupParticipantsUpdate(from, [sender], 'demote') } catch {}
    await sock.sendMessage(from, {
      text:
`╔══════════════════════════╗
║  👑 *ABWA — DEMOTE+KICK* ║
╚══════════════════════════╝
@${toNum(sender)} has been *demoted & removed* 👢
Zero tolerance — admin or not.

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      mentions: [sender],
    })
    try { await sock.groupParticipantsUpdate(from, [sender], 'remove') } catch {}
  }
}

module.exports = { handleAbwa, getSettings, saveSettings }
