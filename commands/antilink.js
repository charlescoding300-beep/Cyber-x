'use strict'
// commands/antilink.js — AntiLink (command + live handler) with WhatsApp GROUP STATUS support
//
// NEW in this version
//  • Links posted in a GROUP STATUS (groupStatusMessageV2) are found and deleted — text, captions,
//    link-preview data, short links, "evil[.]com" style tricks, and (if tesseract.js is installed) text inside images.
//  • Deleting a group status tries every known recipe (LID and phone-number sender ids, raw key,
//    group-status wrapper, status@broadcast revoke) and logs each one as  [ANTILINK] ...
//  • Admin check works with both LID and phone-number ids (no more "admin not recognised").
//  • delete / warn / kick all work for group statuses. Warn counts are saved across restarts.
//  • Extra settings:  .antilink admins on|off · .antilink status on|off · .antilink resetwarn
//
// HOOK-UP (one line, in index.js where your current link check is called for each incoming message):
//     await require('./commands/antilink').handleAntiLink({ sock, msg: m, from: jid })

let db
try { db = require('../lib/userDb') } catch { db = null }
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
const { sendMessageUnstyled } = require('../core/responseTextStyle')

let baileys = {}
try { baileys = require('@systemzero/baileys') } catch { try { baileys = require('@whiskeysockets/baileys') } catch {} }
const { downloadMediaMessage } = baileys

let tesseract = null
let OCR = false
try { tesseract = require('tesseract.js'); OCR = true } catch {}

const DEFAULT_WARN_LIMIT = 3
const ACTIONS = new Set(['delete', 'warn', 'kick'])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const normalizeJid = (j = '') => String(j || '').trim().replace(/:\d+(?=@)/, '')

// ───────────────────────── settings ─────────────────────────
function getCfg(phone, jid) {
  if (!db) return { enabled: false, action: 'delete', maxWarns: DEFAULT_WARN_LIMIT }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  return s.groups?.[jid] || { enabled: false, action: 'delete', maxWarns: DEFAULT_WARN_LIMIT }
}

function setCfg(phone, jid, updates) {
  if (!db) return
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = { ...(s.groups[jid] || { enabled: false, action: 'delete' }), ...updates }
  db.setSection(phone, 'antilink', s)
}

const memWarns = new Map()
function bumpWarn(phone, group, user) {
  if (!db) { const k = `${phone}|${group}|${user}`; const n = (memWarns.get(k) || 0) + 1; memWarns.set(k, n); return n }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  s.warns = s.warns || {}; s.warns[group] = s.warns[group] || {}
  const n = (Number(s.warns[group][user]) || 0) + 1
  s.warns[group][user] = n
  db.setSection(phone, 'antilink', s)
  return n
}
function clearWarn(phone, group, users) {
  if (!db) { for (const u of users) memWarns.delete(`${phone}|${group}|${u}`); return }
  const s = db.getSection(phone, 'antilink') || { groups: {} }
  if (s.warns?.[group]) { for (const u of users) delete s.warns[group][u]; db.setSection(phone, 'antilink', s) }
}

function panel(title, rows) {
  return [`╭───「 ${title} 」───╮`, ...rows.map((row) => `│ ${row}`), '╰────────────────────╯'].join('\n')
}
const getAction = (cfg) => (ACTIONS.has(cfg.action) ? cfg.action : 'delete')
function getWarnLimit(cfg) {
  const limit = Number.parseInt(cfg.maxWarns, 10)
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_WARN_LIMIT
}
function actionDescription(action, warnLimit) {
  if (action === 'warn') return 'Warn; kick at ' + warnLimit + ' saved warnings'
  if (action === 'kick') return 'Delete the link message and remove the sender immediately'
  return 'Delete the link message and send one deletion notice'
}
function sendModeConfirmation(sock, from, msg, mode) {
  const modeLabel = { delete: '𝙳𝙴𝙻𝙴𝚃𝙴', warn: '𝚆𝙰𝚁𝙽', kick: '𝙺𝙸𝙲𝙺' }[mode] || '𝙳𝙴𝙻𝙴𝚃𝙴'
  return sendMessageUnstyled(sock, from, { text: `*✅ 𝙰𝙽𝚃𝙸𝙻𝙸𝙽𝙺 𝙴𝙽𝙰𝙱𝙻𝙴𝙳*\n*— 𝙼𝙾𝙳𝙴: ${modeLabel}*` }, { quoted: msg })
}

