'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/vmute.js — ZEN X | persistent group mute
//
//  • Muted members: every message they send in that group is deleted for everyone.
//  • They are told ONCE (per group) with a notice that tags them.
//  • Mutes are saved to data/vmute/<session-number>.json (atomic writes), so they
//    survive bot restarts and server restarts, and stay until someone unmutes them.
//  • The bot must be a group admin — WhatsApp only lets admins delete others' messages.
//
//  Attached to every session socket by index.js (vmuteCore.attach).
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'data', 'vmute')
const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

// message kinds that are not real chat content (never a reason to act)
const IGNORE_TYPES = new Set([
  'protocolMessage', 'reactionMessage', 'encReactionMessage', 'pollUpdateMessage',
  'senderKeyDistributionMessage', 'messageContextInfo', 'keepInChatMessage',
])

// ── identity helpers ─────────────────────────────────────────────────────────
const bare = jid => String(jid || '').replace(/:\d+(?=@)/, '')
const digits = v => String(v || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')

function participantIds(p) {
  return [...new Set([p?.id, p?.phoneNumber, p?.lid, p?.jid].filter(Boolean).map(bare))]
}

function findParticipant(meta, ids) {
  const wanted = new Set((ids || []).filter(Boolean).map(bare))
  return (meta?.participants || []).find(p => participantIds(p).some(i => wanted.has(i))) || null
}

const isAdminP = p => !!p && (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true)

// ── storage ──────────────────────────────────────────────────────────────────
const stores = new Map()    // session number -> { phone, data, index }

const fileFor = phone => path.join(DIR, `${digits(phone) || 'unknown'}.json`)

function normalize(raw) {
  const groups = {}
  const src = raw && typeof raw.groups === 'object' && raw.groups ? raw.groups : {}
  for (const [gid, g] of Object.entries(src)) {
    const users = {}
    for (const [key, rec] of Object.entries((g && g.users) || {})) {
      const ids = [...new Set((Array.isArray(rec?.ids) ? rec.ids : [key]).map(bare).filter(Boolean))]
      if (!ids.length) continue
      users[key] = { ids, warned: !!rec.warned, at: Number(rec.at) || Date.now(), by: bare(rec.by || '') }
    }
    if (Object.keys(users).length) groups[gid] = { users }
  }
  return { groups }
}

function rebuildIndex(store) {
  store.index.clear()
  for (const [gid, g] of Object.entries(store.data.groups)) {
    const set = new Set()
    for (const rec of Object.values(g.users)) rec.ids.forEach(i => set.add(i))
    if (set.size) store.index.set(gid, set)
  }
}

function storeFor(phoneInput) {
  const phone = digits(phoneInput) || 'unknown'
  if (stores.has(phone)) return stores.get(phone)

  let data = { groups: {} }
  try {
    const file = fileFor(phone)
    if (fs.existsSync(file)) data = normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (e) {
    console.error('[VMUTE] could not read the mute list:', e.message)
  }

  const store = { phone, data, index: new Map() }
  rebuildIndex(store)
  stores.set(phone, store)
  return store
}

function persist(store) {
  fs.mkdirSync(DIR, { recursive: true })
  const file = fileFor(store.phone)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store.data, null, 2))
  fs.renameSync(tmp, file)   // atomic: a crash never leaves a half-written list
  rebuildIndex(store)
}

function findRecord(store, groupJid, ids) {
  const users = store.data.groups[groupJid]?.users
  if (!users) return null
  const wanted = new Set((ids || []).map(bare))
  for (const [key, rec] of Object.entries(users)) {
    if (rec.ids.some(i => wanted.has(i))) return { key, rec }
  }
  return null
}

// ── public mute API (used by the commands) ───────────────────────────────────
function mute(phone, groupJid, ids, by) {
  const store = storeFor(phone)
  if (findRecord(store, groupJid, ids)) return false
  const clean = [...new Set((ids || []).map(bare).filter(Boolean))]
  if (!clean.length) return false
  const key = clean.find(i => i.endsWith('@s.whatsapp.net')) || clean[0]
  store.data.groups[groupJid] = store.data.groups[groupJid] || { users: {} }
  store.data.groups[groupJid].users[key] = { ids: clean, warned: false, at: Date.now(), by: bare(by) }
  persist(store)
  return true
}

