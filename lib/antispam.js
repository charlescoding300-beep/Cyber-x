'use strict'

// Group spam guard. Detection uses short-lived memory; strike counts live in
// the existing SQLite-backed userDb and are cleared only by .resetwarn.
const userDb = require('./userDb')

const BURST_WINDOW_MS = 5_000
const DUPLICATE_WINDOW_MS = 30_000
const WARNING_COOLDOWN_MS = 30_000
const DEFAULT_THRESHOLD = 5
const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const recentBySender = new Map()

const digits = value => String(value || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
const stableJid = value => String(value || '').replace(/:\d+(?=@)/, '')

function configuredThreshold(phone) {
  try {
    const configured = Number(userDb.getSection(phone, 'antispam')?.threshold)
    return Number.isInteger(configured) && configured >= 3 && configured <= 20
      ? configured
      : DEFAULT_THRESHOLD
  } catch {
    return DEFAULT_THRESHOLD
  }
}

function incrementWarning(phone, groupJid, senderJid) {
  const section = userDb.getSection(phone, 'antispam') || { groups: {} }
  const groups = { ...(section.groups || {}) }
  const group = { ...(groups[groupJid] || {}) }
  const warnings = { ...(group.warnings || {}) }
  const key = stableJid(senderJid)
  warnings[key] = (Number(warnings[key]) || 0) + 1
  groups[groupJid] = { ...group, warnings }
  userDb.setSection(phone, 'antispam', { ...section, groups })
  return warnings[key]
}

function resetWarnings(phone, groupJid, senderJid) {
  const section = userDb.getSection(phone, 'antispam') || { groups: {} }
  const groups = { ...(section.groups || {}) }
  const group = { ...(groups[groupJid] || {}) }
  const warnings = { ...(group.warnings || {}) }
  const wanted = stableJid(senderJid)
  let changed = false
  for (const key of Object.keys(warnings)) {
    if (stableJid(key) === wanted) {
      delete warnings[key]
      changed = true
    }
  }
  if (changed) {
    groups[groupJid] = { ...group, warnings }
    userDb.setSection(phone, 'antispam', { ...section, groups })
  }
  return changed
}

function isGroupAdmin(meta, senderJid) {
  const target = digits(senderJid)
  return (meta?.participants || []).some(p => {
    if (p?.admin !== 'admin' && p?.admin !== 'superadmin') return false
    return [p.id, p.jid, p.phoneNumber, p.lid].some(id => digits(id) === target)
  })
}

async function handleAntispam(sock, msg, extractBody, state) {
  const groupJid = msg?.key?.remoteJid
  if (!msg?.message || !groupJid?.endsWith('@g.us') || msg.key.fromMe) return

  let enabled = false
  let prefix = '.'
  try {
    enabled = !!state?.settings?.get?.('antiSpam')
    prefix = String(state?.settings?.get?.('prefix') || '.')
  } catch {}
  if (!enabled) return

  const senderJid = msg.key.participant || msg.participant
  const phone = digits(sock?.user?.id || state?.phone)
  if (!senderJid || !phone) return

  const body = String(typeof extractBody === 'function' ? extractBody(msg) : '').trim()
  if (body.length < 2 || body.startsWith(prefix)) return

  const now = Date.now()
  const normalizedBody = body.toLowerCase().replace(/\s+/g, ' ').trim()
  const cacheKey = `${phone}:${groupJid}:${stableJid(senderJid)}`
  let entry = recentBySender.get(cacheKey)
  if (!entry) entry = { messages: [], warnedUntil: 0 }
  if (now < entry.warnedUntil) return

  entry.messages = entry.messages.filter(item => now - item.at <= DUPLICATE_WINDOW_MS)
  entry.messages.push({ at: now, body: normalizedBody })
  recentBySender.set(cacheKey, entry)

  const threshold = configuredThreshold(phone)
  const burstCount = entry.messages.filter(item => now - item.at <= BURST_WINDOW_MS).length
  const duplicateCount = normalizedBody.length >= 8
    ? entry.messages.filter(item => item.body === normalizedBody).length
    : 0
  if (burstCount < threshold && duplicateCount < threshold) return

  // Gate a burst before any network call so concurrent upserts cannot issue
  // duplicate warnings for the same flood.
  entry.warnedUntil = now + WARNING_COOLDOWN_MS
  entry.messages = []

  let meta
  try {
    meta = await sock.groupMetadata(groupJid)
  } catch (error) {
    console.warn(`[ANTISPAM:${groupJid}] group metadata unavailable: ${error.message}`)
    return
  }
  if (isGroupAdmin(meta, senderJid)) return

  const count = incrementWarning(phone, groupJid, senderJid)
  let deleted = false
  try {
    await sock.sendMessage(groupJid, { delete: msg.key })
    deleted = true
  } catch (error) {
    console.warn(`[ANTISPAM:${groupJid}] could not delete spam message: ${error.message}`)
  }

  const tag = digits(senderJid)
  const reason = burstCount >= threshold
    ? `${burstCount} messages in a few seconds`
    : `the same message repeated ${duplicateCount} times`
  const text =
    '╭───「 ANTI-SPAM 」───╮\n' +
    `│ ⚠️ @${tag}, repeated messages are not allowed.\n` +
    `│ 🔎 Detected: ${reason}.\n` +
    `│ ⚠️ Warning: ${count}\n` +
    `│ ${deleted ? '🗑️ Spam message deleted.' : '⚠️ I could not delete the message.'}\n` +
    '╰────────────────────╯\n\n' +
    CREDIT

  await sock.sendMessage(groupJid, {
    text,
    mentions: [senderJid],
  }, { quoted: msg }).catch(error => {
    console.error(`[ANTISPAM:${groupJid}] warning send failed: ${error.message}`)
  })
}

module.exports = { handleAntispam, incrementWarning, resetWarnings }
