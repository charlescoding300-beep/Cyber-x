'use strict'
/**
 * lib/antilink.js — 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 Anti-Link Watchdog (Final + Sticker Safe)
 *
 * Features:
 *  - delete / warn / kick
 *  - antilink = members only (admins exempt)
 *  - antilinkall = everyone including admins
 *  - If bot is not admin → notify only
 *  - Stickers are completely ignored
 *  - OCR only on real images
 *  - Stricter + safer link detection
 */

const LINK_PATTERNS = [
  /https?:\/\/[^\s<>"'`]+/gi,
  /www\.[^\s<>"'`]+/gi,
  /(?:t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|bit\.ly|tinyurl\.com|goo\.gl|youtu\.be|youtube\.com|instagram\.com|facebook\.com|fb\.me|twitter\.com|x\.com|tiktok\.com|vm\.tiktok\.com|discord\.gg|discord\.com|linktr\.ee)\/[^\s<>"'`]*/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9_-]+/gi,
  /(?:[a-z0-9-]+\.)+(com|net|org|io|co|xyz|me|app|link|live|store|shop|online|site|tech|ai|gg|to|ly)(?:\/[^\s<>"'`]*)?/gi
]

const GROUP_STATUS_KEYS = [
  'groupStatusMentionMessage',
  'statusMentionMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
]

const STATUS_TEXT_KEYS = new Set([
  'text', 'conversation', 'caption', 'title', 'body', 'description',
  'sourceUrl', 'mediaUrl', 'thumbnailUrl', 'matchedText', 'matched-text',
  'canonical-url', 'canonicalUrl', 'url', 'href', 'link', 'selectedDisplayText',
])

function unwrapMessage(message) {
  let current = message
  for (let i = 0; i < 5 && current; i++) {
    const inner = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message
    if (!inner) break
    current = inner
  }
  return current
}

function groupStatusPayloads(message) {
  const content = unwrapMessage(message)
  if (!content || typeof content !== 'object') return []
  return GROUP_STATUS_KEYS.map(key => content[key]).filter(Boolean)
}

function statusPayloadHasLink(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) return false
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => statusPayloadHasLink(item, depth + 1, seen))

  for (const [key, child] of Object.entries(value)) {
    if (STATUS_TEXT_KEYS.has(key) && typeof child === 'string' && containsLink(child)) return true
    if (child && typeof child === 'object' && statusPayloadHasLink(child, depth + 1, seen)) return true
  }
  return false
}

function containsLink(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.trim()
  if (t.length < 4) return false
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0
    if (re.test(t)) {
      re.lastIndex = 0
      return true
    }
  }
  return false
}

function deepFindLinks(obj, depth = 0) {
  if (depth > 10 || obj == null) return false
  if (typeof obj === 'string') return containsLink(obj)
  if (typeof obj !== 'object') return false

  // Skip binary / media data
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) return false

  // Skip sticker objects completely
  if (obj.stickerMessage || obj.sticker) return false

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (deepFindLinks(item, depth + 1)) return true
    }
    return false
  }

  // Only scan these safe text-related keys
  const safeKeys = [
    'text', 'conversation', 'caption', 'title', 'body', 'description',
    'sourceUrl', 'mediaUrl', 'thumbnailUrl', 'matchedText', 'matched-text',
    'canonical-url', 'url', 'href', 'link', 'selectedDisplayText'
  ]

  for (const k of safeKeys) {
    if (obj[k] != null && deepFindLinks(obj[k], depth + 1)) return true
  }

  // Also scan contextInfo but only the externalAdReply part
  if (obj.contextInfo?.externalAdReply) {
    if (deepFindLinks(obj.contextInfo.externalAdReply, depth + 1)) return true
  }

  return false
}