function unmute(phone, groupJid, ids) {
  const store = storeFor(phone)
  const hit = findRecord(store, groupJid, ids)
  if (!hit) return false
  delete store.data.groups[groupJid].users[hit.key]
  if (!Object.keys(store.data.groups[groupJid].users).length) delete store.data.groups[groupJid]
  persist(store)
  return true
}

function isMuted(phone, groupJid, ids) {
  return !!findRecord(storeFor(phone), groupJid, ids)
}

function listMuted(phone, groupJid) {
  const users = storeFor(phone).data.groups[groupJid]?.users || {}
  return Object.entries(users).map(([key, rec]) => ({
    jid: rec.ids.find(i => i.endsWith('@s.whatsapp.net')) || rec.ids[0] || key,
    ...rec,
  }))
}

function countMuted(phone) {
  return Object.values(storeFor(phone).data.groups).reduce((n, g) => n + Object.keys(g.users).length, 0)
}

// remove this session's mute list (called when the session is logged out / removed)
function wipe(phone) {
  const key = digits(phone) || 'unknown'
  stores.delete(key)
  try { fs.unlinkSync(fileFor(key)) } catch {}
  try { fs.unlinkSync(fileFor(key) + '.tmp') } catch {}
}

// ── the notice (official layout, tags the member) ────────────────────────────
function warningText(jid) {
  return (
    '╭━━━〔 🔇 MUTED 〕━━━╮\n' +
    '┃\n' +
    `┃ 👤 @${digits(jid)}\n` +
    '┃ ⚠️ You are muted in this group.\n' +
    '┃ Every message you send here will be\n' +
    '┃ deleted until an admin unmutes you.\n' +
    '┃\n' +
    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n' +
    CREDIT
  )
}

// ── enforcement ──────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function deleteForEveryone(sock, phone, groupJid, key) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sock.sendMessage(groupJid, { delete: key })
      return true
    } catch (e) {
      console.error(`[VMUTE:${phone}] delete failed (attempt ${attempt}) in ${groupJid}: ${e.message}`)
      if (attempt === 1) await sleep(1500)
    }
  }
  return false
}

async function warnOnce(sock, phone, groupJid, recKey, mentionJid, quoted) {
  const store = storeFor(phone)
  const rec = store.data.groups[groupJid]?.users?.[recKey]
  if (!rec || rec.warned) return
  rec.warned = true
  persist(store)                 // saved BEFORE sending, so a burst of messages can't warn twice
  try {
    await sock.sendMessage(groupJid, { text: warningText(mentionJid), mentions: [mentionJid] }, { quoted })
  } catch (e) {
    console.error(`[VMUTE:${phone}] warning not delivered: ${e.message}`)
  }
}

function candidateIds(key) {
  return [...new Set([key.participant, key.participantPn, key.participantAlt].filter(Boolean).map(bare))]
}

// returns true when the message was from a muted member and was acted on
function enforce(sock, phone, m) {
  const key = m?.key
  if (!key || key.fromMe) return false
  const groupJid = key.remoteJid
  if (!groupJid || !groupJid.endsWith('@g.us')) return false
  if (!m.message) return false
  if (!Object.keys(m.message).some(k => !IGNORE_TYPES.has(k))) return false

  const store = storeFor(phone)
  const set = store.index.get(groupJid)
  if (!set) return false                       // nobody muted here: instant exit

  const ids = candidateIds(key)
  if (!ids.some(i => set.has(i))) return false

  const hit = findRecord(store, groupJid, ids)
  if (!hit) return false

  deleteForEveryone(sock, phone, groupJid, key)   // not awaited: never blocks other messages
  const mentionJid = hit.rec.ids.find(i => i.endsWith('@s.whatsapp.net')) || hit.rec.ids[0]
  warnOnce(sock, phone, groupJid, hit.key, mentionJid, m)
  return true
}

// Called by index.js for every session socket — including after a reconnect.
function attach(state, sock) {
  if (!sock || sock.__zenxVmute) return
  sock.__zenxVmute = true
  const phone = digits(state?.phone || sock.user?.id)
  sock.__zenxVmutePhone = phone
  storeFor(phone)

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages || []) {
      try { enforce(sock, phone, m) } catch (e) { console.error(`[VMUTE:${phone}] ERR:`, e.message) }
    }
  })

  console.log(`[VMUTE:${phone}] ✔ mute enforcement active (${countMuted(phone)} muted member(s))`)
}

module.exports = {
  attach, mute, unmute, isMuted, listMuted, countMuted, wipe,
  bare, digits, participantIds, findParticipant, isAdminP, warningText,
}
