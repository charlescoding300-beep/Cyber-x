/**
 * lib/antilink.js — CYBER X antilink detection engine.
 *
 * This lives in lib/ on purpose: index.js's loadDir() auto-requires
 * every file in lib/ at startup, merges its exports straight into the
 * global `lib` bucket used by every command, AND hot-reloads it via
 * fs.watch — so editing this file live (no restart) takes effect
 * immediately. That's the "lib support" being referred to.
 *
 * Fully self-contained: doesn't depend on any index.js internals.
 */

const fs   = require("fs")
const path = require("path")

let downloadContentFromMessage
try { ({ downloadContentFromMessage } = require("@whiskeysockets/baileys")) } catch {}

let Tesseract = null
try { Tesseract = require("tesseract.js") } catch {}
const ANTILINK_OCR_AVAILABLE = !!Tesseract && !!downloadContentFromMessage

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE — data/antilink/<phone>.json, same location the old in-index.js
// version used, so existing on/off settings carry over with no migration.
// ─────────────────────────────────────────────────────────────────────────────
const ANTILINK_DIR = path.join(__dirname, "..", "data", "antilink")
if (!fs.existsSync(ANTILINK_DIR)) fs.mkdirSync(ANTILINK_DIR, { recursive: true })

function safePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function filePath(phone) {
  return path.join(ANTILINK_DIR, `${safePhone(phone)}.json`)
}
function loadData(phone) {
  const file = filePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[LIB:ANTILINK] load error for ${phone}:`, e.message)
  }
  return { groups: {}, warnings: {} }
}
function saveData(phone, data) {
  try {
    fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[LIB:ANTILINK] save error for ${phone}:`, e.message)
  }
}

function antilinkIsEnabled(phone, groupId) {
  return !!loadData(phone).groups[groupId]?.enabled
}
function antilinkEnable(phone, groupId, action = "delete") {
  const data = loadData(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  data.groups[groupId].action = action
  saveData(phone, data)
  console.log(`[LIB:ANTILINK] ✔ enabled for ${groupId} on session ${phone} (action=${action})`)
}
function antilinkDisable(phone, groupId) {
  const data = loadData(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; saveData(phone, data) }
  console.log(`[LIB:ANTILINK] ✔ disabled for ${groupId} on session ${phone}`)
}
function antilinkGetAction(phone, groupId) {
  return loadData(phone).groups[groupId]?.action || "delete"
}
function antilinkAddWarning(phone, groupId, sender) {
  const data = loadData(phone)
  if (!data.warnings[groupId]) data.warnings[groupId] = {}
  if (!data.warnings[groupId][sender]) data.warnings[groupId][sender] = 0
  data.warnings[groupId][sender]++
  saveData(phone, data)
  return data.warnings[groupId][sender]
}
function antilinkResetWarnings(phone, groupId, sender) {
  const data = loadData(phone)
  if (data.warnings[groupId]?.[sender] !== undefined) {
    data.warnings[groupId][sender] = 0
    saveData(phone, data)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LINK MATCHING — obfuscation-resistant + WhatsApp Channels + shorteners
// ─────────────────────────────────────────────────────────────────────────────
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

function normalizeText(text) {
  if (!text) return ""
  let t = text.replace(HIDDEN_CHARS, "")
  t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, ".")
       .replace(/\s+dot\s+/gi, ".")
       .replace(/\s*[\(\[]\s*at\s*[\)\]]\s*/gi, "@")
  t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ""))
  return t
}

const ANTILINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /whatsapp\.com\/channel\/[A-Za-z0-9]{10,}/gi,
  /wa\.me\/[^\s]{2,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /discord(?:\.gg|\.com\/invite)\/[^\s]{2,}/gi,
  /\b(?:bit\.ly|bit\.do|tinyurl\.com|cutt\.ly|rebrand\.ly|is\.gd|t\.co|ow\.ly|tiny\.cc|shorturl\.at|rb\.gy|s\.id|lnkd\.in|buff\.ly|t\.ly|soo\.gd|bc\.vc|x\.co|goo\.gl|migre\.me|clicky\.me|budurl\.com|alturl\.com|app\.link|9qr\.de|bitly\.ws|minm\.xyz|s2r\.co|shrtco\.de|lc\.chat|linki\.la)\/[^\s]*/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  /\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|xyz|top|info|biz|me|link|click|shop|store|online|site|app|dev|tv|ng|gg)\b(?:\/[^\s]*)?/gi,
]

