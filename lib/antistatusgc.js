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
//   mode warn   → warn only; persistent count, reset with .resetwarn
//   mode delete → delete the shared status and send one deletion notice
//   mode kick   → delete the shared status, remove the sender, send one notice
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

const panel = (title, rows) =>
  `┏━━━━━━━「 ${title} 」━━━━━━━┓\n${rows.map(row => `┃ ${row}`).join('\n')}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`

const removedPanel = tag => panel('STATUS REMOVED', [
  '🗑️ Status updates are not allowed.',
  `👤 @${tag}’s shared status post was removed from this group.`,
])

const deleteFailedPanel = tag => panel('STATUS DELETE FAILED', [
  '⚠️ Status updates are not allowed.',
  `👤 @${tag}’s shared status post could not be removed from this group.`,
  'Please check that I am a group admin.',
])

const warningPanel = (tag, count) => panel('STATUS WARNING', [
  '⚠️ Status updates are not allowed.',
  `👤 @${tag} • Warning ${count}/${MAX_WARNS}`,
])

const violationPanel = tag => panel('STATUS VIOLATION', [
  '🚫 Status updates are not allowed.',
  `👤 @${tag} was removed from the group.`,
])

const actionFailedPanel = tag => panel('STATUS ACTION FAILED', [
  '⚠️ Status updates are not allowed.',
  `👤 @${tag} could not be removed from the group.`,
  'Please check that I am a group admin.',
])

async function removeMember(sock, groupId, sender) {
  try {
    const result = await sock.groupParticipantsUpdate(groupId, [sender], 'remove')
    const entries = Array.isArray(result) ? result : [result]
    const item = entries.find(entry => entry?.jid === sender || entry?.id === sender) || entries[0]
    if (item?.status != null) {
      const status = Number(item.status)
      if (Number.isFinite(status) && (status < 200 || status >= 300)) return false
    }
    return true
  } catch (e) {
    console.error(`${TAG} kick failed:`, e.message)
    return false
  }
}

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

    const sender = msg.key.participant || msg.key.participantPn || msg.key.participantAlt || msg.participant
    if (!sender) return
    const cands = [
      msg.key.participant,
      msg.key.participantPn,
      msg.key.participantAlt,
      msg.participant,
      msg.participantPn,
      msg.participantAlt,
    ].map(normalizeNum).filter(Boolean)
    const botIds = [sock.user?.id, sock.user?.lid].map(normalizeNum).filter(Boolean)

    // never touch the bot itself, the owner or sudo users
    if (cands.some(n => botIds.includes(n) || OWNER_NUMBERS.includes(n) || SUDO_NUMBERS.includes(n))) return

    let meta
    try { meta = await getMeta(sock, phone, groupId) } catch (e) {
      console.error(`${TAG} [${phone}] metadata fetch failed:`, e.message)
      return
    }
    const parts = meta?.participants || []

    // Only act when the sender is matched to a current group participant.
    // If identity/metadata is ambiguous, fail closed so an admin is never
    // treated as a regular member by mistake.
    const senderPart = parts.find(p => idsOf(p).some(n => cands.includes(n)))
    if (!senderPart) {
      console.log(`${TAG} [${phone}] cannot match sender ${cands.join(',') || sender} in ${groupId} — skipping action`)
      return
    }

    // group admins are exempt
    if (isAdminPart(senderPart)) return

    const botIsAdmin = parts.some(p => isAdminPart(p) && idsOf(p).some(n => botIds.includes(n)))
    const getMode = global.__antistatusGetMode
    const requestedMode = typeof getMode === 'function' && getMode(phone, groupId)
    const mode = ['warn', 'delete', 'kick'].includes(requestedMode) ? requestedMode : 'warn'

    const tag = normalizeNum(sender)
    const say = panels => sock.sendMessage(
      groupId,
      { text: `${panels.filter(Boolean).join('\n\n')}\n\n${CREDIT}`, mentions: [sender] },
      { quoted: msg },
    ).catch(e => {
      console.error(`${TAG} [${phone}] quoted notice failed:`, e.message)
    })

    if (!botIsAdmin && mode !== 'warn') {
      console.log(`${TAG} [${phone}] ${kind} from ${cands[0]} in ${groupId} but bot isn't admin`)
      return say([deleteFailedPanel(tag)])
    }

    // Warning is a standalone mode: persist the count and send only this
    // quoted warning. It does not also delete the status or kick the member.
    if (mode === 'warn') {
      if (typeof global.__antistatusAddWarning !== 'function') return
      const warningIdentity = senderPart.phoneNumber || senderPart.id || senderPart.jid || sender
      let warns
      try {
        warns = global.__antistatusAddWarning(phone, groupId, warningIdentity)
      } catch (e) {
        console.error(`${TAG} [${phone}] warning persistence failed:`, e.message)
        return
      }
      return say([warningPanel(tag, Math.min(warns, MAX_WARNS))])
    }

    let deleted = false
    try {
      await sock.sendMessage(groupId, { delete: msg.key })
      deleted = true
      console.log(`${TAG} [${phone}] 🗑️ deleted ${kind} from ${cands[0]} in ${groupId}`)
    } catch (e) {
      console.error(`${TAG} [${phone}] delete failed in ${groupId} (bot admin: ${botIsAdmin}):`, e.message)
    }

    const statusPanel = deleted ? removedPanel(tag) : deleteFailedPanel(tag)
    if (mode === 'delete') return say([statusPanel])

    if (mode === 'kick') {
      const removed = await removeMember(sock, groupId, sender)
      return say([removed ? violationPanel(tag) : actionFailedPanel(tag)])
    }

    return say([statusPanel])
  } catch (err) {
    console.error(`${TAG} error:`, err.message)
  }
}

module.exports = { handleAntistatusGroup }
