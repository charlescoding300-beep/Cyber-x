'use strict'
/**
 * lib/antilink.js — CYBER X Anti-Link Watchdog (upgraded)
 *
 * Index calls: lib.handleAntilinkInline(sock, m, phone)
 *
 * Features:
 *  - delete / warn (custom max) / kick
 *  - antilink  = members only (admins exempt)
 *  - antilinkall = everyone including admins
 *  - If bot is not admin → reply @user link detected, can't delete
 *  - Quote-reply + delete at the same time
 *  - OCR + deep link detection
 */

const LINK_PATTERNS = [
  /https?:\/\/[^\s<>"'`]+/gi,
  /www\.[^\s<>"'`]+/gi,
  /(?:^|[\s([{])(?:t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|bit\.ly|tinyurl\.com|goo\.gl|youtu\.be|youtube\.com|instagram\.com|facebook\.com|fb\.me|fb\.com|twitter\.com|x\.com|tiktok\.com|vm\.tiktok\.com|discord\.gg|discord\.com|linktr\.ee)\/[^\s<>"'`]*/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9_-]+/gi,
  /(?:^|[\s([{])([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+(com|net|org|io|co|ng|me|tv|app|xyz|info|biz|online|site|store|shop|link|live|pro|dev|tech|ai|gg|to|ly|gl|be|uk|us|ca|au|in|za|gh|ke|tz)(?:\/[^\s<>"'`]*)?/gi,
]

function containsLink(text) {
  if (!text || typeof text !== 'string') return false
  const t = text.trim()
  if (t.length < 4) return false
  for (const re of LINK_PATTERNS) {
    re.lastIndex = 0
    if (re.test(t)) { re.lastIndex = 0; return true }
  }
  return false
}

function deepFindLinks(obj, depth = 0) {
  if (depth > 12 || obj == null) return false
  if (typeof obj === 'string') return containsLink(obj)
  if (typeof obj !== 'object') return false
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) return false
  if (Array.isArray(obj)) {
    for (const item of obj) if (deepFindLinks(item, depth + 1)) return true
    return false
  }
  const keys = [
    'text', 'conversation', 'caption', 'title', 'body', 'description',
    'sourceUrl', 'mediaUrl', 'thumbnailUrl', 'matchedText', 'matched-text',
    'canonical-url', 'url', 'href', 'link',
  ]
  for (const k of keys) {
    if (obj[k] != null && deepFindLinks(obj[k], depth + 1)) return true
  }
  for (const k of Object.keys(obj)) {
    if (keys.includes(k)) continue
    if (['jpegThumbnail', 'thumbnail', 'fileSha256', 'fileEncSha256', 'mediaKey'].includes(k)) continue
    try { if (deepFindLinks(obj[k], depth + 1)) return true } catch {}
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
  if (!(m.imageMessage || m.ephemeralMessage?.message?.imageMessage || m.viewOnceMessage?.message?.imageMessage)) return false
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

function getWarnCount(phone, jid, user) {
  if (!db) return 0
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  return s.groups?.[jid]?.[user] || 0
}

function addWarn(phone, jid, user) {
  if (!db) return 1
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = s.groups[jid] || {}
  s.groups[jid][user] = (s.groups[jid][user] || 0) + 1
  db.setSection(phone, 'antilink_warns', s)
  return s.groups[jid][user]
}

function resetWarn(phone, jid, user) {
  if (!db) return
  const s = db.getSection(phone, 'antilink_warns') || { groups: {} }
  if (s.groups?.[jid]) {
    s.groups[jid][user] = 0
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

async function handleAntilinkInline(sock, msg, phone) {
  try {
    const from = msg.key?.remoteJid
    if (!from?.endsWith('@g.us')) return

    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'
    const cfg = getCfg(owner, from)
    if (!cfg.enabled) return

    let hit = containsLink(extractText(msg))
    if (!hit) hit = deepFindLinks(msg.message)
    if (!hit) hit = await ocrLink(sock, msg)
    if (!hit) return

    const sender = msg.key.participant || from
    const senderAlt = msg.key.participantPn || null
    const tag = tagOf(sender)
    const { botAdmin, senderAdmin } = await getAdminFlags(sock, from, sender, senderAlt)

    // Members-only mode: skip group admins
    if (!cfg.applyToAdmins && senderAdmin) return

    // Bot not admin → notify only (no delete)
    if (!botAdmin) {
      await sock.sendMessage(from, {
        text:
`🔗 *Link detected*

@${tag} shared a link, but I am *not a group admin*, so I cannot delete it. 🔕

Please promote me to admin to enforce link protection.`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    // React
    try { await sock.sendMessage(from, { react: { text: '🔗', key: msg.key } }) } catch {}

    const action = cfg.action || 'delete'
    const maxW = cfg.maxWarns || 3

    // Delete first
    try {
      await sock.sendMessage(from, { delete: msg.key })
    } catch (e) {
      console.error('[ANTILINK] delete failed:', e.message)
    }

    if (action === 'delete') {
      await sock.sendMessage(from, {
        text:
`╔══════════════════════╗
║  🔗  LINK REMOVED     ║
╚══════════════════════╝

👤 @${tag}
📌 Sharing links is not allowed here.

> © CYBER X`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove')
      } catch (e) {
        console.error('[ANTILINK] kick failed:', e.message)
      }
      await sock.sendMessage(from, {
        text:
`╔══════════════════════╗
║  🚫  MEMBER REMOVED   ║
╚══════════════════════╝

👤 @${tag}
📌 Removed for sharing a link.

> © CYBER X`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'warn') {
      const count = addWarn(owner, from, sender)
      if (count >= maxW) {
        resetWarn(owner, from, sender)
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove')
        } catch (e) {
          console.error('[ANTILINK] kick-after-warn failed:', e.message)
        }
        await sock.sendMessage(from, {
          text:
`╔════════════════════════╗
║  🚫  REMOVED (WARN MAX) ║
╚════════════════════════╝

👤 @${tag}
⚠️ Warnings: *\( {count}/ \){maxW}*
📌 Shared links too many times.

> © CYBER X`,
          mentions: [sender],
        }, { quoted: msg }).catch(() => {})
      } else {
        const left = maxW - count
        await sock.sendMessage(from, {
          text:
`╔══════════════════════╗
║  ⚠️  WARNING \( {count}/ \){maxW}      ║
╚══════════════════════╝

👤 @${tag}
🔗 Link messages are not allowed.
⏳ *\( {left}* more warning \){left === 1 ? '' : 's'} → removal

> © CYBER X`,
          mentions: [sender],
        }, { quoted: msg }).catch(() => {})
      }
    }
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
  antilinkOcrAvailable: OCR_OK,
  getConfig: getCfg,
  setConfig: setCfg,
  getWarnCount,
  resetWarn,
  addWarn,
}
