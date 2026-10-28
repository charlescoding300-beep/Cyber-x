'use strict'
// core/termination.js
// ─────────────────────────────────────────────────────────────────────────────
// TERMINATION MODE — a self-contained, zero-tolerance group-protection layer.
// Independent of antilink / antistatus / antibot: its own data store, its own
// socket listener, its own detection logic. Turning it on in a group does not
// change or interact with any of those other systems' per-group settings.
//
// What it watches for, per group where it's enabled, and reacts to instantly
// (reply + delete + kick, fired together, no warnings):
//   1. LINKS — any URL, WhatsApp group invite link, WhatsApp CHANNEL invite
//      link, Telegram/Discord invite, bare domain, or bare IP used as a link.
//   2. STATUS TAGS — someone tagging a termination-enabled group in their
//      WhatsApp Status.
//   3. OTHER BOTS — heuristic only (WhatsApp/Baileys expose no "this account
//      is a bot" signal at the protocol level, so nothing can claim to be
//      certain here): a message containing a recognizable other-bot
//      signature/credit line, or a sender posting an abnormally fast burst of
//      messages. Both are tunable; both can occasionally misfire the way any
//      heuristic can, which is exactly why they're NOT used for anything
//      lower-stakes than a group this admin explicitly opted into.
//
// Exemptions, always, non-negotiable: the bot's own account, OWNER_NUMBERS,
// SUDO_NUMBERS, and any actual WhatsApp group admin are never acted against.
// The bot must itself be a group admin to kick — if it isn't, detection still
// logs, nothing is attempted.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data', 'termination')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const OWNER_NUMBERS = (process.env.OWNER_NUMBER || '')
  .split(',').map(n => n.replace(/\D/g, '').trim()).filter(Boolean)
const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || '')
  .split(',').map(n => n.replace(/\D/g, '').trim()).filter(Boolean)

const REPLY_TEXT = '🚫 Threat detected,\n    - Threat  deannihilated successfully ✅'
const ACTIVATE_TEXT = '*TERMINATION MODE HAS BEEN ACTIVATED SUCCESSFULLY ✅ ☣️*'
const DEACTIVATE_TEXT = '*TERMINATION MODE HAS BEEN DEACTIVATED*'

// ── per-group store (own file, own cache — independent of every other system) ─
const FILE_CACHE_TTL_MS = 2000
const cache = new Map()

function safePhone(phone) { return (phone || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_') }
function filePath(phone) { return path.join(DATA_DIR, `${safePhone(phone)}.json`) }

function load(phone) {
  const hit = cache.get(phone)
  if (hit && Date.now() - hit.t < FILE_CACHE_TTL_MS) return hit.v
  const file = filePath(phone)
  let data = null
  try { if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (e) { console.error(`[TERMINATION] load error for ${phone}:`, e.message) }
  if (!data) data = { groups: {} }
  cache.set(phone, { v: data, t: Date.now() })
  return data
}
function save(phone, data) {
  try { fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2)) }
  catch (e) { console.error(`[TERMINATION] save error for ${phone}:`, e.message) }
  cache.set(phone, { v: data, t: Date.now() })
}

function isEnabled(phone, groupId) { return !!load(phone).groups[groupId]?.enabled }
function enable(phone, groupId) {
  const data = load(phone)
  data.groups[groupId] = { enabled: true, enabledAt: Date.now() }
  save(phone, data)
}
function disable(phone, groupId) {
  const data = load(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; save(phone, data) }
}

// ── normalization + link detection ──────────────────────────────────────────
// Deliberately as strict as the group-level antilink engine already proven in
// this codebase (hidden-character stripping, fullwidth/homoglyph/dot-lookalike
// normalization, the full IANA TLD list) plus one addition: an explicit bare
// pattern for WhatsApp CHANNEL invite links, the same way group invite links
// are already matched without requiring the http(s) prefix.
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

function defullwidth(str) {
  return str.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ')
}
const CONFUSABLES = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ⅰ': 'i', 'ⅼ': 'l',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K',
  'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ι': 'i', 'υ': 'u', 'ν': 'v',
}
function deconfuse(str) { return str.replace(/[\u0370-\u03FF\u0400-\u04FF]/g, ch => CONFUSABLES[ch] || ch) }
const DOT_LOOKALIKES = /[\u3002\uFF0E\u2024\u2027]/g

function normalize(text) {
  if (!text) return ''
  let t = text.replace(HIDDEN_CHARS, '')
  t = defullwidth(t)
  t = deconfuse(t)
  t = t.replace(DOT_LOOKALIKES, '.')
  t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, '.').replace(/\s+dot\s+/gi, '.')
  t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ''))
  t = t.replace(/[.]{2,}/g, '.').replace(/\s{2,}/g, ' ')
  return t
}

