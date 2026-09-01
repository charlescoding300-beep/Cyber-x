// lib/antilink.js
// Self-contained antilink engine. index.js's messages.upsert handler
// already does `(lib.handleAntilinkInline || handleAntilinkInline)` —
// the moment this file exports handleAntilinkInline, it takes over from
// the built-in version automatically. Same for antilinkEnable/Disable/
// IsEnabled/GetAction/ResetWarnings/ContainsLink — index.js's init()
// already does `lib.antilinkX || antilinkX` for every one of them, so
// this file's versions win the moment they exist. No index.js edits.

const fs = require("fs")
const path = require("path")

const ANTILINK_DIR = path.join(__dirname, "..", "data", "antilink")
if (!fs.existsSync(ANTILINK_DIR)) fs.mkdirSync(ANTILINK_DIR, { recursive: true })

function normalizeNum(raw = "") {
  return String(raw).replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}
function safePhone(p) { return (p || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_") }
function filePath(phone) { return path.join(ANTILINK_DIR, `${safePhone(phone)}.json`) }

function load(phone) {
  const file = filePath(phone)
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) }
  catch (e) { console.error(`[ANTILINK] load error for ${phone}:`, e.message) }
  return { groups: {}, warnings: {} }
}
function save(phone, data) {
  try { fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2)) }
  catch (e) { console.error(`[ANTILINK] save error for ${phone}:`, e.message) }
}