// ───────────────────────── group status + link detection ─────────────────────────
const WRAPPERS = ['groupStatusMessageV2', 'groupStatusMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
  'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']
const GS_WRAPPERS = new Set(['groupStatusMessageV2', 'groupStatusMessage'])

function unwrap(message) {
  let cur = message
  let viaGroupStatus = false
  for (let i = 0; i < 12 && cur; i++) {
    let moved = false
    for (const w of WRAPPERS) {
      if (cur[w]?.message) { if (GS_WRAPPERS.has(w)) viaGroupStatus = true; cur = cur[w].message; moved = true; break }
    }
    if (!moved) break
  }
  return { inner: cur || null, viaGroupStatus }
}

function deepHasFlag(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 7) return false
  if (obj.isGroupStatus === true) return true
  for (const k of Object.keys(obj)) {
    if (k === 'groupStatusMessageV2' || k === 'groupStatusMessage') return true
    const v = obj[k]
    if (v && typeof v === 'object' && !(v instanceof Uint8Array) && deepHasFlag(v, depth + 1)) return true
  }
  return false
}
const isGroupStatus = (msg) => !!msg?.message && (unwrap(msg.message).viaGroupStatus || deepHasFlag(msg.message))

const TLDS = 'com|net|org|io|me|ly|gg|co|app|link|xyz|info|biz|online|site|shop|store|top|club|vip|live|cc|tv|ng|uk|us|in|de|fr|ru|tk|ml|ga|cf|gq|to|so|ws|bz|cn|ai|dev|page|click|today|world|space|fun|icu|cyou|buzz|pw|su|ink|sh|be|ke|za|gh|tech|cloud|website|ua|br|ir|pk|bd|ae|sa|eg|ma|tz|ug'
const LINK_RE = new RegExp(
  '(?:https?:\\/\\/|www\\.)[^\\s<>"\']+' +
  '|\\b(?:wa\\.me|t\\.me|chat\\.whatsapp\\.com|whatsapp\\.com\\/channel|bit\\.ly|tinyurl\\.com|youtu\\.be|discord\\.gg)\\/[^\\s<>"\']*' +
  `|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})\\b(?:\\/[^\\s<>"']*)?`,
  'gi'
)

function cleanText(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '')
    .replace(/[。｡]/g, '.')
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\s*[\[(]\s*dot\s*[\])]\s*/gi, '.')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ' ')
}

function collectTexts(message) {
  const { inner } = unwrap(message)
  if (!inner) return []
  const out = []
  const push = (v) => { if (typeof v === 'string' && v) out.push(v) }
  push(inner.conversation)
  for (const k of Object.keys(inner)) {
    const n = inner[k]
    if (!n || typeof n !== 'object') continue
    push(n.text); push(n.caption); push(n.matchedText); push(n.canonicalUrl)
    push(n.title); push(n.description); push(n.contentText); push(n.selectedDisplayText)
    const ad = n.contextInfo?.externalAdReply
    if (ad) { push(ad.sourceUrl); push(ad.title); push(ad.body) }
  }
  return out
}

function linksInText(t) {
  const seen = new Set()
  for (const m of cleanText(t).match(LINK_RE) || []) seen.add(m.replace(/[),.;!?]+$/, '').toLowerCase())
  return [...seen]
}
const findLinks = (msg) => [...new Set(collectTexts(msg?.message).flatMap(linksInText))]

// ───────────────────────── OCR (optional) ─────────────────────────
let workerP = null
let ocrImpl = async (buffer) => {
  if (!tesseract) return ''
  try {
    if (!workerP) workerP = tesseract.createWorker('eng')
    const w = await workerP
    const res = await Promise.race([w.recognize(buffer), sleep(25000).then(() => null)])
    return res?.data?.text || ''
  } catch (_) { workerP = null; return '' }
}

async function linksInImage(sock, msg) {
  const { inner } = unwrap(msg.message)
  const img = inner?.imageMessage
  if (!img || !downloadMediaMessage) return []
  if (Number(img.fileLength) > 6 * 1024 * 1024) return []
  try {
    const buf = await downloadMediaMessage({ key: { ...msg.key, fromMe: false }, message: msg.message }, 'buffer', {}, { logger: sock.logger, reuploadRequest: sock.updateMediaMessage })
    return linksInText(await ocrImpl(buf))
  } catch (_) { return [] }
}

