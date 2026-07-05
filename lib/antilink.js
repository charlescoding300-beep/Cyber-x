// ═══════════════════════════════════════════════════════════════
// lib/antilink.js — CYBER X ANTILINK ENGINE (clean rebuild)
// Auto-loaded by index.js's LIB_DIR loader, called as:
//   lib.handleAntilink(sock, msg, extractBody)
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_DIR  = path.join(__dirname, "..", "data")
const DATA_FILE = path.join(DATA_DIR, "antilink.json")

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  } catch {}
  return { groups: {}, warnings: {}, ocrGroups: {} }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)) }
  catch (e) { console.error("[ANTILINK] Save error:", e.message) }
}

let store = loadData()

// ─────────────────────────────────────────────────────────
// LINK DETECTION — covers the common cases without overcomplicating
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
// OCR (optional — only if tesseract.js is installed)
// ─────────────────────────────────────────────────────────
let Tesseract = null
try { Tesseract = require("tesseract.js") } catch {}

let downloadMediaMessage = null
try { downloadMediaMessage = require("@whiskeysockets/baileys").downloadMediaMessage } catch {}

async function scanImageForLinks(sock, msg) {
  if (!Tesseract || !downloadMediaMessage) return false
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
// STATE MANAGEMENT
// ─────────────────────────────────────────────────────────
function isAntilinkEnabled(jid) { return !!store.groups[jid]?.enabled }
function isOcrEnabled(jid)      { return !!store.ocrGroups?.[jid] }

function enableAntilink(jid, action = "warn") {
  if (!store.groups[jid]) store.groups[jid] = {}
  store.groups[jid].enabled = true
  store.groups[jid].action  = action
  saveData()
}

function disableAntilink(jid) {
  if (store.groups[jid]) { store.groups[jid].enabled = false; saveData() }
}

function enableOcr(jid) {
  if (!store.ocrGroups) store.ocrGroups = {}
  store.ocrGroups[jid] = true
  saveData()
}

function disableOcr(jid) {
  if (!store.ocrGroups) store.ocrGroups = {}
  store.ocrGroups[jid] = false
  saveData()
}

function getAction(jid) { return store.groups[jid]?.action || "warn" }

function addWarning(jid, sender) {
  if (!store.warnings[jid])         store.warnings[jid] = {}
  if (!store.warnings[jid][sender]) store.warnings[jid][sender] = 0
  store.warnings[jid][sender]++
  saveData()
  return store.warnings[jid][sender]
}

function getWarnings(jid, sender) { return store.warnings[jid]?.[sender] || 0 }

function resetWarnings(jid, sender) {
  if (store.warnings[jid]?.[sender] !== undefined) {
    store.warnings[jid][sender] = 0
    saveData()
  }
}

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER — called from index.js exactly like handleBadword/handleAntibot
// ─────────────────────────────────────────────────────────
async function handleAntilink(sock, msg, extractBody) {
  try {
    if (!msg?.message) return

    const from    = msg.key.remoteJid
    const sender  = msg.key.participant || from
    const isGroup = from.endsWith("@g.us")

    if (!isGroup)       return
    if (msg.key.fromMe) return
    if (!isAntilinkEnabled(from)) return

    const allTexts  = extractAllText(msg)
    const foundText = allTexts.some(t => containsLink(t))

    let foundOcr = false
    if (!foundText && isOcrEnabled(from)) {
      foundOcr = await scanImageForLinks(sock, msg)
    }

    if (!foundText && !foundOcr) return

    // ── Skip admins ──
    let groupMeta
    try { groupMeta = await sock.groupMetadata(from) } catch (e) {
      console.error("[ANTILINK] metadata fetch failed:", e.message)
      return
    }

    const senderNorm = normalizeNum(sender)
    const isSenderAdmin = groupMeta.participants?.some(p => {
      return normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin")
    })
    if (isSenderAdmin) return

    // ── Bot must be admin to act ──
    const botNorm = normalizeNum(sock.user?.id || "")
    const botIsAdmin = groupMeta.participants?.some(p => {
      return normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin")
    })
    if (!botIsAdmin) {
      console.log(`[ANTILINK] Link detected in ${from} from ${senderNorm} but I'm not admin — cannot act`)
      return
    }

    const action  = getAction(from)
    const tag     = senderNorm
    const ocrNote = foundOcr ? "\n│ 🔍 *Detected via image scan (OCR)*" : ""

    await sock.sendMessage(from, { delete: msg.key })

    if (action === "delete") {
      await sock.sendMessage(from, {
        text: `╔════════════════════╗\n║  🔗 *LINK DETECTED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *BLOCKED* 〕─────\n│ 👤 *User:* @${tag}\n│ ❌ Links are *NOT* allowed here!${ocrNote}\n│ 🗑️ Message has been deleted.\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
    } else if (action === "kick") {
      await sock.sendMessage(from, {
        text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *INSTANT KICK* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 *Reason:* Posted a link${ocrNote}\n│ ⚡ *Mode:* Strict — no warnings given\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
      try { await sock.groupParticipantsUpdate(from, [sender], "remove") } catch (e) {
        console.error("[ANTILINK] kick failed:", e.message)
      }
    } else if (action === "warn") {
      const warns    = addWarning(from, sender)
      const maxWarns = 3

      if (warns >= maxWarns) {
        resetWarnings(from, sender)
        await sock.sendMessage(from, {
          text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ACTION TAKEN* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🔗 *Reason:* Sending links repeatedly${ocrNote}\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        try { await sock.groupParticipantsUpdate(from, [sender], "remove") } catch (e) {
          console.error("[ANTILINK] warn-kick failed:", e.message)
        }
      } else {
        await sock.sendMessage(from, {
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
  isOcrEnabled,
  enableAntilink,
  disableAntilink,
  enableOcr,
  disableOcr,
  getAction,
  addWarning,
  getWarnings,
  resetWarnings,
}