function extractText(msg) {
  const m = msg.message || {}
  const parts = []
  const p = (v) => { if (typeof v === 'string' && v.trim()) parts.push(v) }

  p(m.conversation)
  p(m.extendedTextMessage?.text)
  p(m.extendedTextMessage?.matchedText)
  p(m.imageMessage?.caption)
  p(m.videoMessage?.caption)
  p(m.documentMessage?.caption)

  const wrap = [
    m.ephemeralMessage?.message,
    m.viewOnceMessage?.message,
    m.viewOnceMessageV2?.message,
    m.documentWithCaptionMessage?.message,
  ]
  for (const w of wrap) {
    if (!w) continue
    p(w.conversation)
    p(w.extendedTextMessage?.text)
    p(w.imageMessage?.caption)
    p(w.videoMessage?.caption)
  }

  const ctxList = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
  ]
  for (const w of wrap) {
    if (w) {
      ctxList.push(w.extendedTextMessage?.contextInfo)
      ctxList.push(w.imageMessage?.contextInfo)
    }
  }
  for (const ctx of ctxList) {
    if (!ctx?.externalAdReply) continue
    const ad = ctx.externalAdReply
    p(ad.title); p(ad.body); p(ad.sourceUrl); p(ad.mediaUrl); p(ad.thumbnailUrl)
  }
  return parts.join('\n')
}

let Tesseract = null
let OCR_OK = false
try {
  Tesseract = require('tesseract.js')
  OCR_OK = true
  console.log('[ANTILINK] OCR ready')
} catch {
  console.log('[ANTILINK] OCR optional — npm i tesseract.js')
}

async function ocrLink(sock, msg) {
  if (!OCR_OK) return false

  const m = msg.message || {}

  // Completely ignore pure stickers
  if (m.stickerMessage ||
      m.ephemeralMessage?.message?.stickerMessage ||
      m.viewOnceMessage?.message?.stickerMessage ||
      m.viewOnceMessageV2?.message?.stickerMessage) {
    return false
  }

  // Only process real images
  const hasImage = m.imageMessage ||
                   m.ephemeralMessage?.message?.imageMessage ||
                   m.viewOnceMessage?.message?.imageMessage ||
                   m.viewOnceMessageV2?.message?.imageMessage

  if (!hasImage) return false

  try {
    const { downloadMediaMessage } = require('@whiskeysockets/baileys')
    const Pino = require('pino')
    const buf = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: Pino({ level: 'silent' }),
      reuploadRequest: sock.updateMediaMessage,
    })
    if (!buf) return false

    const { data: { text } } = await Tesseract.recognize(buf, 'eng', { logger: () => {} })
    return !!(text && containsLink(text))
  } catch {
    return false
  }
}

let db = null
try { db = require('./userDb') } catch {}

function getCfg(phone, jid) {
  if (!db) {
    return { enabled: false, action: 'delete', maxWarns: 3, applyToAdmins: false }
  }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  const g = s.groups?.[jid] || {}
  return {
    enabled: !!g.enabled,
    action: g.action || 'delete',
    maxWarns: Math.max(1, parseInt(g.maxWarns, 10) || 3),
    applyToAdmins: !!g.applyToAdmins,
  }
}

function setCfg(phone, jid, updates) {
  if (!db) return
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = {
    enabled: false,
    action: 'delete',
    maxWarns: 3,
    applyToAdmins: false,
    ...(s.groups[jid] || {}),
    ...updates,
  }
  db.setSection(phone, 'antilink', s)
}

function warningKey(user) {
  return String(user || '').replace(/:\d+(?=@)/, '')
}

function getWarnCount(phone, jid, user) {
  if (!db) return 0
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  const warnings = s.groups?.[jid] || {}
  const key = Object.keys(warnings).find(stored => warningKey(stored) === warningKey(user))
  return key ? Number(warnings[key]) || 0 : 0
}

function addWarn(phone, jid, user) {
  if (!db) return 1
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = s.groups[jid] || {}
  const warnings = s.groups[jid]
  const key = Object.keys(warnings).find(stored => warningKey(stored) === warningKey(user)) || warningKey(user)
  warnings[key] = (Number(warnings[key]) || 0) + 1
  db.setSection(phone, 'antilink_warns', s)
  return warnings[key]
}

function resetWarn(phone, jid, user) {
  if (!db) return
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  const warnings = s.groups?.[jid]
  if (warnings) {
    for (const stored of Object.keys(warnings)) {
      if (warningKey(stored) === warningKey(user)) delete warnings[stored]
    }
    db.setSection(phone, 'antilink_warns', s)
  }
}

