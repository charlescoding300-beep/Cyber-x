'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/antistatusgc.js — ZEN X | Anti-status for GROUP CHATS
//
//  Removes status shares that non-admin members post in a group:
//    • statusMentionMessage / groupStatusMentionMessage — a member shares
//      a status into the group chat
//    • groupStatusMessage / groupStatusMessageV2 — group-status content
//      posted in the group
//
//  Modes (set with .antistatus):
//    delete  (default)  delete it, with a tagged notice quoting the message
//    warn               delete + tagged warning; 3 warnings = removed
//    kick               delete + removed at once
//
//  Admins and the bot owner are never touched. The bot must be a group admin.
//  Warnings are saved to data/antistatus/ so they survive restarts.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'data', 'antistatus')
const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const STATUS_KEYS = ['statusMentionMessage', 'groupStatusMentionMessage', 'groupStatusMessage', 'groupStatusMessageV2']
const MAX_WARNINGS = 3
const META_TTL_MS = 60 * 1000
const seen = new Map()   // message id -> time, so one message is only handled once

// ── identity helpers ─────────────────────────────────────────────────────────
const bare = jid => String(jid || '').replace(/:\d+(?=@)/, '')
const digits = v => String(v || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
const tagOf = jid => `@${digits(jid)}`
const ownerNumbers = () => (process.env.OWNER_NUMBER || '').split(',').map(digits).filter(Boolean)

function participantIds(p) {
  return [...new Set([p?.id, p?.phoneNumber, p?.lid, p?.jid].filter(Boolean).map(bare))]
}

function findParticipant(meta, ids) {
  const wanted = new Set((ids || []).filter(Boolean).map(bare))
  return (meta?.participants || []).find(p => participantIds(p).some(i => wanted.has(i))) || null
}

const isAdminP = p => !!p && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true)

// ── message inspection ───────────────────────────────────────────────────────
function unwrap(message) {
  let cur = message || {}
  for (let i = 0; i < 4; i++) {
    const next =
      cur.ephemeralMessage?.message ||
      cur.viewOnceMessage?.message ||
      cur.viewOnceMessageV2?.message ||
      cur.documentWithCaptionMessage?.message
    if (!next) break
    cur = next
  }
  return cur
}

function statusKindOf(message) {
  const m = unwrap(message)
  return STATUS_KEYS.find(k => m[k]) || null
}

// ── persistent warnings ──────────────────────────────────────────────────────
const warnFile = phone => path.join(DIR, `warn-${digits(phone) || 'unknown'}.json`)

function loadWarnings(phone) {
  try { return JSON.parse(fs.readFileSync(warnFile(phone), 'utf8')) } catch { return {} }
}

function saveWarnings(phone, data) {
  fs.mkdirSync(DIR, { recursive: true })
  const file = warnFile(phone)
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2))
  fs.renameSync(file + '.tmp', file)
}

function addWarning(phone, groupJid, senderDigits) {
  const data = loadWarnings(phone)
  data[groupJid] = data[groupJid] || {}
  data[groupJid][senderDigits] = (data[groupJid][senderDigits] || 0) + 1
  saveWarnings(phone, data)
  return data[groupJid][senderDigits]
}

function clearWarning(phone, groupJid, senderDigits) {
  const data = loadWarnings(phone)
  if (data[groupJid]?.[senderDigits] !== undefined) {
    delete data[groupJid][senderDigits]
    saveWarnings(phone, data)
  }
}

// ── notices (official box layout, always tag the offender) ───────────────────
function box(title, lines) {
  return `╭━━━〔 ${title} 〕━━━╮\n┃\n${lines.map(l => `┃ ${l}`).join('\n')}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n${CREDIT}`
}

async function notify(sock, groupJid, quotedMsg, offenderJid, text) {
  try {
    await sock.sendMessage(groupJid, { text, mentions: [offenderJid] }, { quoted: quotedMsg })
  } catch (e) {
    console.error(`[ANTISTATUS] notice not delivered: ${e.message}`)
  }
}

async function getMeta(sock, groupJid, cache) {
  const hit = cache?.[groupJid]
  if (hit?.participants?.length && Date.now() - (hit._cachedAt || 0) < META_TTL_MS) return hit
  try {
    const meta = await sock.groupMetadata(groupJid)
    if (cache && meta) cache[groupJid] = { ...meta, _cachedAt: Date.now() }
    return meta
  } catch {
    return hit || null
  }
}

