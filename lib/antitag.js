// ════════════════════════════════════════════════════════════════════
//  lib/antitag.js  —  ZENX  |  🏷️ Anti-Tag Engine (MEMBERS ONLY)
//  • Monitors NORMAL MEMBERS only — admins are always exempt
//  • Triggers on: @all / @everyone text OR 5+ mentions at once
//  • Delete always fires FIRST before any other action
//  • Your index.js lib-loader picks this up automatically
// ════════════════════════════════════════════════════════════════════
'use strict'

const fs   = require('fs')
const path = require('path')

const FILE = path.join(__dirname, '..', 'data', 'antitag.json')
let _db = {}
try { if (fs.existsSync(FILE)) _db = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {}

function _save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(_db, null, 2))
  } catch (e) { console.error('[antitag] save error:', e.message) }
}

function _defaults() {
  return { enabled: true, action: 'delete', warns: {} }
}

function getSettings(from) {
  if (!_db[from]) _db[from] = _defaults()
  _db[from] = { ..._defaults(), ..._db[from] }
  return _db[from]
}

function saveSettings(from, s) { _db[from] = s; _save() }

// ── Strip :device suffix ──────────────────────────────────────────
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

// ── Is this JID an admin in the group? (uses your groupCache) ─────
function _isAdmin(groupCache, from, jid) {
  const meta = groupCache?.[from]
  if (!meta?.participants) return false
  const num = toNum(jid)
  return meta.participants.some(p =>
    (p.admin === 'admin' || p.admin === 'superadmin') &&
    (toNum(p.id) === num || (p.phoneNumber?.replace(/\D/g, '') === num))
  )
}

const SASSY = [
  '😤 Did you really just tag everyone? The audacity...',
  '🤡 Tagging everyone won\'t make your message more important 💀',
  '😒 Bro said @ everyone like we weren\'t already here 💀',
  '🙄 We are RIGHT HERE — no need to summon the whole group 😩',
  '😂 The tag was unnecessary but okay bestie 💀',
  '🤦 Imagine needing to tag everyone to feel heard...',
  '😭 The tag jumped out and it was NOT needed 😭',
]
const _sassy = () => SASSY[Math.floor(Math.random() * SASSY.length)]

// ══════════════════════════════════════════════════════════════════
//  MAIN HANDLER — auto-loaded by index.js lib loader
//  Receives: { sock, from, msg, sender, isAdmin, groupCache }
// ══════════════════════════════════════════════════════════════════
async function handleAntitag({ sock, from, msg, sender, isAdmin, groupCache }) {
  if (!from?.endsWith('@g.us')) return          // groups only
  const s = getSettings(from)
  if (!s.enabled) return                        // feature off
  if (isAdmin) return                           // admins always exempt
  if (!_isTagMsg(msg)) return                   // not a tag message

  const action = s.action || 'delete'
  const MAX    = 3

  // ── STEP 1: DELETE FIRST, always ─────────────────────────────
  try { await sock.sendMessage(from, { delete: msg.key }) } catch {}

  // ── STEP 2: Apply configured action ──────────────────────────
  if (action === 'delete') {
    // Just delete + sassy reply
    await sock.sendMessage(from, {
      text:
`╔══════════════════════╗
║  🏷️ *ANTI-TAG*        ║
╚══════════════════════╝
${_sassy()}

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
    })
    return
  }

  if (action === 'warn') {
    if (!s.warns) s.warns = {}
    s.warns[sender] = (s.warns[sender] || 0) + 1
    saveSettings(from, s)
    const count = s.warns[sender]

    if (count >= MAX) {
      await sock.sendMessage(from, {
        text:
`╔══════════════════════╗
║  🏷️ *ANTI-TAG — OUT* ║
╚══════════════════════╝
@${toNum(sender)} you've been *removed* 👢
You tagged ${MAX} times. Bye! 💀

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender],
      })
      try { await sock.groupParticipantsUpdate(from, [sender], 'remove') } catch {}
      s.warns[sender] = 0
      saveSettings(from, s)
    } else {
      await sock.sendMessage(from, {
        text:
`╔══════════════════════╗
║  🏷️ *ANTI-TAG — WARN*║
╚══════════════════════╝
@${toNum(sender)} ⚠️ Warning *${count}/${MAX}*
${_sassy()}
${count === MAX - 1 ? '\n🚨 *One more tag = removal!*' : ''}

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender],
      })
    }
    return
  }

  if (action === 'kick') {
    await sock.sendMessage(from, {
      text:
`╔══════════════════════╗
║  🏷️ *ANTI-TAG — KICK*║
╚══════════════════════╝
@${toNum(sender)} has been *removed* 👢
Zero tolerance for mass tagging.

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      mentions: [sender],
    })
    try { await sock.groupParticipantsUpdate(from, [sender], 'remove') } catch {}
  }
}

module.exports = { handleAntitag, getSettings, saveSettings }