function antilinkIsEnabled(phone, groupId) { return !!load(phone).groups[groupId]?.enabled }
function antilinkEnable(phone, groupId, action = "warn") {
  const data = load(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  data.groups[groupId].action = action
  save(phone, data)
}
function antilinkDisable(phone, groupId) {
  const data = load(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; save(phone, data) }
}
function antilinkGetAction(phone, groupId) { return load(phone).groups[groupId]?.action || "warn" }
function antilinkAddWarning(phone, groupId, sender) {
  const data = load(phone)
  if (!data.warnings[groupId]) data.warnings[groupId] = {}
  if (!data.warnings[groupId][sender]) data.warnings[groupId][sender] = 0
  data.warnings[groupId][sender]++
  save(phone, data)
  return data.warnings[groupId][sender]
}
function antilinkResetWarnings(phone, groupId, sender) {
  const data = load(phone)
  if (data.warnings[groupId]?.[sender] !== undefined) {
    data.warnings[groupId][sender] = 0
    save(phone, data)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION — maximally aggressive, worldwide, unicode/IDN aware.
// ─────────────────────────────────────────────────────────────────────────────
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

function antilinkNormalize(text) {
  if (!text) return ""
  let t = text.replace(HIDDEN_CHARS, "")
  // Defanging tricks people use to share links without them being
  // clickable/detectable: hxxp://, [.]  ,  (dot)  , " dot ".
  t = t.replace(/hxxps?/gi, m => m.toLowerCase().replace("xx", "tt"))
  t = t.replace(/\[\s*\.\s*\]/g, ".")
  t = t.replace(/\(\s*dot\s*\)/gi, ".")
  t = t.replace(/\[\s*dot\s*\]/gi, ".")
  t = t.replace(/\s+dot\s+/gi, ".")
  // Spaced-out domains: "e x a m p l e . c o m" -> "example.com"
  t = t.replace(/(?:[a-zA-Z0-9\u00a1-\uffff.]\s+){2,}[a-zA-Z0-9\u00a1-\uffff.]/g, m => m.replace(/\s+/g, ""))
  return t
}

// Unicode-aware character class so IDN/international domains (e.g. .рф,
// .中国, .みんな) still get caught, not just ASCII TLDs.
const U = "a-z0-9\\u00a1-\\uffff"

const ANTILINK_PATTERNS = [
  // Explicit scheme — highest confidence, matches anything after it.
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  // WhatsApp / Telegram invite links specifically, even without scheme.
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  // www. prefix, even without a scheme.
  /\bwww\.[^\s]{2,}/gi,
  // Bare IPv4 addresses, optionally with a path.
  /\b(?:\d{1,3}\.){3}\d{1,3}\b(?:\/[^\s]*)?/g,
  // Generic worldwide domain pattern — any label(s) + a final TLD label,
  // unicode-aware so IDN domains match too. This is the broad net; it
  // will occasionally catch abbreviations that look like "word.word".
  new RegExp(`\\b[${U}](?:[${U}-]{0,61}[${U}])?(?:\\.[${U}-]{1,63}){1,}(?:\\/[^\\s]*)?`, "gi"),
]

function antilinkContainsLink(text) {
  if (!text) return false
  const normalized = antilinkNormalize(text)
  return ANTILINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(normalized) })
}

function antilinkExtractAllText(msg) {
  const m = msg.message
  if (!m) return []
  const texts = []
  const add = v => { if (v && typeof v === "string") texts.push(v) }
  add(m.conversation)
  add(m.extendedTextMessage?.text)
  add(m.imageMessage?.caption)
  add(m.videoMessage?.caption)
  add(m.documentMessage?.caption)
  const ctx = m.extendedTextMessage?.contextInfo
  if (ctx) {
    add(ctx.quotedMessage?.conversation)
    add(ctx.quotedMessage?.extendedTextMessage?.text)
  }
  return texts
}

// ─────────────────────────────────────────────────────────────────────────────
// OCR — catches links posted as images/screenshots, not just typed text.
// ─────────────────────────────────────────────────────────────────────────────
let AntilinkTesseract = null
try { AntilinkTesseract = require("tesseract.js") } catch {}
const antilinkOcrAvailable = !!AntilinkTesseract

async function antilinkScanImage(msg, downloadMediaSafe) {
  if (!antilinkOcrAvailable) return false
  const m = msg.message
  const hasImage = m?.imageMessage || m?.stickerMessage
  if (!hasImage) return false
  try {
    const buffer = await downloadMediaSafe(msg, msg._sockRef, 1)
    if (!buffer || buffer.length < 100) return false
    const { data: { text } } = await AntilinkTesseract.recognize(buffer, "eng", { logger: () => {} })
    return antilinkContainsLink(text)
  } catch (e) {
    console.error("[ANTILINK OCR]", e.message)
    return false
  }
}

async function defaultDownloadMediaSafe(msg, sock, retries = 1) {
  const { downloadMediaMessage } = require("@whiskeysockets/baileys")
  const Pino = require("pino")
  for (let i = 0; i <= retries; i++) {
    try {
      return await downloadMediaMessage(msg, "buffer", {}, { logger: Pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage })
    } catch (e) {
      if (i === retries) { console.error("[ANTILINK OCR] download failed:", e.message); return null }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleAntilinkInline(sock, msg, phone) {
  try {
    if (!msg?.message) return
    const groupId = msg.key.remoteJid
    if (!groupId?.endsWith("@g.us")) return
    if (msg.key.fromMe) return
    if (!antilinkIsEnabled(phone, groupId)) return

    const sender = msg.key.participant || groupId
    const allTexts = antilinkExtractAllText(msg)
    const foundText = allTexts.some(t => antilinkContainsLink(t))

    let foundOcr = false
    if (!foundText) {
      msg._sockRef = sock
      foundOcr = await antilinkScanImage(msg, defaultDownloadMediaSafe)
    }
    if (!foundText && !foundOcr) return

    let groupMeta
    try { groupMeta = await sock.groupMetadata(groupId) }
    catch (e) { console.error("[ANTILINK] metadata fetch failed:", e.message); return }

    const senderNorm = normalizeNum(sender)
    const isSenderAdmin = groupMeta.participants?.some(p =>
      normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin"))
    if (isSenderAdmin) return

    const botNorm = normalizeNum(sock.user?.id || "")
    const botIsAdmin = groupMeta.participants?.some(p =>
      normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin"))
    if (!botIsAdmin) {
      console.log(`[ANTILINK:${phone}] link from ${senderNorm} in ${groupId} but bot isn't admin — skipping`)
      return
    }

    const action = antilinkGetAction(phone, groupId)
    const tag = senderNorm
    const ocrNote = foundOcr ? "\n🔍 _Detected via image scan (OCR)_" : ""

    await sock.sendMessage(groupId, { delete: msg.key })

    if (action === "delete") {
      await sock.sendMessage(groupId, {
        text: `🔗 *Link detected*\n\n👤 @${tag}\n🚫 Links aren't allowed here${ocrNote}\n🗑️ Message deleted.\n\n_© CYBER X_`,
        mentions: [sender],
      }, { quoted: msg })
    } else if (action === "kick") {
      await sock.sendMessage(groupId, {
        text: `👢 *User removed*\n\n👤 @${tag}\n🔗 Reason: posted a link${ocrNote}\n⚡ Strict mode — instant kick, no warnings\n\n_© CYBER X_`,
        mentions: [sender],
      }, { quoted: msg })
      try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
      catch (e) { console.error("[ANTILINK] kick failed:", e.message) }
    } else {
      const warns = antilinkAddWarning(phone, groupId, sender)
      const maxWarns = 3
      if (warns >= maxWarns) {
        antilinkResetWarnings(phone, groupId, sender)
        await sock.sendMessage(groupId, {
          text: `👢 *User removed*\n\n👤 @${tag}\n⚠️ Warnings: ${warns}/${maxWarns}\n🔗 Reason: sending links repeatedly${ocrNote}\n\n_© CYBER X_`,
          mentions: [sender],
        }, { quoted: msg })
        try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
        catch (e) { console.error("[ANTILINK] warn-kick failed:", e.message) }
      } else {
        await sock.sendMessage(groupId, {
          text: `⚠️ *Link warning*\n\n👤 @${tag}\n🚫 Links aren't allowed here${ocrNote}\n⚠️ Warnings: ${warns}/${maxWarns} — *${maxWarns - warns} more = instant kick*\n🗑️ Message deleted\n\n_© CYBER X_`,
          mentions: [sender],
        }, { quoted: msg })
      }
    }
  } catch (err) {
    console.error("[ANTILINK]", err.message)
  }
}

module.exports = {
  handleAntilinkInline,
  antilinkEnable,
  antilinkDisable,
  antilinkIsEnabled,
  antilinkGetAction,
  antilinkResetWarnings,
  antilinkContainsLink,
  antilinkOcrAvailable,
}