// ── the action ───────────────────────────────────────────────────────────────
async function act(sock, phone, groupJid, m, mode, offenderJid) {
  const key = m.key
  const tag = tagOf(offenderJid)

  // 1) warn mode: count the strike first
  let removeNow = false
  let strikes = 0
  if (mode === 'warn') {
    strikes = addWarning(phone, groupJid, digits(offenderJid))
    removeNow = strikes >= MAX_WARNINGS
  }

  // 2) tagged notice, quoting the offending message (sent BEFORE deletion so the quote resolves)
  if (mode === 'kick' || removeNow) {
    await notify(sock, groupJid, m, offenderJid, box('👢 REMOVED', [
      `👤 ${tag}`,
      mode === 'kick' ? '📵 Sharing statuses in this group is not allowed.' : `🚫 ${MAX_WARNINGS} status warnings reached.`,
      '👢 Removed from the group.',
    ]))
  } else if (mode === 'warn') {
    await notify(sock, groupJid, m, offenderJid, box('⚠️ STATUS WARNING', [
      `👤 ${tag}`,
      `⚠️ Warning ${strikes}/${MAX_WARNINGS}`,
      '📵 Do not share statuses in this group.',
      `🚫 ${MAX_WARNINGS} warnings and you are removed.`,
    ]))
  } else {
    await notify(sock, groupJid, m, offenderJid, box('🗑️ STATUS DELETED', [
      `👤 ${tag}`,
      '📵 Sharing statuses in this group is not allowed.',
      '🗑️ The status has been deleted.',
    ]))
  }

  // 3) delete for everyone
  try {
    await sock.sendMessage(groupJid, { delete: key })
  } catch (e) {
    console.error(`[ANTISTATUS:${phone}] delete failed in ${groupJid}: ${e.message}`)
  }

  // 4) remove if the mode says so
  if (mode === 'kick' || removeNow) {
    try {
      await sock.groupParticipantsUpdate(groupJid, [offenderJid], 'remove')
    } catch (e) {
      console.error(`[ANTISTATUS:${phone}] remove failed in ${groupJid}: ${e.message}`)
    }
    if (removeNow) clearWarning(phone, groupJid, digits(offenderJid))
  }
}

// ── entry point for every incoming message ───────────────────────────────────
async function handle(sock, phone, cache, m) {
  const key = m?.key
  if (!key || key.fromMe) return
  const groupJid = key.remoteJid
  if (!groupJid || !groupJid.endsWith('@g.us')) return
  if (!m.message || !statusKindOf(m.message)) return

  if (typeof global.__antistatusIsEnabled !== 'function' || !global.__antistatusIsEnabled(phone, groupJid)) return

  // handle each message once
  if (seen.has(key.id)) return
  seen.set(key.id, Date.now())
  if (seen.size > 2000) {
    const cutoff = Date.now() - 10 * 60 * 1000
    for (const [id, t] of seen) if (t < cutoff) seen.delete(id)
  }

  const meta = await getMeta(sock, groupJid, cache)
  const senderP = findParticipant(meta, [key.participant, key.participantPn, key.participantAlt])
  if (!senderP) return                         // not a member (or unknown): leave it alone
  if (isAdminP(senderP)) return                // admins are never touched

  const senderDigits = digits(participantIds(senderP).find(i => i.endsWith('@s.whatsapp.net')) || senderP.id)
  if (senderDigits === digits(phone) || ownerNumbers().includes(senderDigits)) return

  const botP = findParticipant(meta, [sock.user?.id, sock.user?.lid])
  if (!botP || !isAdminP(botP)) {
    console.log(`[ANTISTATUS:${phone}] status from ${senderDigits} in ${groupJid} — bot is not an admin, cannot delete`)
    return
  }

  const mode = (typeof global.__antistatusGetMode === 'function' && global.__antistatusGetMode(phone, groupJid)) || 'delete'
  const offenderJid = participantIds(senderP).find(i => i.endsWith('@s.whatsapp.net')) || bare(senderP.id)

  console.log(`[ANTISTATUS:${phone}] ${mode}: status from ${senderDigits} in ${groupJid}`)
  await act(sock, phone, groupJid, m, mode, offenderJid)
}

// Called by index.js for every session socket — including after a reconnect.
function attach(state, sock) {
  if (!sock || sock.__zenxAntiStatusGc) return
  sock.__zenxAntiStatusGc = true
  const phone = digits(state?.phone || sock.user?.id)
  const cache = state?.groupCache || {}

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages || []) {
      handle(sock, phone, cache, m).catch(e => console.error(`[ANTISTATUS:${phone}] ERR:`, e.message))
    }
  })

  console.log(`[ANTISTATUS:${phone}] ✔ group-chat status enforcement active`)
}

module.exports = { attach, statusKindOf, participantIds, findParticipant, isAdminP, bare, digits, box }