// ───────────────────────── identity / admin (LID-safe) ─────────────────────────
function senderForms(msg) {
  const k = msg?.key || {}
  const c = [k.participant, k.participantAlt, k.participantPn, k.participantLid, msg?.participant]
  return [...new Set(c.filter(Boolean).map(normalizeJid))]
}
const participantForms = (p) => [p?.id, p?.lid, p?.jid, p?.phoneNumber].filter(Boolean).map(normalizeJid)

function findParticipant(meta, forms) {
  return (meta?.participants || []).find((p) => participantForms(p).some((f) => forms.includes(f)))
}
const isSenderAdmin = (meta, msg) => !!findParticipant(meta, senderForms(msg))?.admin
function isBotAdmin(sock, meta) {
  const mine = [sock?.user?.id, sock?.user?.lid, sock?.user?.jid].filter(Boolean).map(normalizeJid)
  return (meta?.participants || []).some((p) => p.admin && participantForms(p).some((f) => mine.includes(f)))
}
const userKey = (p, forms) => normalizeJid(p?.phoneNumber || p?.id || forms.find((f) => f.endsWith('@s.whatsapp.net')) || forms[0] || '')

const metaCache = new WeakMap()
async function getMeta(sock, jid) {
  let m = metaCache.get(sock)
  if (!m) { m = new Map(); metaCache.set(sock, m) }
  const hit = m.get(jid)
  if (hit && Date.now() - hit.ts < 30000) return hit.meta
  try { const meta = await sock.groupMetadata(jid); m.set(jid, { ts: Date.now(), meta }); return meta }
  catch (_) { return hit?.meta || null }
}

// ───────────────────────── deleting ─────────────────────────
// Normal message: standard admin delete. Group status: every known recipe, each logged.
async function deleteMessage(sock, msg, groupJid, gs, meta) {
  const id = msg.key.id
  const out = []
  const attempt = async (name, fn) => {
    try { await fn(); out.push(`${name}: sent`) } catch (e) { out.push(`${name}: ERROR ${e?.message || e}`) }
    await sleep(gs ? 300 : 0)
  }

  if (!gs) {
    await attempt('delete', () => sock.sendMessage(groupJid, { delete: { ...msg.key, remoteJid: groupJid, fromMe: false } }))
    return out
  }

  const forms = senderForms(msg)
  const tag = (f) => (f.endsWith('@lid') ? 'lid' : f ? 'pn' : 'none')
  const part = forms.length ? forms : ['']
  const keyFor = (f) => ({ remoteJid: groupJid, id, fromMe: false, ...(f ? { participant: f } : {}) })

  for (const f of part) await attempt(`group-delete(${tag(f)})`, () => sock.sendMessage(groupJid, { delete: keyFor(f) }))

  if (msg.key.remoteJid && msg.key.remoteJid !== groupJid) {
    await attempt(`raw-key(${msg.key.remoteJid})`, () => sock.sendMessage(msg.key.remoteJid, { delete: { ...msg.key, fromMe: false } }))
  }

  if (typeof sock.relayMessage === 'function') {
    for (const f of part) {
      await attempt(`status-wrapper-revoke(${tag(f)})`, () => sock.relayMessage(groupJid, {
        groupStatusMessageV2: { message: { protocolMessage: { type: 0, key: keyFor(f) } } },
      }, {}))
    }
  }

  const audience = new Set([normalizeJid(sock?.user?.id || '').replace(/@.*$/, '') + '@s.whatsapp.net'])
  for (const p of meta?.participants || []) for (const f of participantForms(p)) if (f.endsWith('@s.whatsapp.net')) audience.add(f)
  for (const f of part) {
    await attempt(`status-broadcast-revoke(${tag(f)})`, () => sock.sendMessage('status@broadcast', {
      delete: { remoteJid: 'status@broadcast', id, fromMe: false, ...(f ? { participant: f } : {}) },
    }, { statusJidList: [...audience] }))
  }
  return out
}

