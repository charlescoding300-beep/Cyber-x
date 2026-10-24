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
//   mode warn   → DELETE the status + warn. The warning count is saved on disk
//                 (lib/antistatusStore.js) and is only cleared by an admin
//                 (.antistatus reset @user / .resetwarn). At 3/3 the member is
//                 removed (ANTISTATUS_KICK_AT_MAX=0 in .env → count only).
//   mode delete → delete the shared status and send one deletion notice
//   mode kick   → delete the shared status, remove the sender, send one notice
//
// CHANGED: warn mode used to ONLY warn and leave the status in the chat — that is
// why statuses were "detected but not deleted". It now deletes like the other modes.
//
// Group admins, sudo users and the owner are never touched.
// The bot must be a group admin to delete anything.
//
// Debug: put ANTISTATUS_DEBUG=1 in .env to log the message type of every group
// message in antistatus-enabled groups (shows exactly what WhatsApp sends).
// Credit: set BOT_CREDIT in .env to change it everywhere.

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const TAG = '[ANTISTATUS-GC]'
const DEBUG = process.env.ANTISTATUS_DEBUG === '1'
const adminLib = require('./isAdmin')
const { sendBotNotAdmin } = require('./groupAdminNotice')
const store = require('./antistatusStore').antistatusStore
const MAX_WARNS = store.MAX_WARNS

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

const isAdminPart = adminLib.isAdminParticipant

const panel = (title, rows) =>
  `┏━━━━━━━「 ${title} 」━━━━━━━┓\n${rows.map(row => `┃ ${row}`).join('\n')}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`

const removedPanel = tag =>
  `*🗑️ @${tag}’𝚂 𝚂𝚃𝙰𝚃𝚄𝚂 𝚆𝙰𝚂 𝚁𝙴𝙼𝙾𝚅𝙴𝙳.*\n*— 𝚂𝚃𝙰𝚃𝚄𝚂 𝙿𝙾𝚂𝚃𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*`

const deleteFailedPanel = tag => panel('STATUS DELETE FAILED', [
  '⚠️ Status updates are not allowed.',
  `👤 @${tag}’s shared status post could not be removed from this group.`,
  'Please check that I am a group admin.',
])

const warningPanel = (tag, count) =>
  `*⚠️ @${tag} 𝚂𝚃𝙰𝚃𝚄𝚂 𝙿𝙾𝚂𝚃𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*\n*— 𝚆𝙰𝚁𝙽𝙸𝙽𝙶: ${Math.min(count, MAX_WARNS)}/${MAX_WARNS}*`

const violationPanel = tag =>
  `*❌ @${tag} 𝚆𝙰𝚂 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝙾𝚁 𝙿𝙾𝚂𝚃𝙸𝙽𝙶 𝙰 𝚂𝚃𝙰𝚃𝚄𝚂.*\n*— 𝚂𝚃𝙰𝚃𝚄𝚂 𝙿𝙾𝚂𝚃𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*`

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
    const senderAlt = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt
    if (!sender) return
    const cands = [
      msg.key.participant,
      msg.key.participantPn,
      msg.key.participantAlt,
      msg.participant,
      msg.participantPn,
      msg.participantAlt,
    ].filter(Boolean)
    const botIds = [sock.user?.id, sock.user?.lid].map(normalizeNum).filter(Boolean)
    const candidateNums = cands.map(normalizeNum).filter(Boolean)

    // never touch the bot itself, the owner or sudo users
    if (candidateNums.some(n => botIds.includes(n) || OWNER_NUMBERS.includes(n) || SUDO_NUMBERS.includes(n))) return

    let adminContext
    try { adminContext = await adminLib.getGroupAdminContext(sock, groupId, sender, senderAlt, phone) } catch (e) {
      console.error(`${TAG} [${phone}] metadata fetch failed:`, e.message)
      return
    }
    if (!adminContext.available) {
      console.error(`${TAG} [${phone}] group roles unavailable; skipped ${kind} in ${groupId}`)
      return
    }
    const meta = adminContext.meta
    const parts = meta?.participants || []

    // Only act when the sender is matched to a current group participant.
    // If identity/metadata is ambiguous, fail closed so an admin is never
    // treated as a regular member by mistake.
    const senderPart = parts.find(p => adminLib.participantMatches(p, ...cands))
    if (!senderPart) {
      console.log(`${TAG} [${phone}] cannot match sender ${candidateNums.join(',') || sender} in ${groupId} — skipping action`)
      return
    }

    // group admins are exempt
    if (adminContext.senderAdmin || isAdminPart(senderPart)) return

    const botIsAdmin = adminContext.botAdmin
    const getMode = global.__antistatusGetMode
    const requestedMode = typeof getMode === 'function' && getMode(phone, groupId)
    const mode = ['warn', 'delete', 'kick'].includes(requestedMode) ? requestedMode : 'warn'

    const tag = normalizeNum(sender)
    const say = (text, includeCredit = false) => sock.sendMessage(
      groupId,
      { text: includeCredit ? `${text}\n\n${CREDIT}` : text, mentions: [sender] },
      { quoted: msg },
    ).catch(e => {
      console.error(`${TAG} [${phone}] quoted notice failed:`, e.message)
    })

    // EVERY mode deletes, so every mode needs the bot to be admin
    if (!botIsAdmin) {
      console.log(`${TAG} [${phone}] ${kind} from ${candidateNums[0] || sender} in ${groupId} but bot isn't admin`)
      return sendBotNotAdmin(sock, groupId, msg).catch(e => {
        console.error(`${TAG} [${phone}] quoted admin notice failed:`, e.message)
      })
    }

    // ── delete the status message (all modes) ──
    let deleted = false
    try {
      await sock.sendMessage(groupId, { delete: msg.key })
      deleted = true
      console.log(`${TAG} [${phone}] 🗑️ deleted ${kind} from ${candidateNums[0] || sender} in ${groupId}`)
    } catch (e) {
      console.error(`${TAG} [${phone}] delete failed in ${groupId} (bot admin: ${botIsAdmin}):`, e.message)
    }

    // ── warn: permanent record, escalate at the limit ──
    if (mode === 'warn') {
      // phone-number identity first so the same person keeps ONE record even if WhatsApp shows them as a LID
      const warningIdentity = senderPart.phoneNumber || senderPart.id || senderPart.jid || sender
      let warns
      try {
        warns = store.addWarn(phone, groupId, warningIdentity, { type: kind, deleted })
      } catch (e) {
        console.error(`${TAG} [${phone}] warning persistence failed:`, e.message)
        return say(deleted ? removedPanel(tag) : deleteFailedPanel(tag), true)
      }
      console.log(`${TAG} [${phone}] ⚠️ warning ${warns}/${MAX_WARNS} for ${candidateNums[0] || sender} in ${groupId}`)

      if (store.KICK_AT_MAX && warns >= MAX_WARNS) {
        const removed = await removeMember(sock, groupId, sender)
        if (!removed) console.error(`${TAG} [${phone}] reached warning limit but could not remove ${sender}`)
      }
      return say(warningPanel(tag, warns))
    }

    const statusPanel = deleted ? removedPanel(tag) : deleteFailedPanel(tag)
    if (mode === 'delete') return say(statusPanel, !deleted)

    if (mode === 'kick') {
      const removed = await removeMember(sock, groupId, sender)
      return say(removed ? violationPanel(tag) : actionFailedPanel(tag), !removed)
    }

    return say(statusPanel, !deleted)
  } catch (err) {
    console.error(`${TAG} error:`, err.message)
  }
}

module.exports = { handleAntistatusGroup }
