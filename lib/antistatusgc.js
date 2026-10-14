'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — lib/antistatusgc.js
//
// Deletes WhatsApp STATUS messages that land inside a GROUP CHAT (the
// "<member> mentioned this group in their status" message) in groups where
// .antistatus is ON.
//
// index.js auto-loads everything in lib/, then calls
//   lib.handleAntistatusGroup(sock, msg, phone)
// for every incoming message (added by patch-index.js).
//
//   mode warn   (default) → delete + warning, 3 warnings = removed
//   mode delete           → delete + short notice (no warnings, no kick)
//   mode kick             → delete + removed instantly
//
// Group admins, sudo users and the owner are never touched.
// The bot must be a group admin to delete anything.
//
// Debug: put ANTISTATUS_DEBUG=1 in .env to log the message type of every group
// message in antistatus-enabled groups (shows exactly what WhatsApp sends).
// Credit: set BOT_CREDIT in .env to change it everywhere.

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const TAG = '[ANTISTATUS-GC]'
const MAX_WARNS = 3
const DEBUG = process.env.ANTISTATUS_DEBUG === '1'

// message types WhatsApp uses for a status shared into a group chat
const STATUS_KEYS = [
  'groupStatusMentionMessage',
  'statusMentionMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
]

// ...and the protocol message that carries a status mention
let STATUS_MENTION_TYPE = 25
try {
  const { proto } = require('@whiskeysockets/baileys')
  const v = proto?.Message?.ProtocolMessage?.Type?.STATUS_MENTION_MESSAGE
  if (v !== undefined) STATUS_MENTION_TYPE = v
} catch {}

const normalizeNum = (raw = '') =>
  String(raw || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '').trim()

const numList = (envName) =>
  (process.env[envName] || '').split(',').map(normalizeNum).filter(Boolean)

const OWNER_NUMBERS = numList('OWNER_NUMBER')
const SUDO_NUMBERS = numList('SUDO_NUMBERS')

// ── detect ───────────────────────────────────────────────────────────────────
function unwrap(message) {
  let m = message
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message
    if (!inner) break
    m = inner
  }
  return m
}

function detectStatusMessage(msg) {
  const m = unwrap(msg.message)
  if (!m) return null
  for (const k of STATUS_KEYS) if (m[k]) return k
  const t = m.protocolMessage?.type
  if (t !== undefined && t !== null && (t === STATUS_MENTION_TYPE || t === 'STATUS_MENTION_MESSAGE')) {
    return 'protocolMessage:STATUS_MENTION_MESSAGE'
  }
  return null
}

// ── helpers ──────────────────────────────────────────────────────────────────
const seen = new Map()
function alreadySeen(id) {
  const now = Date.now()
  if (seen.size > 500) for (const [k, t] of seen) if (now - t > 300000) seen.delete(k)
  if (seen.has(id)) return true
  seen.set(id, now)
  return false
}

const idsOf = (p) => [p?.id, p?.phoneNumber, p?.lid, p?.jid].map(normalizeNum).filter(Boolean)
const isAdminPart = (p) => p?.admin === 'admin' || p?.admin === 'superadmin'

async function getMeta(sock, phone, groupId) {
  const state = global.__sessionStates?.get?.(phone)
  const hit = state?.groupCache?.[groupId]
  if (hit && Array.isArray(hit.participants) && hit.participants.length) return hit

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('groupMetadata timed out')), 8000)
  })
  try {
    const meta = await Promise.race([Promise.resolve(sock.groupMetadata(groupId)), timeout])
    if (state?.groupCache) state.groupCache[groupId] = { ...meta, _cachedAt: Date.now() }
    return meta
  } finally {
    clearTimeout(timer)
  }
}

const box = (title, rows) =>
  `╔════════════════════╗\n║  ${title}  ║\n╚════════════════════╝\n\n` +
  `┌─────〔 📱 *ANTISTATUS* 〕─────\n${rows.map(r => '│ ' + r).join('\n')}\n└──────────────────────────\n${CREDIT}`

