// ═══════════════════════════════════════════════════════════════
// lib/antilink.js — CYBER X ANTILINK ENGINE (per-session build)
// Auto-loaded by index.js's LIB_DIR loader, called as:
//   lib.handleAntilink(sock, msg, extractBody)
//
// Every WhatsApp session (phone number) running the bot gets its own
// independent antilink settings + warning counts, stored at
// data/antilink/{phone}.json — so if the same group has two of your
// sessions in it, they don't share or clash on config.
//
// OCR is no longer a separate toggle — it's automatically active
// whenever antilink is enabled for that session (if tesseract.js is
// installed). One switch, not two.
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_DIR = path.join(__dirname, "..", "data", "antilink")
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function safePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}

function filePath(phone) {
  return path.join(DATA_DIR, `${safePhone(phone)}.json`)
}

function loadData(phone) {
  const file = filePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTILINK] load error for ${phone}:`, e.message)
  }
  return { groups: {}, warnings: {} }
}

function saveData(phone, data) {
  try {
    fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTILINK] save error for ${phone}:`, e.message)
  }
}

// ─────────────────────────────────────────────────────────
// LINK DETECTION
// ─────────────────────────────────────────────────────────
const LINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  /\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|xyz|top|info|biz|me|link|click|shop|store|online|site|app|dev|tv)\b(?:\/[^\s]*)?/gi,
]

function containsLink(text) {
  if (!text) return false
  return LINK_PATTERNS.some(p => { p.lastIndex = 0; return p.test(text) })
}

function extractAllText(msg) {
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

// ─────────────────────────────────────────────────────────
// OCR — always attempted when antilink is enabled, if tesseract.js
// is installed. No separate on/off switch anymore.
// ─────────────────────────────────────────────────────────
let Tesseract = null
try { Tesseract = require("tesseract.js") } catch {}

let downloadMediaMessage = null
try { downloadMediaMessage = require("@whiskeysockets/baileys").downloadMediaMessage } catch {}

const OCR_AVAILABLE = !!(Tesseract && downloadMediaMessage)

async function scanImageForLinks(sock, msg) {
  if (!OCR_AVAILABLE) return false
  const m = msg.message
  const hasImage = m?.imageMessage || m?.stickerMessage
  if (!hasImage) return false
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {})
    if (!buffer || buffer.length < 100) return false
    const { data: { text } } = await Tesseract.recognize(buffer, "eng", { logger: () => {} })
    return containsLink(text)
  } catch (e) {
    console.error("[ANTILINK OCR]", e.message)
    return false
  }
}

// ─────────────────────────────────────────────────────────
// STATE MANAGEMENT — per session (phone) + per group
// ─────────────────────────────────────────────────────────
function isAntilinkEnabled(phone, groupId) {
  const data = loadData(phone)
  return !!data.groups[groupId]?.enabled
}

function enableAntilink(phone, groupId, action = "warn") {
  const data = loadData(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  data.groups[groupId].action  = action
  saveData(phone, data)
}

function disableAntilink(phone, groupId) {
  const data = loadData(phone)
  if (data.groups[groupId]) {
    data.groups[groupId].enabled = false
    saveData(phone, data)
  }
}

function getAction(phone, groupId) {
  const data = loadData(phone)
  return data.groups[groupId]?.action || "warn"
}

function addWarning(phone, groupId, sender) {
  const data = loadData(phone)
  if (!data.warnings[groupId]) data.warnings[groupId] = {}
  if (!data.warnings[groupId][sender]) data.warnings[groupId][sender] = 0
  data.warnings[groupId][sender]++
  saveData(phone, data)
  return data.warnings[groupId][sender]
}

function getWarnings(phone, groupId, sender) {
  const data = loadData(phone)
  return data.warnings[groupId]?.[sender] || 0
}

function resetWarnings(phone, groupId, sender) {
  const data = loadData(phone)
  if (data.warnings[groupId]?.[sender] !== undefined) {
    data.warnings[groupId][sender] = 0
    saveData(phone, data)
  }
}

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER — called from index.js:
//   lib.handleAntilink(sock, m, extractBody)
// Session identity is derived from sock.user.id, since the hook
// signature doesn't pass phone directly.
// ─────────────────────────────────────────────────────────
async function handleAntilink(sock, msg, extractBody) {
  try {
    if (!msg?.message) return

    const groupId = msg.key.remoteJid
    const sender  = msg.key.participant || groupId
    const isGroup = groupId.endsWith("@g.us")

    if (!isGroup) return
    if (msg.key.fromMe) return

    const phone = normalizeNum(sock.user?.id || "")
    if (!isAntilinkEnabled(phone, groupId)) return

    const allTexts  = extractAllText(msg)
    const foundText = allTexts.some(t => containsLink(t))

    let foundOcr = false
    if (!foundText) {
      foundOcr = await scanImageForLinks(sock, msg)
    }

    if (!foundText && !foundOcr) return

    let groupMeta
    try { groupMeta = await sock.groupMetadata(groupId) } catch (e) {
      console.error("[ANTILINK] metadata fetch failed:", e.message)
      return
    }

    const senderNorm = normalizeNum(sender)
    const isSenderAdmin = groupMeta.participants?.some(p => {
      return normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin")
    })
    if (isSenderAdmin) return

    const botNorm = normalizeNum(sock.user?.id || "")
    const botIsAdmin = groupMeta.participants?.some(p => {
      return normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin")
    })
    if (!botIsAdmin) {
      console.log(`[ANTILINK:${phone}] Link detected in ${groupId} from ${senderNorm} but I'm not admin — cannot act`)
      return
    }

    const action  = getAction(phone, groupId)
    const tag     = senderNorm
    const ocrNote = foundOcr ? "\n│ 🔍 *Detected via image scan (OCR)*" : ""

    await sock.sendMessage(groupId, { delete: msg.key })

    if (action === "delete") {
      await sock.sendMessage(groupId, {
        text: `╔════════════════════╗\n║  🔗 *LINK DETECTED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *BLOCKED* 〕─────\n│ 👤 *User:* @${tag}\n│ ❌ Links are *NOT* allowed here!${ocrNote}\n│ 🗑️ Message has been deleted.\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
    } else if (action === "kick") {
      await sock.sendMessage(groupId, {
        text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *INSTANT KICK* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 *Reason:* Posted a link${ocrNote}\n│ ⚡ *Mode:* Strict — no warnings given\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
      try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") } catch (e) {
        console.error("[ANTILINK] kick failed:", e.message)
      }
    } else if (action === "warn") {
      const warns    = addWarning(phone, groupId, sender)
      const maxWarns = 3

      if (warns >= maxWarns) {
        resetWarnings(phone, groupId, sender)
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ACTION TAKEN* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🔗 *Reason:* Sending links repeatedly${ocrNote}\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") } catch (e) {
          console.error("[ANTILINK] warn-kick failed:", e.message)
        }
      } else {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  ⚠️ *LINK WARNING!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *WARNING* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 Links are *NOT* allowed here!${ocrNote}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🗑️ Message deleted\n│ ⚡ *${maxWarns - warns} more = KICK!*\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
      }
    }

  } catch (err) {
    console.error("[ANTILINK]", err.message)
  }
}

module.exports = {
  handleAntilink,
  isAntilinkEnabled,
  enableAntilink,
  disableAntilink,
  getAction,
  addWarning,
  getWarnings,
  resetWarnings,
  normalizeNum,
  OCR_AVAILABLE,
}