const IANA_TLDS = ['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'xyz', 'top', 'site', 'online',
  'click', 'link', 'shop', 'store', 'app', 'dev', 'id', 'ng', 'in', 'us', 'uk', 'ru', 'cn', 'de', 'fr',
  'live', 'tv', 'cc', 'pro', 'gg', 'cfd', 'icu', 'fun', 'cyou', 'work', 'vip', 'wtf', 'win', 'bet', 'ltd']
const TLD_GROUP = IANA_TLDS.join('|')

const LINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,          // WhatsApp GROUP invite
  /whatsapp\.com\/channel\/[A-Za-z0-9]{10,}/gi,        // WhatsApp CHANNEL invite — bare, no scheme required
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /discord(?:\.gg|\.com\/invite)\/[^\s]{2,}/gi,
  /wa\.me\/[^\s]{2,}/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  new RegExp(`\\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\\.(?:${TLD_GROUP})\\b(?:\\/[^\\s]*)?`, 'gi'),
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:\/[^\s]*)?/g,
]

function containsLink(text) {
  if (!text) return false
  const n = normalize(text)
  return LINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(n) })
}

function extractAllText(msg) {
  const m = msg.message
  if (!m) return []
  const out = []
  const add = v => { if (v && typeof v === 'string') out.push(v) }
  add(m.conversation)
  add(m.extendedTextMessage?.text)
  add(m.imageMessage?.caption)
  add(m.videoMessage?.caption)
  add(m.documentMessage?.caption)
  return out
}

// ── bot-signature + burst-rate detection (heuristic — see header) ──────────
// Default set covers the overwhelmingly common "-MD" naming convention and
// the credit-footer style seen across this entire bot ecosystem. Tunable via
// TERMINATION_BOT_SIGNATURES in .env (comma-separated extra phrases/regex
// bodies, OR'd in alongside the defaults below).
const DEFAULT_BOT_SIGNATURES = [
  /\b[\w]+-md\b/i,
  /powered\s+by\s+[\w\s]+bot/i,
  /download(?:ed)?\s+by\s+[^\n]{0,40}\bbot\b/i,
  /©[^\n]{0,40}\bbot\b/i,
  /\bbot\s*🤖/i,
]
function extraSignatures() {
  return (process.env.TERMINATION_BOT_SIGNATURES || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { try { return new RegExp(s, 'i') } catch { return null } })
    .filter(Boolean)
}
function looksLikeBotSignature(text) {
  if (!text) return false
  const all = [...DEFAULT_BOT_SIGNATURES, ...extraSignatures()]
  return all.some(re => re.test(text))
}

const BURST_WINDOW_MS = (() => { const n = parseInt(process.env.TERMINATION_BURST_WINDOW_MS, 10); return Number.isFinite(n) && n > 0 ? n : 6000 })()
const BURST_MAX = (() => { const n = parseInt(process.env.TERMINATION_BURST_MAX, 10); return Number.isFinite(n) && n > 0 ? n : 8 })()
const burstLog = new Map() // "groupId:sender" -> [timestamps]

function recordAndCheckBurst(key, now) {
  let arr = burstLog.get(key)
  if (!arr) { arr = []; burstLog.set(key, arr) }
  arr.push(now)
  while (arr.length && now - arr[0] > BURST_WINDOW_MS) arr.shift()
  return arr.length > BURST_MAX
}
setInterval(() => {
  const now = Date.now()
  for (const [key, arr] of burstLog) {
    while (arr.length && now - arr[0] > BURST_WINDOW_MS) arr.shift()
    if (!arr.length) burstLog.delete(key)
  }
}, 60_000).unref?.()

// ── shared helpers ───────────────────────────────────────────────────────────
function normalizeNum(raw) { return String(raw || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '').trim() }

function isExempt(sock, senderNorm) {
  if (!senderNorm) return true
  if (senderNorm === normalizeNum(sock.user?.id || '')) return true
  if (OWNER_NUMBERS.includes(senderNorm)) return true
  if (SUDO_NUMBERS.includes(senderNorm)) return true
  return false
}

// Fires reply + delete + kick together, never letting one failure block another.
async function terminate(sock, groupId, targetMsgKey, senderJid, reason) {
  const senderNorm = normalizeNum(senderJid)
  console.log(`[TERMINATION] ☣️ acting on ${senderNorm} in ${groupId} — reason: ${reason}`)

  const actions = [
    sock.sendMessage(groupId, { text: REPLY_TEXT }, { quoted: { key: targetMsgKey, message: {} } })
      .catch(e => console.error('[TERMINATION] reply failed:', e.message)),
    sock.sendMessage(groupId, { delete: targetMsgKey })
      .catch(e => console.error('[TERMINATION] delete failed:', e.message)),
    sock.groupParticipantsUpdate(groupId, [senderJid], 'remove')
      .catch(e => console.error('[TERMINATION] kick failed:', e.message)),
  ]
  await Promise.allSettled(actions)
}