// ── main ─────────────────────────────────────────────────────────────────────
async function handleAntistatusGroup(sock, msg, phone) {
  try {
    if (!msg?.message || !msg.key?.id) return
    const groupId = msg.key.remoteJid
    if (!groupId || !groupId.endsWith('@g.us')) return
    if (msg.key.fromMe) return

    const isEnabled = global.__antistatusIsEnabled
    if (typeof isEnabled !== 'function' || !isEnabled(phone, groupId)) return

    const kind = detectStatusMessage(msg)
    if (DEBUG) {
      console.log(`${TAG} [${phone}] ${groupId} keys=${Object.keys(msg.message).join(',')} matched=${kind || 'no'}`)
    }
    if (!kind) return
    if (alreadySeen(`${phone}:${msg.key.id}`)) return

    const sender = msg.key.participant
    if (!sender) return
    const cands = [msg.key.participant, msg.key.participantPn, msg.key.participantAlt].map(normalizeNum).filter(Boolean)
    const botIds = [sock.user?.id, sock.user?.lid].map(normalizeNum).filter(Boolean)

    // never touch the bot itself, the owner or sudo users
    if (cands.some(n => botIds.includes(n) || OWNER_NUMBERS.includes(n) || SUDO_NUMBERS.includes(n))) return

    let meta
    try { meta = await getMeta(sock, phone, groupId) } catch (e) {
      console.error(`${TAG} [${phone}] metadata fetch failed:`, e.message)
      return
    }
    const parts = meta?.participants || []

    // group admins are exempt
    if (parts.some(p => isAdminPart(p) && idsOf(p).some(n => cands.includes(n)))) return

    // deleting someone else's message needs the bot to be admin
    if (!parts.some(p => isAdminPart(p) && idsOf(p).some(n => botIds.includes(n)))) {
      console.log(`${TAG} [${phone}] ${kind} from ${cands[0]} in ${groupId} but bot isn't admin — can't delete`)
      return
    }

    // 1) delete it, right away
    try {
      await sock.sendMessage(groupId, { delete: msg.key })
      console.log(`${TAG} [${phone}] 🗑️ deleted ${kind} from ${cands[0]} in ${groupId}`)
    } catch (e) {
      console.error(`${TAG} [${phone}] delete failed:`, e.message)
    }

    // 2) then whatever the group's mode says
    const getMode = global.__antistatusGetMode
    const mode = (typeof getMode === 'function' && getMode(phone, groupId)) || 'warn'
    const tag = normalizeNum(sender)
    const say = (text) => sock.sendMessage(groupId, { text, mentions: [sender] }).catch(() => {})

    const kick = async (rows) => {
      try {
        await sock.groupParticipantsUpdate(groupId, [sender], 'remove')
        await say(box('👢 *USER KICKED!*', rows))
      } catch (e) {
        console.error(`${TAG} [${phone}] kick failed:`, e.message)
      }
    }

    if (mode === 'kick') {
      return kick([
        `👤 *User:* @${tag}`,
        '📱 *Reason:* Status shared in this group',
        '⚡ *Mode:* Instant kick',
      ])
    }

    const addWarning = global.__antistatusAddWarning
    if (mode === 'warn' && typeof addWarning === 'function') {
      const warns = addWarning(phone, groupId, sender)
      if (warns >= MAX_WARNS) {
        if (typeof global.__antistatusResetWarnings === 'function') global.__antistatusResetWarnings(phone, groupId, sender)
        return kick([
          `👤 *User:* @${tag}`,
          `⚠️ *Warnings:* ${warns}/${MAX_WARNS}`,
          '📱 *Reason:* Repeatedly sharing status in this group',
        ])
      }
      return say(box('⚠️ *STATUS WARNING*', [
        `👤 *User:* @${tag}`,
        "🚫 Don't share status in this group!",
        `⚠️ *Warnings:* ${warns}/${MAX_WARNS}`,
        '🗑️ Status deleted',
        `⚡ *${MAX_WARNS - warns} more = KICK!*`,
      ]))
    }

    // "delete" mode (or warn mode without a warning counter)
    return say(box('🗑️ *STATUS DELETED*', [
      `👤 *User:* @${tag}`,
      '🚫 Status is not allowed in this group',
      '🗑️ Status deleted',
    ]))
  } catch (err) {
    console.error(`${TAG} error:`, err.message)
  }
}

module.exports = { handleAntistatusGroup }