// ───────────────────────── the live handler ─────────────────────────
const seenBySock = new WeakMap()
const noticeAt = new Map()
const adminNoticeAt = new Map()

async function say(sock, from, text, mentions = []) {
  try { await sendMessageUnstyled(sock, from, { text, mentions }) }
  catch (_) { try { await sock.sendMessage(from, { text, mentions }) } catch (__) {} }
}

async function handleAntiLink({ sock, msg, from }) {
  try {
    if (!from || !from.endsWith('@g.us') || !msg?.message || msg.key?.fromMe) return false
    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const cfg = getCfg(phone, from)
    if (!cfg.enabled) return false

    const gs = isGroupStatus(msg)
    if (gs && cfg.scanStatus === false) return false

    let seen = seenBySock.get(sock)
    if (!seen) { seen = new Set(); seenBySock.set(sock, seen) }
    const sid = `${from}|${msg.key.id}`
    if (seen.has(sid)) return false

    let links = findLinks(msg)
    if (!links.length && OCR && cfg.scanImages !== false) links = await linksInImage(sock, msg)
    if (!links.length) return false

    seen.add(sid)
    if (seen.size > 2000) seen.delete(seen.values().next().value)

    const meta = await getMeta(sock, from)
    if (!meta) { console.log(`[ANTILINK] ${from}: group info unavailable, skipped`); return false }
    const senderIsAdmin = isSenderAdmin(meta, msg)
    if (senderIsAdmin && !cfg.applyToAdmins) return false

    if (!isBotAdmin(sock, meta)) {
      if (Date.now() - (adminNoticeAt.get(from) || 0) > 10 * 60 * 1000) {
        adminNoticeAt.set(from, Date.now())
        try { await sendBotNotAdmin(sock, from, msg) } catch (_) {}
      }
      return true
    }

    const action = getAction(cfg)
    const forms = senderForms(msg)
    const p = findParticipant(meta, forms)
    const target = p?.id || forms[0]
    const num = String(target || '').replace(/@.*$/, '')
    const label = gs ? 'group status' : 'message'

    const attempts = await deleteMessage(sock, msg, from, gs, meta)
    console.log(`[ANTILINK] ${from} ${label} from ${num} links=${links.join(',')} action=${action} :: ${attempts.join(' | ')}`)

    const nkey = `${from}|${num}`
    const quiet = Date.now() - (noticeAt.get(nkey) || 0) < 8000
    const mention = target ? [target] : []

    if (action === 'kick' && !senderIsAdmin && target) {
      try { await sock.groupParticipantsUpdate(from, [target], 'remove') } catch (e) { console.log(`[ANTILINK] kick failed: ${e?.message || e}`) }
      await say(sock, from, `🚫 @${num} was removed for posting a link${gs ? ' in the group status' : ''}.`, mention)
      return true
    }

    if (action === 'warn') {
      const limit = getWarnLimit(cfg)
      const key = userKey(p, forms)
      const n = bumpWarn(phone, from, key)
      if (n >= limit && !senderIsAdmin && target) {
        clearWarn(phone, from, [key])
        try { await sock.groupParticipantsUpdate(from, [target], 'remove') } catch (e) { console.log(`[ANTILINK] kick failed: ${e?.message || e}`) }
        await say(sock, from, `🚫 @${num} reached ${limit} warnings and was removed.`, mention)
      } else {
        await say(sock, from, `⚠️ @${num}, links are not allowed here${gs ? ' (group status)' : ''}. Warning ${n}/${limit}.`, mention)
      }
      noticeAt.set(nkey, Date.now())
      return true
    }

    if (!quiet) await say(sock, from, `🚫 @${num}, links are not allowed in this group${gs ? ' (group status removed)' : ''}.`, mention)
    noticeAt.set(nkey, Date.now())
    return true
  } catch (e) {
    console.error('[ANTILINK] handler error:', e?.stack || e)
    return false
  }
}