let isAdminLib = null
try { isAdminLib = require('./isAdmin') } catch {}

async function getAdminFlags(sock, jid, sender, senderAlt) {
  let botAdmin = false
  let senderAdmin = false
  try {
    if (isAdminLib) {
      const meta = await sock.groupMetadata(jid)
      const cache = { [jid]: meta }
      botAdmin = !!isAdminLib.isBotAdmin(cache, jid, sock)
      senderAdmin = !!isAdminLib.isAdmin(cache, jid, sender, sock, null, senderAlt)
    } else {
      const meta = await sock.groupMetadata(jid)
      const botNum = String(sock.user?.id || '').split(':')[0].replace(/\D/g, '')
      const senderNum = String(sender || '').split('@')[0].replace(/\D/g, '')
      for (const p of meta.participants || []) {
        const id = String(p.id || '').split('@')[0].replace(/\D/g, '')
        const isAdm = p.admin === 'admin' || p.admin === 'superadmin'
        if (id === botNum && isAdm) botAdmin = true
        if (id === senderNum && isAdm) senderAdmin = true
      }
    }
  } catch (e) {
    console.error('[ANTILINK] admin check:', e.message)
  }
  return { botAdmin, senderAdmin }
}

function tagOf(jid) {
  return String(jid.split('@')[0] || '').replace(/:\d+$/, '')
}

function linkPanel(title, rows) {
  return `┏━━━━━━━「 ${title} 」━━━━━━━┓\n${rows.map(row => `┃ ${row}`).join('\n')}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`
}

function warningPanel(tag, count, maxWarns, removalNote = '') {
  return linkPanel('LINK WARNING', [
    '⚠️ Warning: Links are not allowed.',
    `👤 @${tag} • Warning ${count}/${maxWarns}`,
    ...(removalNote ? [removalNote] : []),
  ])
}

function deletedPanel(tag, isStatus = false) {
  return linkPanel('LINK DELETED', [
    isStatus ? '🗑️ Links in group statuses are not allowed.' : '🗑️ Links are not allowed.',
    isStatus ? `👤 @${tag}’s status share was removed from this group.` : `👤 @${tag}’s message was deleted.`,
  ])
}

function deleteFailedPanel(tag, isStatus = false) {
  return linkPanel('LINK DELETE FAILED', [
    isStatus ? '⚠️ Links in group statuses are not allowed.' : '⚠️ Links are not allowed.',
    isStatus ? `👤 @${tag}’s status share could not be removed from this group.` : `👤 @${tag}’s message could not be deleted.`,
    'Please check that I am a group admin.',
  ])
}

function violationPanel(tag) {
  return linkPanel('LINK VIOLATION', [
    '🔗 Links are not allowed.',
    `👤 @${tag} was removed from the group.`,
  ])
}

function removalFailedPanel(tag) {
  return linkPanel('LINK ACTION FAILED', [
    '⚠️ The warning limit was reached.',
    `👤 @${tag} could not be removed from the group.`,
    'Please check that I am a group admin.',
  ])
}

async function removeMember(sock, groupJid, sender, label) {
  try {
    const result = await sock.groupParticipantsUpdate(groupJid, [sender], 'remove')
    const entries = Array.isArray(result) ? result : [result]
    const item = entries.find(entry => entry?.jid === sender || entry?.id === sender) || entries[0]
    if (item?.status != null) {
      const status = Number(item.status)
      if (Number.isFinite(status) && (status < 200 || status >= 300)) return false
    }
    return true
  } catch (e) {
    console.error(`[ANTILINK] ${label} failed:`, e.message)
    return false
  }
}

