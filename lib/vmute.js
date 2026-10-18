'use strict'

let db = null
try { db = require('./userDb') } catch {}

const PHONE_JID_DOMAINS = new Set(['s.whatsapp.net', 'c.us'])

function normalizeJid(jid) {
  return String(jid || '').trim().toLowerCase().replace(/:\d+(?=@)/, '')
}

function uniqueJids(values) {
  return [...new Set((values || []).map(normalizeJid).filter(Boolean))]
}

function sameJid(left, right) {
  const a = normalizeJid(left)
  const b = normalizeJid(right)
  if (!a || !b) return false
  if (a === b) return true

  const [aLocal, aDomain] = a.split('@')
  const [bLocal, bDomain] = b.split('@')
  return !!aDomain && aDomain === bDomain && PHONE_JID_DOMAINS.has(aDomain) &&
    aLocal.replace(/\D/g, '') === bLocal.replace(/\D/g, '')
}

function participantJids(participant) {
  return uniqueJids([
    participant?.id,
    participant?.lid,
    participant?.phoneNumber,
    participant?.jid,
    participant?.pn,
  ])
}

function findParticipant(meta, refs) {
  const ids = uniqueJids(refs)
  if (!ids.length || !Array.isArray(meta?.participants)) return null

  return meta.participants.find(participant =>
    participantJids(participant).some(id => ids.some(ref => sameJid(id, ref)))
  ) || null
}

function isAdminParticipant(participant) {
  return participant?.admin === 'admin' || participant?.admin === 'superadmin' ||
    participant?.isAdmin === true || participant?.isSuperAdmin === true
}

function sameParticipant(leftRefs, rightRefs, meta) {
  const left = uniqueJids(leftRefs)
  const right = uniqueJids(rightRefs)
  if (!left.length || !right.length) return false

  const leftParticipant = findParticipant(meta, left)
  const rightParticipant = findParticipant(meta, right)
  if (leftParticipant && rightParticipant) return leftParticipant === rightParticipant

  return left.some(a => right.some(b => sameJid(a, b)))
}

function getRecordJids(entry) {
  return uniqueJids([entry?.jid, ...(Array.isArray(entry?.jids) ? entry.jids : [])])
}

function getMuted(phone, groupJid) {
  if (!db) return []
  const section = db.getSection(phone, 'vmute') || { groups: {} }
  const list = section.groups?.[groupJid]
  return Array.isArray(list) ? list : []
}

function setMuted(phone, groupJid, list) {
  if (!db) return
  const section = db.getSection(phone, 'vmute') || { groups: {} }
  section.groups = section.groups || {}
  section.groups[groupJid] = Array.isArray(list) ? list : []
  db.setSection(phone, 'vmute', section)
}

async function handleVmute(sock, msg, phone, groupCache) {
  try {
    const groupJid = msg?.key?.remoteJid
    if (!groupJid?.endsWith('@g.us') || msg.key.fromMe) return

    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'
    let muted = getMuted(owner, groupJid)
    if (!muted.length) return

    const now = Date.now()
    const active = muted.filter(entry => !entry.until || entry.until > now)
    if (active.length !== muted.length) {
      setMuted(owner, groupJid, active)
      muted = active
    }
    if (!muted.length) return

    const senderJids = uniqueJids([
      msg.key.participant,
      msg.key.participantAlt,
      msg.key.participantPn,
      msg.participantAlt,
      msg.participantPn,
    ])
    if (!senderJids.length) return

    // Use the already-warmed group cache; if participant roles cannot be
    // confirmed, fail open so an administrator is never deleted by mistake.
    const meta = groupCache?.[groupJid]
    const sender = findParticipant(meta, senderJids)
    if (!sender || isAdminParticipant(sender)) return

    const isMuted = muted.some(entry =>
      sameParticipant(getRecordJids(entry), participantJids(sender), meta)
    )
    if (!isMuted) return

    try {
      await sock.sendMessage(groupJid, { delete: msg.key })
    } catch (error) {
      console.error('[VMUTE] delete failed:', error.message)
      return
    }

    try {
      await sock.sendMessage(groupJid, { react: { text: '🔇', key: msg.key } })
    } catch {}
  } catch (error) {
    console.error('[VMUTE]', error.message)
  }
}

module.exports = {
  handleVmute,
  getMuted,
  setMuted,
  normalizeJid,
  uniqueJids,
  sameJid,
  participantJids,
  findParticipant,
  isAdminParticipant,
  sameParticipant,
  getRecordJids,
}