function antilinkContainsLink(text) {
  if (!text) return false
  const norm = normalizeText(text)
  return ANTILINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(norm) })
}

function antilinkExtractAllText(msg) {
  const m = msg.message
  if (!m) return []
  const out = []
  const add = v => { if (v && typeof v === "string") out.push(v) }

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

  if (m.buttonsMessage) {
    add(m.buttonsMessage.contentText)
    add(m.buttonsMessage.footerText)
    add(m.buttonsMessage.imageMessage?.caption)
    for (const b of m.buttonsMessage.buttons || []) add(b.buttonText?.displayText)
  }

  const hydrated = m.templateMessage?.hydratedTemplate || m.templateMessage?.hydratedFourRowTemplate
  if (hydrated) {
    add(hydrated.hydratedContentText)
    add(hydrated.hydratedFooterText)
    add(hydrated.imageMessage?.caption)
    for (const b of hydrated.hydratedButtons || []) {
      add(b.urlButton?.url)
      add(b.urlButton?.displayText)
    }
  }

  if (m.interactiveMessage) {
    add(m.interactiveMessage.body?.text)
    add(m.interactiveMessage.footer?.text)
    add(m.interactiveMessage.header?.imageMessage?.caption)
    for (const b of m.interactiveMessage.nativeFlowMessage?.buttons || []) {
      add(b.buttonParamsJson)
    }
  }

  if (m.listMessage) {
    add(m.listMessage.description)
    add(m.listMessage.buttonText)
    for (const s of m.listMessage.sections || []) {
      for (const r of s.rows || []) { add(r.title); add(r.description) }
    }
  }

  return out
}