async function handleAntilinkInline(sock, msg, phone) {
  try {
    const from = msg.key?.remoteJid
    if (!from?.endsWith('@g.us')) return

    // ─── COMPLETELY IGNORE STICKERS ──────────────────────────────
    const m = msg.message || {}
    if (
      m.stickerMessage ||
      m.ephemeralMessage?.message?.stickerMessage ||
      m.viewOnceMessage?.message?.stickerMessage ||
      m.viewOnceMessageV2?.message?.stickerMessage
    ) {
      return
    }
    // ─────────────────────────────────────────────────────────────

    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'
    const cfg = getCfg(owner, from)
    if (!cfg.enabled) return

    const statusPayloads = groupStatusPayloads(msg.message)
    const statusLinkHit = statusPayloads.some(payload => statusPayloadHasLink(payload))
    let hit = statusLinkHit || containsLink(extractText(msg))
    if (!hit) hit = deepFindLinks(msg.message)
    if (!hit) hit = await ocrLink(sock, msg)
    if (!hit) return

    // If Anti-Status is also enabled, it owns the shared group-status event:
    // it will revoke the post once and apply the persistent status warnings.
    // This prevents two moderation engines from racing to revoke/kick on the
    // same message. With Anti-Status off, Anti-Link handles status links here.
    if (statusLinkHit && typeof global.__antistatusIsEnabled === 'function' &&
        global.__antistatusIsEnabled(owner, from)) return

    const sender = msg.key.participant || from
    const senderAlt = msg.key.participantPn || null
    const tag = tagOf(sender)
    const { botAdmin, senderAdmin } = await getAdminFlags(sock, from, sender, senderAlt)

    // Members-only mode: skip group admins
    if (!cfg.applyToAdmins && senderAdmin) return

    // Bot not admin → notify only
    if (!botAdmin) {
      await sock.sendMessage(from, {
        text: `🔗 *Link detected*\n\n@${tag} shared a link, but I am *not a group admin*, so I cannot delete it.\n\nPlease promote me to admin to enforce link protection.`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    // React
    try { await sock.sendMessage(from, { react: { text: '🔗', key: msg.key } }) } catch {}

    const action = cfg.action || 'delete'
    const maxW = cfg.maxWarns || 3

    // Delete mode is the default. Both delete and warn modes keep durable
    // strikes in SQLite and remove the member when the configured limit hits.
    // The SQLite write is synchronous, so the strike is saved before any sends.
    const count = action === 'kick' ? 0 : addWarn(owner, from, sender)

    // Delete first so later action notices describe the same link message.
    let deleted = false
    try {
      await sock.sendMessage(from, { delete: msg.key })
      deleted = true
    } catch (e) {
      console.error('[ANTILINK] delete failed:', e.message)
    }

    if (action === 'kick') {
      const removed = await removeMember(sock, from, sender, 'kick')
      const panels = [deleted ? deletedPanel(tag, statusLinkHit) : deleteFailedPanel(tag, statusLinkHit)]
      panels.push(removed ? violationPanel(tag) : removalFailedPanel(tag))
      await sock.sendMessage(from, {
        text: panels.join('\n\n'),
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    const panels = [warningPanel(tag, count, maxW)]
    panels.push(deleted ? deletedPanel(tag, statusLinkHit) : deleteFailedPanel(tag, statusLinkHit))

    if (count >= maxW) {
      const removed = await removeMember(sock, from, sender, 'warn-kick')
      if (removed) panels.push(violationPanel(tag))
      else panels.push(removalFailedPanel(tag))
    }

    await sock.sendMessage(from, {
      text: panels.join('\n\n'),
      mentions: [sender],
    }, { quoted: msg }).catch(() => {})
  } catch (e) {
    console.error('[ANTILINK]', e.message)
  }
}

module.exports = {
  handleAntilinkInline,
  handleAntilink: handleAntilinkInline,
  antilinkEnable: (p, j, action = 'delete', maxWarns = 3, applyToAdmins = false) =>
    setCfg(p, j, { enabled: true, action, maxWarns, applyToAdmins }),
  antilinkDisable: (p, j) => setCfg(p, j, { enabled: false }),
  antilinkIsEnabled: (p, j) => !!getCfg(p, j).enabled,
  antilinkGetAction: (p, j) => getCfg(p, j).action || 'delete',
  antilinkContainsLink: containsLink,
  antilinkContainsStatusLink: (msg) => groupStatusPayloads(msg?.message || msg).some(payload => statusPayloadHasLink(payload)),
  antilinkOcrAvailable: OCR_OK,
  getConfig: getCfg,
  setConfig: setCfg,
  getWarnCount,
  resetWarn,
  addWarn,
}