// ── the attached listener itself ────────────────────────────────────────────
function attach(state, sock) {
  const phone = state.phone

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      try {
        if (!m?.message || m.key.fromMe) continue

        // ── STATUS branch: tagging a termination-enabled group in a Status ──
        if (m.key.remoteJid === 'status@broadcast') {
          const ctx = m.message?.extendedTextMessage?.contextInfo || m.message?.imageMessage?.contextInfo || m.message?.videoMessage?.contextInfo
          const groupMentions = ctx?.groupMentions || []
          if (!groupMentions.length) continue

          const senderJid = m.key.participant || m.key.remoteJid
          const senderNorm = normalizeNum(senderJid)
          if (isExempt(sock, senderNorm)) continue

          for (const gm of groupMentions) {
            const groupId = gm.groupJid || gm.jid
            if (!groupId || !isEnabled(phone, groupId)) continue

            let meta
            try { meta = state.groupCache?.[groupId] || await sock.groupMetadata(groupId) } catch { continue }
            const isMember = meta?.participants?.some(p => normalizeNum(p.id) === senderNorm)
            if (!isMember) continue
            const isSenderAdmin = meta?.participants?.some(p => normalizeNum(p.id) === senderNorm && (p.admin === 'admin' || p.admin === 'superadmin'))
            if (isSenderAdmin) continue
            const botIsAdmin = meta?.participants?.some(p => normalizeNum(p.id) === normalizeNum(sock.user?.id || '') && (p.admin === 'admin' || p.admin === 'superadmin'))
            if (!botIsAdmin) { console.log(`[TERMINATION] status-tag from ${senderNorm} but bot isn't admin in ${groupId} — skipping kick`); continue }

            // WhatsApp restricts deleting someone else's Status — attempted, not guaranteed.
            await Promise.allSettled([
              sock.sendMessage(m.key.remoteJid, { delete: m.key }).catch(e => console.log('[TERMINATION] status delete restricted:', e.message)),
              sock.sendMessage(groupId, { text: REPLY_TEXT }).catch(e => console.error('[TERMINATION] reply failed:', e.message)),
              sock.groupParticipantsUpdate(groupId, [senderJid], 'remove').catch(e => console.error('[TERMINATION] kick failed:', e.message)),
            ])
          }
          continue
        }

        // ── GROUP message branch ──
        const groupId = m.key.remoteJid
        if (!groupId?.endsWith('@g.us')) continue
        if (!isEnabled(phone, groupId)) continue

        const senderJid = m.key.participant || groupId
        const senderNorm = normalizeNum(senderJid)
        if (isExempt(sock, senderNorm)) continue

        let meta
        try { meta = state.groupCache?.[groupId] || await sock.groupMetadata(groupId) } catch { continue }
        const isSenderAdmin = meta?.participants?.some(p => normalizeNum(p.id) === senderNorm && (p.admin === 'admin' || p.admin === 'superadmin'))
        if (isSenderAdmin) continue
        const botIsAdmin = meta?.participants?.some(p => normalizeNum(p.id) === normalizeNum(sock.user?.id || '') && (p.admin === 'admin' || p.admin === 'superadmin'))
        if (!botIsAdmin) continue // detection still runs below (so it's visible in logs); acting on it does not

        const texts = extractAllText(m)
        const joined = texts.join(' ')

        let reason = null
        if (texts.some(t => containsLink(t))) reason = 'link'
        else if (looksLikeBotSignature(joined)) reason = 'bot-signature'
        else if (recordAndCheckBurst(`${groupId}:${senderNorm}`, Number(m.messageTimestamp) * 1000 || Date.now())) reason = 'message-burst (possible bot)'

        if (reason && botIsAdmin) {
          await terminate(sock, groupId, m.key, senderJid, reason)
        }
      } catch (e) {
        console.error('[TERMINATION] handler error:', e.message)
      }
    }
  })

  console.log(`[TERMINATION] ☣️ attached for session ${phone}`)
}

module.exports = {
  attach,
  isEnabled,
  enable,
  disable,
  normalizeNum,
  REPLY_TEXT,
  ACTIVATE_TEXT,
  DEACTIVATE_TEXT,
  // exported for testing only — not part of the public surface commands use
  _internal: { containsLink, looksLikeBotSignature, recordAndCheckBurst, normalize, extractAllText },
}