function antilinkCollectImageCandidates(msg) {
  const m = msg.message
  if (!m) return []
  const candidates = []
  if (m.imageMessage)   candidates.push({ media: m.imageMessage, type: "image" })
  if (m.stickerMessage) candidates.push({ media: m.stickerMessage, type: "sticker" })
  if (m.buttonsMessage?.imageMessage) candidates.push({ media: m.buttonsMessage.imageMessage, type: "image" })
  const hydrated = m.templateMessage?.hydratedTemplate || m.templateMessage?.hydratedFourRowTemplate
  if (hydrated?.imageMessage) candidates.push({ media: hydrated.imageMessage, type: "image" })
  if (m.interactiveMessage?.header?.imageMessage) {
    candidates.push({ media: m.interactiveMessage.header.imageMessage, type: "image" })
  }
  return candidates
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function antilinkScanImage(msg) {
  if (!ANTILINK_OCR_AVAILABLE) return false
  const candidates = antilinkCollectImageCandidates(msg)
  if (!candidates.length) return false
  for (const { media, type } of candidates) {
    try {
      const stream = await downloadContentFromMessage(media, type)
      const buffer = await streamToBuffer(stream)
      if (!buffer || buffer.length < 100) continue
      const { data: { text } } = await Tesseract.recognize(buffer, "eng", { logger: () => {} })
      if (antilinkContainsLink(text)) return true
    } catch (e) {
      console.error("[LIB:ANTILINK OCR]", e.message)
    }
  }
  return false
}

function normalizeNum(raw = "") {
  return String(raw).replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — call this for every incoming message.
// index.js already does this in its messages.upsert loop.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAntilinkInline(sock, msg, phone) {
  try {
    if (!msg?.message) return
    const chatId    = msg.key.remoteJid
    const isGroup    = chatId?.endsWith("@g.us")
    const isChannel  = chatId?.endsWith("@newsletter")
    if (!isGroup && !isChannel) return
    if (msg.key.fromMe) return
    if (!antilinkIsEnabled(phone, chatId)) return

    const sender = msg.key.participant || chatId
    const allTexts  = antilinkExtractAllText(msg)
    const foundText = allTexts.some(t => antilinkContainsLink(t))

    let foundOcr = false
    if (!foundText) foundOcr = await antilinkScanImage(msg)
    if (!foundText && !foundOcr) return

    const ocrNote = foundOcr ? "\n│ 🔍 *Detected via image/button scan (OCR)*" : ""

    if (isChannel) {
      try {
        await sock.sendMessage(chatId, { delete: msg.key })
        console.log(`[LIB:ANTILINK:${phone}] 🗑️ Deleted link/invite post in channel ${chatId}${foundOcr ? " (via OCR)" : ""}`)
      } catch (e) {
        console.error(`[LIB:ANTILINK:${phone}] channel delete failed (may be unsupported on this Baileys version):`, e.message)
      }
      return
    }

    const groupId = chatId
    let groupMeta
    try { groupMeta = await sock.groupMetadata(groupId) } catch (e) {
      console.error("[LIB:ANTILINK] metadata fetch failed:", e.message)
      return
    }

    const senderNorm = normalizeNum(sender)
    const isSenderAdmin = groupMeta.participants?.some(p =>
      normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin"))
    if (isSenderAdmin) return

    const botNorm = normalizeNum(sock.user?.id || "")
    const botIsAdmin = groupMeta.participants?.some(p =>
      normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin"))
    if (!botIsAdmin) {
      console.log(`[LIB:ANTILINK:${phone}] link from ${senderNorm} in ${groupId} but bot isn't admin — cannot delete/kick`)
      return
    }

    const action = antilinkGetAction(phone, groupId)
    const tag    = senderNorm

    try { await sock.sendMessage(groupId, { delete: msg.key }) } catch (e) {
      console.error("[LIB:ANTILINK] delete failed:", e.message)
    }

    try {
      antilinkAddWarning(phone, groupId, senderNorm)
    } catch {}

    if (action === "kick") {
      try {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *INSTANT KICK* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 *Reason:* Posted a link${ocrNote}\n│ ⚡ *Mode:* Strict — no warnings given\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        await sock.groupParticipantsUpdate(groupId, [sender], "remove")
      } catch (e) {
        console.error("[LIB:ANTILINK] kick failed:", e.message)
      }
    } else if (action === "warn") {
      const warns = antilinkAddWarning(phone, groupId, sender)
      const maxWarns = 3
      if (warns >= maxWarns) {
        antilinkResetWarnings(phone, groupId, sender)
        try {
          await sock.sendMessage(groupId, {
            text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ACTION TAKEN* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🔗 *Reason:* Sending links repeatedly${ocrNote}\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
            mentions: [sender]
          })
          await sock.groupParticipantsUpdate(groupId, [sender], "remove")
        } catch (e) {
          console.error("[LIB:ANTILINK] warn-kick failed:", e.message)
        }
      } else {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  ⚠️ *LINK WARNING!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *WARNING* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 Links are *NOT* allowed here!${ocrNote}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🗑️ Message deleted\n│ ⚡ *${maxWarns - warns} more = KICK!*\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
      }
    } else {
      // delete (default)
      await sock.sendMessage(groupId, {
        text: `╔════════════════════╗\n║  🔗 *LINK DETECTED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *BLOCKED* 〕─────\n│ 👤 *User:* @${tag}\n│ 📝 *Reason:* Link/invite detected${ocrNote}\n│ ❌ Links are *NOT* allowed here!\n│ 🗑️ Message has been deleted.\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
    }
  } catch (err) {
    console.error("[LIB:ANTILINK] scan error:", err.message)
  }
}

module.exports = {
  handleAntilinkInline,
  antilinkEnable,
  antilinkDisable,
  antilinkIsEnabled,
  antilinkGetAction,
  antilinkAddWarning,
  antilinkResetWarnings,
  antilinkContainsLink,
  antilinkOcrAvailable: ANTILINK_OCR_AVAILABLE,
}