// ───────────────────────── the command ─────────────────────────
module.exports = {
  pattern: 'antilink',
  alias: ['al'],
  desc: 'Set how this group handles links (messages AND group statuses)',
  usage: '.antilink [on|off|delete|warn|kick|admins on|off|status on|off|resetwarn]',
  category: 'group',

  async run({ sock, from, msg, args, isGroup, isAdmin, isBotAdmin: botIsAdmin }) {
    if (!isGroup) return sock.sendMessage(from, { text: 'Use *.antilink* inside a group.' }, { quoted: msg })
    if (!isAdmin) return sock.sendMessage(from, { text: 'Only group admins can change link protection settings.' }, { quoted: msg })

    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()
    const cfg = getCfg(phone, from)
    const action = getAction(cfg)
    const warnLimit = getWarnLimit(cfg)

    if (!sub) {
      return sock.sendMessage(from, {
        text:
          `${panel('ANTI-LINK', [
            `Status: ${cfg.enabled ? 'On' : 'Off'}`,
            `Mode: ${actionDescription(action, warnLimit)}`,
            `Admins: ${cfg.applyToAdmins ? 'included' : 'skipped'}`,
            `Group status links: ${cfg.scanStatus === false ? 'Not scanned' : 'Scanned and deleted'}`,
            `Image link scan: ${OCR ? 'Available' : 'Text only (OCR unavailable)'}`,
            'Warning counts: saved across VPS restarts',
          ])}\n\n` +
          `*Settings*\n` +
          `.antilink on — default delete mode\n` +
          `.antilink off — turn protection off\n` +
          `.antilink delete — delete and send one notice\n` +
          `.antilink warn — warn; kick after 3 saved warnings\n` +
          `.antilink kick — remove a member immediately\n` +
          `.antilink admins on|off — also check admins\n` +
          `.antilink status on|off — scan links in group statuses\n` +
          `.antilink resetwarn — reset a member's saved count (reply or mention)`,
      }, { quoted: msg })
    }

    if (sub === 'on') {
      if (!botIsAdmin) return sendBotNotAdmin(sock, from, msg)
      setCfg(phone, from, { enabled: true, action: 'delete' })
      return sendModeConfirmation(sock, from, msg, 'delete')
    }

    if (sub === 'off') {
      setCfg(phone, from, { enabled: false })
      return sock.sendMessage(from, {
        text: panel('ANTI-LINK', ['✅ Protection is off for this group', `Saved mode: ${actionDescription(action, warnLimit)}`]),
      }, { quoted: msg })
    }

    if (ACTIONS.has(sub)) {
      if (!botIsAdmin) return sendBotNotAdmin(sock, from, msg)
      setCfg(phone, from, { enabled: true, action: sub })
      return sendModeConfirmation(sock, from, msg, sub)
    }

    if (sub === 'admins' || sub === 'status') {
      const v = (args[1] || '').toLowerCase()
      if (v !== 'on' && v !== 'off') return sock.sendMessage(from, { text: `Use *.antilink ${sub} on* or *.antilink ${sub} off*` }, { quoted: msg })
      setCfg(phone, from, sub === 'admins' ? { applyToAdmins: v === 'on' } : { scanStatus: v === 'on' })
      return sock.sendMessage(from, {
        text: sub === 'admins'
          ? `✅ Admins are now ${v === 'on' ? 'included in' : 'skipped by'} AntiLink.`
          : `✅ Links in group statuses are now ${v === 'on' ? 'scanned and deleted' : 'ignored'}.`,
      }, { quoted: msg })
    }

    if (sub === 'resetwarn') {
      const ctx = msg.message?.extendedTextMessage?.contextInfo
      const targets = [...(ctx?.mentionedJid || []), ...(ctx?.participant ? [ctx.participant] : [])].map(normalizeJid)
      if (!targets.length) return sock.sendMessage(from, { text: 'Reply to the member or mention them: *.antilink resetwarn @user*' }, { quoted: msg })
      const meta = await getMeta(sock, from)
      const keys = []
      for (const t of targets) { const p = findParticipant(meta, [t]); keys.push(userKey(p, [t]), normalizeJid(t)) }
      clearWarn(phone, from, [...new Set(keys)])
      return sock.sendMessage(from, { text: '✅ Saved link warnings reset.' }, { quoted: msg })
    }

    return sock.sendMessage(from, { text: `❌ Unknown option: *${sub}*\nType *.antilink* to see the available settings.` }, { quoted: msg })
  },

  handleAntiLink,
  findLinks,
  isGroupStatus,
  _setOcr: (fn) => { ocrImpl = fn; OCR = true },
  _resetCooldowns: () => { noticeAt.clear(); adminNoticeAt.clear() },
}
