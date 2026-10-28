'use strict'
const { sendBotNotAdmin } = require('./groupAdminNotice')
const { getParticipantMention, deleteGroupMessage } = require('./groupModeration')
const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const ACTIONS = new Set(['delete', 'warn', 'kick'])
const pendingWarnKicks = new Set()
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
  // Any current country-code or generic TLD (including .ng), plus ports/paths.
  /(?<![\p{L}\p{N}@._-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"'`)]*)?/giu,
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

const LINK_HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g
const LINK_DOT_LOOKALIKES = /[\u3002\uFF0E\u2024\u2027]/g

function normalizeLinkText(text) {
  let value = String(text || '').normalize('NFKC').replace(LINK_HIDDEN_CHARS, '')
  return value.replace(LINK_DOT_LOOKALIKES, '.')
    .replace(/\s*[\[(]\s*dot\s*[\])\s]*/gi, '.')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/(?:[a-z0-9.]\s+){2,}[a-z0-9.]/gi, match => match.replace(/\s+/g, ''))
}

function containsLink(text) {
  if (!text || typeof text !== 'string') return false
  const t = normalizeLinkText(text).trim()
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
  const m = unwrapMessage(msg.message || {})
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
  try {
    if (!isAdminLib?.getGroupAdminContext) throw new Error('shared WhatsApp admin checker is unavailable')
    return await isAdminLib.getGroupAdminContext(sock, jid, sender, senderAlt)
  } catch (e) {
    console.error('[ANTILINK] admin check:', e.message)
    return { botAdmin: false, senderAdmin: false, available: false, error: e }
  }
}

function tagOf(jid) {
  return String(jid.split('@')[0] || '').replace(/:\d+$/, '')
}

function linkPanel(title, rows) {
  return `┏━━━━━━━「 ${title} 」━━━━━━━┓\n${rows.map(row => `┃ ${row}`).join('\n')}\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`
}

function warningPanel(tag, count, maxWarns) {
  return `*⚠️ @${tag} 𝙻𝙸𝙽𝙺𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*\n*— 𝚆𝙰𝚁𝙽𝙸𝙽𝙶: ${count}/${maxWarns}*`
}

function deletedPanel(tag) {
  return `*🗑️ @${tag}’𝚂 𝙻𝙸𝙽𝙺 𝙼𝙴𝚂𝚂𝙰𝙶𝙴 𝚆𝙰𝚂 𝙳𝙴𝙻𝙴𝚃𝙴𝙳.*\n*— 𝙻𝙸𝙽𝙺𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*`
}

function deleteFailedPanel(tag, isStatus = false) {
  return linkPanel('LINK DELETE FAILED', [
    isStatus ? '⚠️ Links in group statuses are not allowed.' : '⚠️ Links are not allowed.',
    isStatus ? `👤 @${tag}’s status share could not be removed from this group.` : `👤 @${tag}’s message could not be deleted.`,
    'Please check that I am a group admin.',
  ])
}

function violationPanel(tag) {
  return `*❌ @${tag} 𝚆𝙰𝚂 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝙾𝚁 𝚂𝙷𝙰𝚁𝙸𝙽𝙶 𝙰 𝙻𝙸𝙽𝙺.*\n*— 𝙻𝙸𝙽𝙺𝚂 𝙰𝚁𝙴 𝙵𝙾𝚁𝙱𝙸𝙳𝙳𝙴𝙽.*`
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
    const entries = Array.isArray(result) ? result : result ? [result] : []
    const item = entries.find(entry =>
      [entry?.jid, entry?.id].some(id => id && String(id).toLowerCase() === String(sender).toLowerCase())
    ) || (entries.length === 1 ? entries[0] : null)
    if (!item) return false
    if (item.status == null) return true
    const status = Number(item.status)
    return Number.isFinite(status) && status >= 200 && status < 300
  } catch (e) {
    console.error('[ANTILINK] ' + label + ' failed:', e.message)
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
    if (!hit) hit = deepFindLinks(unwrapMessage(msg.message))
    if (!hit) hit = await ocrLink(sock, msg)
    if (!hit) return

    // If Anti-Status is also enabled, it owns the shared group-status event:
    // it will revoke the post once and apply the persistent status warnings.
    // This prevents two moderation engines from racing to revoke/kick on the
    // same message. With Anti-Status off, Anti-Link handles status links here.
    if (statusLinkHit && typeof global.__antistatusIsEnabled === 'function' &&
        global.__antistatusIsEnabled(owner, from)) return

    const senderAlt = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt || null
    const sender = msg.key.participant || senderAlt || from
    const admin = await getAdminFlags(sock, from, sender, senderAlt)
    if (!admin.available) {
      console.error(`[ANTILINK] Could not verify group roles; skipped ${cfg.action} in ${from}`)
      return
    }
    const { botAdmin, senderAdmin } = admin
    const mention = getParticipantMention(admin.meta?.participants, sender, senderAlt)
    const tag = mention.tag || tagOf(sender)
    const mentionJid = mention.jid || sender
    const participantTarget = mention.participant?.id || mention.participant?.jid || sender

    // Members-only mode: skip group admins
    if (!cfg.applyToAdmins && senderAdmin) return

    const action = ACTIONS.has(cfg.action) ? cfg.action : 'delete'

    // Every mode can eventually remove a member, so the bot must be a group admin.
    if (!botAdmin) {
      await sendBotNotAdmin(sock, from, msg).catch(() => {})
      return
    }

    const maxW = cfg.maxWarns || 3

    // Keep strikes in SQLite. Warn mode removes the link silently before
    // sending its one quoted warning; the final strike removes the member.
    if (action === 'warn') {
      const warningIdentity = mention.participant?.phoneNumber || mention.participant?.id || sender
      const count = addWarn(owner, from, warningIdentity)
      const deletion = await deleteGroupMessage(sock, msg, sender)
      if (!deletion.deleted) {
        console.error('[ANTILINK] warning-mode delete failed:', deletion.error?.message || deletion.error)
      }
      if (count >= maxW) {
        const kickKey = owner + ':' + from + ':' + warningKey(warningIdentity)
        if (pendingWarnKicks.has(kickKey)) return
        pendingWarnKicks.add(kickKey)
        try {
          if (!deletion.deleted) {
            await sock.sendMessage(from, {
              text: warningPanel(tag, maxW, maxW),
              mentions: [mentionJid],
            }, { quoted: msg }).catch(e => console.error('[ANTILINK] warning send failed:', e.message))
            return
          }
          const removed = await removeMember(sock, from, participantTarget, 'warn-limit kick')
          const resultText = removed ? violationPanel(tag) : removalFailedPanel(tag) + '\n\n' + CREDIT
          await sock.sendMessage(from, {
            text: resultText,
            mentions: [mentionJid],
          }, { quoted: msg }).catch(e => console.error('[ANTILINK] final-warning notice failed:', e.message))
        } finally {
          pendingWarnKicks.delete(kickKey)
        }
        return
      }

      // A failed delete still produces one warning, but no extra delete panel.
      await sock.sendMessage(from, {
        text: warningPanel(tag, count, maxW),
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error('[ANTILINK] warning send failed:', e.message))
      return
    }
    const deletion = await deleteGroupMessage(sock, msg, sender)
    const deleted = deletion.deleted
    if (!deleted) console.error('[ANTILINK] delete failed:', deletion.error?.message || deletion.error)

    if (action === 'kick') {
      const removed = await removeMember(sock, from, participantTarget, 'kick')
      await sock.sendMessage(from, {
        text: removed ? violationPanel(tag) : `${removalFailedPanel(tag)}\n\n${CREDIT}`,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(() => {})
      return
    }

    await sock.sendMessage(from, {
      text: deleted ? deletedPanel(tag) : `${deleteFailedPanel(tag, statusLinkHit)}\n\n${CREDIT}`,
      mentions: [mentionJid],
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
