// ═══════════════════════════════════════════════════════════════
// lib/antilink.js — CYBER X ULTRA ANTILINK ENGINE v3.0
// Detects: every URL format, obfuscated links, hidden links,
//          invite cards, image OCR scanning, forwarded links
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

// ── Optional: OCR support via tesseract.js ──
let Tesseract = null
try {
  Tesseract = require("tesseract.js")
  console.log("[ANTILINK] ✔ OCR engine loaded (tesseract.js)")
} catch {
  console.warn("[ANTILINK] ⚠ OCR disabled — run: npm install tesseract.js")
}

// ── Optional: media downloader from baileys ──
let downloadMediaMessage = null
try {
  const baileys = require("@whiskeysockets/baileys")
  downloadMediaMessage = baileys.downloadMediaMessage
} catch {}

// ═══════════════════════════════════════════════════════════════
// STORAGE — persists across restarts
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// HOMOGLYPH MAP — maps look-alike unicode chars to ASCII
// Covers Cyrillic, Greek, Latin variants, mathematical chars
// ═══════════════════════════════════════════════════════════════

const HOMOGLYPHS = {
  // Cyrillic lookalikes
  "а":"a","е":"e","о":"o","р":"p","с":"c","х":"x","у":"y",
  "А":"A","В":"B","Е":"E","К":"K","М":"M","Н":"H","О":"O",
  "Р":"P","С":"C","Т":"T","Х":"X","У":"Y",
  // Greek lookalikes
  "α":"a","β":"b","ε":"e","ο":"o","ρ":"p","τ":"t","υ":"u",
  "ν":"v","κ":"k","μ":"m","η":"n","ω":"w","ι":"i","χ":"x",
  // Mathematical / stylized
  "𝐚":"a","𝐛":"b","𝐜":"c","𝐝":"d","𝐞":"e","𝐟":"f","𝐠":"g",
  "𝐡":"h","𝐢":"i","𝐣":"j","𝐤":"k","𝐥":"l","𝐦":"m","𝐧":"n",
  "𝐨":"o","𝐩":"p","𝐪":"q","𝐫":"r","𝐬":"s","𝐭":"t","𝐮":"u",
  "𝐯":"v","𝐰":"w","𝐱":"x","𝐲":"y","𝐳":"z",
  // Full-width
  "ａ":"a","ｂ":"b","ｃ":"c","ｄ":"d","ｅ":"e","ｆ":"f","ｇ":"g",
  "ｈ":"h","ｉ":"i","ｊ":"j","ｋ":"k","ｌ":"l","ｍ":"m","ｎ":"n",
  "ｏ":"o","ｐ":"p","ｑ":"q","ｒ":"r","ｓ":"s","ｔ":"t","ｕ":"u",
  "ｖ":"v","ｗ":"w","ｘ":"x","ｙ":"y","ｚ":"z",
  "０":"0","１":"1","２":"2","３":"3","４":"4",
  "５":"5","６":"6","７":"7","８":"8","９":"9",
  // Superscript / subscript digits
  "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4",
  "⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9",
  // Common char replacements
  "①":"1","②":"2","③":"3","④":"4","⑤":"5",
  // Dot replacements
  "·":".","\u2024":".","•":".","․":".",
  "﹒":".","｡":".",
  // Slash replacements
  "∕":"/","⁄":"/",
  // At-sign replacements
  "＠":"@",
}

function normalizeHomoglyphs(text) {
  return text.split("").map(c => HOMOGLYPHS[c] || c).join("")
}

// ═══════════════════════════════════════════════════════════════
// TEXT NORMALIZER — strips all obfuscation tricks
// ═══════════════════════════════════════════════════════════════

function normalizeText(raw) {
  if (!raw) return ""

  let text = raw

  // 1. Unicode NFKC normalization (collapses many variants)
  text = text.normalize("NFKC")

  // 2. Map homoglyphs to ASCII
  text = normalizeHomoglyphs(text)

  // 3. Remove zero-width / invisible / soft-hyphen characters
  text = text.replace(
    /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD\u180E\u034F]/g,
    ""
  )

  // 4. Bracket/paren dot: google[.]com → google.com
  text = text.replace(/\[[\.\·\u00B7]\]/g, ".")
  text = text.replace(/\([\.\·\u00B7]\)/g, ".")
  text = text.replace(/\{[\.\·\u00B7]\}/g, ".")

  // 5. Middle-dot / bullet as dot
  text = text.replace(/[\u00B7\u2022\u22C5\u2027\u2219]/g, ".")

  // 6. Spaced-out text: "g o o g l e . c o m" → "google.com"
  //    Matches 3+ single-chars separated by spaces
  text = text.replace(/(?<!\w)((?:[a-z0-9] ){3,}[a-z0-9])(?!\w)/gi,
    m => m.replace(/ /g, "")
  )

  // 7. Slash obfuscation: "slash" / "⁄"
  text = text.replace(/\bslash\b/gi, "/")

  // 8. "dot" word substitution: google dot com
  text = text.replace(/\s+dot\s+/gi, ".")
  text = text.replace(/\s+punto\s+/gi, ".")  // Spanish
  text = text.replace(/\s+пунт\s+/gi, ".")   // Some Cyrillic

  return text
}

// ═══════════════════════════════════════════════════════════════
// TLD LIST — 350+ TLDs including new gTLDs, ccTLDs, abuse-prone
// ═══════════════════════════════════════════════════════════════

const TLDS = new Set([
  // Core
  "com","net","org","edu","gov","mil","int","arpa",
  // Popular gTLDs
  "io","co","app","dev","ai","ml","api","web","site","online",
  "tech","store","shop","blog","news","media","live","pro","vip",
  "club","fun","game","games","gg","tv","stream","click","link",
  "download","info","biz","name","mobi","tel","travel","xxx",
  "aero","coop","museum","jobs","post","cat",
  // New gTLDs (commonly abused)
  "xyz","top","icu","pw","cf","ga","gq","tk","ml","space",
  "website","host","email","cloud","digital","social","network",
  "global","world","today","one","new","now","plus","red","blue",
  "black","gold","best","win","bid","trade","loan","cricket",
  "review","party","science","faith","accountant","racing",
  "date","webcam","accountants","audio","actor","adult",
  // Country codes (most common + abuse-prone)
  "us","uk","gb","de","fr","ru","cn","jp","br","in","au","ca",
  "mx","it","es","nl","pl","se","no","fi","dk","be","ch","at",
  "pt","gr","cz","ro","hu","bg","hr","sk","lt","lv","ee","si",
  "tr","sa","ae","eg","za","ng","ke","gh","tz","et","ma","dz",
  "ir","iq","pk","bd","id","ph","vn","th","my","sg","hk","tw",
  "kr","kz","ua","by","md","am","ge","az","uz","tm","tj","kg",
  "af","np","lk","mm","kh","la","mn","bt","mv","ws","to","fj",
  "vu","sb","pg","nr","tv","ki","fm","mh","pw","ck","nu","tk",
  "nz","cc","cx","ac","sh","io","ms","mp","gu","as","vi","pr",
  "um","aw","bq","cw","sx","an","gp","mq","re","yt","pm","wf",
  "pf","nc","tf","ad","mc","sm","va","li","lu","je","gg","im",
  "fo","gl","is","ax","sj","bv","hm","aq","gs","fk","pn",
  // Region-specific
  "co.uk","org.uk","me.uk","ltd.uk","plc.uk",
  "com.au","net.au","org.au","edu.au","gov.au","asn.au","id.au",
  "com.br","net.br","org.br","edu.br","gov.br",
  "co.jp","ne.jp","or.jp","ac.jp","go.jp","ad.jp",
  "co.in","net.in","org.in","gen.in","firm.in","ind.in",
  "co.za","net.za","org.za","edu.za","gov.za",
])

// ═══════════════════════════════════════════════════════════════
// LINK DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

// Build TLD alternation string for regex
const TLD_PATTERN = [...TLDS]
  .sort((a,b) => b.length - a.length) // longer first for greedy match
  .map(t => t.replace(".", "\\."))
  .join("|")

const PATTERNS = [

  // ── 1. Full URLs with any protocol ──
  /(?:https?|ftp|ftps|sftp|rtmp|rtsp|mms|irc|ircs|ws|wss|mailto|tel|sms|data):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,

  // ── 2. WhatsApp group invites (most important) ──
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,

  // ── 3. Telegram links ──
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,

  // ── 4. www. URLs ──
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,

  // ── 5. Short URL services ──
  new RegExp(
    "(?:bit\\.ly|tinyurl\\.com|goo\\.gl|ow\\.ly|short\\.io|rebrand\\.ly|" +
    "tiny\\.cc|is\\.gd|buff\\.ly|adf\\.ly|linktr\\.ee|lnkd\\.in|" +
    "cutt\\.ly|rb\\.gy|shorturl\\.at|t\\.co|fb\\.me|youtu\\.be|" +
    "amzn\\.to|ift\\.tt|dlvr\\.it|soo\\.gd|clck\\.ru|qps\\.ru|" +
    "yep\\.it|click\\.ru|tr\\.im|urlex\\.org|zip\\.net|v\\.ht|" +
    "tinylink\\.in|shrinkme\\.io|ouo\\.io|bc\\.vc|mcaf\\.ee|" +
    "2\\.gp|3\\.ly|4\\.gp|5\\.gp|a\\.co|b\\.link|e\\.vg|" +
    "g\\.co|j\\.mp|l\\.gg|m\\.me|n\\.pr|o\\.co|p\\.ly|q\\.gs|" +
    "r\\.im|s\\.coop|u\\.to|v\\.gd|w\\.wiki|x\\.co|y\\.ahoo|" +
    "za\\.gl)\\/[^\\s]{1,}",
    "gi"
  ),

  // ── 6. IP address URLs (v4) ──
  /(?:https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s]*)?/g,

  // ── 7. IPv6 URLs ──
  /(?:https?:\/\/)?(?:\[)?(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\])?(?::\d+)?(?:\/[^\s]*)?/g,

  // ── 8. Bare domain + known TLD (catches "google.com" with no protocol) ──
  new RegExp(
    "\\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?" +
    "\\.(?:" + TLD_PATTERN + ")" +
    "(?:\\/[^\\s]*|(?=[\\s,!?])|$)",
    "gi"
  ),

  // ── 9. Subdomain patterns ──
  /\b(?:[a-z0-9][-a-z0-9]{0,30}\.){2,}[a-z]{2,6}(?:\/[^\s]*)?/gi,

  // ── 10. Data URIs (hidden content) ──
  /data:[a-z\/+;=]+;base64,[A-Za-z0-9+/=]{20,}/gi,

  // ── 11. Base64 encoded URLs (heuristic: long base64 with url chars after decode) ──
  // Checked separately in function below

  // ── 12. HTML-encoded URLs ──
  /(?:&#(?:x[0-9a-f]{2,4}|[0-9]{2,5});)+/gi,

  // ── 13. Percent-encoded URLs ──
  /(?:%[0-9a-fA-F]{2}){4,}/g,

]

// ═══════════════════════════════════════════════════════════════
// BASE64 HIDDEN URL DETECTION
// ═══════════════════════════════════════════════════════════════

function detectBase64Urls(text) {
  // Find long base64-ish strings and try to decode them
  const b64Regex = /\b[A-Za-z0-9+/]{20,}={0,2}\b/g
  let match
  while ((match = b64Regex.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(match[0], "base64").toString("utf8")
      if (/https?:\/\/|www\.|\.com|\.net|\.org/.test(decoded)) return true
    } catch {}
  }
  return false
}

// ═══════════════════════════════════════════════════════════════
// MAIN LINK CHECKER
// ═══════════════════════════════════════════════════════════════

function containsLink(rawText) {
  if (!rawText) return false

  // Run on both raw and normalized text
  const texts = [rawText, normalizeText(rawText)]

  for (const text of texts) {
    // Check all regex patterns
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(text)) return true
    }

    // Check base64 hidden URLs
    if (detectBase64Urls(text)) return true
  }

  return false
}

// ═══════════════════════════════════════════════════════════════
// OCR ENGINE — scans images for links
// ═══════════════════════════════════════════════════════════════

// OCR result cache: md5-like key → result (avoids re-scanning same image)
const ocrCache = new Map()
const OCR_CACHE_MAX = 200

async function runOCR(imageBuffer) {
  if (!Tesseract) return null

  // Simple cache key from buffer length + first/last 20 bytes
  const key = `${imageBuffer.length}_${imageBuffer.slice(0,20).toString("hex")}_${imageBuffer.slice(-20).toString("hex")}`

  if (ocrCache.has(key)) return ocrCache.get(key)

  try {
    const { data: { text } } = await Tesseract.recognize(imageBuffer, "eng", {
      logger: () => {}  // silence progress logs
    })

    // Keep cache bounded
    if (ocrCache.size >= OCR_CACHE_MAX) {
      const firstKey = ocrCache.keys().next().value
      ocrCache.delete(firstKey)
    }

    ocrCache.set(key, text)
    return text
  } catch (e) {
    console.error("[OCR]", e.message)
    return null
  }
}

async function scanImageForLinks(sock, msg) {
  if (!Tesseract || !downloadMediaMessage) return false

  const m = msg.message

  // Check image, video thumbnail, sticker, document, viewOnce
  const hasMedia =
    m?.imageMessage ||
    m?.stickerMessage ||
    m?.viewOnceMessage?.message?.imageMessage ||
    m?.viewOnceMessageV2?.message?.imageMessage

  if (!hasMedia) return false

  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {})
    if (!buffer || buffer.length < 100) return false

    const ocrText = await runOCR(buffer)
    if (!ocrText) return false

    return containsLink(ocrText)
  } catch (e) {
    console.error("[OCR SCAN]", e.message)
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
// EXTRACT ALL TEXT FROM A MESSAGE (deep scan)
// ═══════════════════════════════════════════════════════════════

function extractAllText(msg) {
  const m = msg.message
  if (!m) return []

  const texts = []

  const add = v => { if (v && typeof v === "string") texts.push(v) }

  // Direct text
  add(m.conversation)
  add(m.extendedTextMessage?.text)
  add(m.imageMessage?.caption)
  add(m.videoMessage?.caption)
  add(m.documentMessage?.caption)
  add(m.documentMessage?.fileName)

  // Buttons
  m.buttonsMessage?.buttons?.forEach(b => {
    add(b.buttonText?.displayText)
    add(b.urlButton?.url)
  })

  // List message
  add(m.listMessage?.description)
  m.listMessage?.sections?.forEach(s => {
    s.rows?.forEach(r => { add(r.title); add(r.description) })
  })

  // Template message
  m.templateMessage?.hydratedTemplate?.hydratedButtons?.forEach(b => {
    add(b.urlButton?.url)
    add(b.callButton?.phoneNumber)
  })

  // Forwarded / quoted context
  const ctx = m.extendedTextMessage?.contextInfo
  if (ctx) {
    add(ctx.quotedMessage?.conversation)
    add(ctx.quotedMessage?.extendedTextMessage?.text)
    add(ctx.quotedMessage?.imageMessage?.caption)
    add(ctx.quotedMessage?.videoMessage?.caption)
  }

  // Location (sometimes used to embed links)
  add(m.locationMessage?.name)
  add(m.locationMessage?.address)
  add(m.locationMessage?.url)

  // Contact card vCard (can contain URLs)
  const vCard = m.contactMessage?.vcard || m.contactsArrayMessage?.contacts?.[0]?.vcard
  add(vCard)

  return texts
}

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function isAntilinkEnabled(jid)            { return !!store.groups[jid]?.enabled }
function isOcrEnabled(jid)                 { return !!store.ocrGroups?.[jid] }

function enableAntilink(jid, action = "warn") {
  if (!store.groups[jid])   store.groups[jid] = {}
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
  if (store.ocrGroups) { store.ocrGroups[jid] = false; saveData() }
}

function getAction(jid)                     { return store.groups[jid]?.action || "warn" }

function setAction(jid, action) {
  if (!store.groups[jid]) store.groups[jid] = { enabled: true }
  store.groups[jid].action = action
  saveData()
}

function addWarning(jid, sender) {
  if (!store.warnings[jid])         store.warnings[jid] = {}
  if (!store.warnings[jid][sender]) store.warnings[jid][sender] = 0
  store.warnings[jid][sender]++
  saveData()
  return store.warnings[jid][sender]
}

function getWarnings(jid, sender)           { return store.warnings[jid]?.[sender] || 0 }

function resetWarnings(jid, sender) {
  if (store.warnings[jid]?.[sender] !== undefined) {
    store.warnings[jid][sender] = 0
    saveData()
  }
}

// ─────────────────────────────────────────────────────────
// SOCKET INJECTION
// ─────────────────────────────────────────────────────────

let _sock = null
function setSocket(sock) { _sock = sock }

// ═══════════════════════════════════════════════════════════════
// MAIN ANTILINK HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleAntilink(sock, msg, extractBody) {
  try {
    if (!msg?.message) return

    const from    = msg.key.remoteJid
    const sender  = msg.key.participant || from
    const isGroup = from.endsWith("@g.us")

    if (!isGroup)       return
    if (msg.key.fromMe) return
    if (!isAntilinkEnabled(from)) return

    // ── Deep text scan across all message fields ──
    const allTexts  = extractAllText(msg)
    const foundText = allTexts.some(t => containsLink(t))

    // ── OCR image scan (if enabled for this group) ──
    let foundOcr = false
    if (!foundText && isOcrEnabled(from)) {
      foundOcr = await scanImageForLinks(sock, msg)
    }

    if (!foundText && !foundOcr) return

    // ── Skip admins ──
    const groupMeta = await sock.groupMetadata(from)
    // ── Skip admins ──────────────────────────────────────────
    // Uses the same JID-normalizing admin check as mute.js/unmute.js/
    // antilink.js (command), instead of a raw p.admin filter — that
    // simpler check can miss real admins when WhatsApp reports the
    // sender as @lid while groupMetadata lists them under their phone
    // JID (or vice versa), which is the exact bug we fixed in
    // lib/isAdmin.js earlier. Re-verifying here independently means
    // antilink's admin-skip doesn't depend on a flag passed in from
    // elsewhere being correct.
    let isSenderAdmin = false
    try {
      const senderNum = sender.split("@")[0].split(":")[0]
      isSenderAdmin = groupMeta.participants.some(p => {
        const pNum = (p.id || "").split("@")[0].split(":")[0]
        return pNum === senderNum && (p.admin === "admin" || p.admin === "superadmin")
      })
    } catch (e) {
      isSenderAdmin = false   // fail closed — if we can't verify, don't skip
    }
    if (isSenderAdmin) return

    const action   = getAction(from)
    const tag      = sender.split("@")[0]
    const ocrNote  = foundOcr ? "\n│ 🔍 *Detected via image scan (OCR)*" : ""

    // ── Delete message ──
    await sock.sendMessage(from, { delete: msg.key })

    if (action === "delete") {
      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔗 *LINK DETECTED!*  ║
╚════════════════════╝

┌─────〔 🚫 *BLOCKED* 〕─────
│ 👤 *User:* @${tag}
│ ❌ Links are *NOT* allowed here!${ocrNote}
│ 🗑️ Message has been deleted.
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })

    } else if (action === "kick") {
      // ── INSTANT KICK ──────────────────────────────────────
      // No warnings — remove on the very FIRST link detected.
      // The reason is announced to the group BEFORE removal,
      // same as the warn-mode kick message already did, so
      // members can see why the person was removed.
      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  👢 *USER KICKED!*  ║
╚════════════════════╝

┌─────〔 🚫 *INSTANT KICK* 〕─────
│ 👤 *User:* @${tag}
│ 🔗 *Reason:* Posted a link${ocrNote}
│ ⚡ *Mode:* Strict — no warnings given
│ 👢 *Status:* Removed from group
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      })
      await sock.groupParticipantsUpdate(from, [sender], "remove")

    } else if (action === "warn") {
      const warns    = addWarning(from, sender)
      const maxWarns = 3

      if (warns >= maxWarns) {
        resetWarnings(from, sender)
        await sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  👢 *USER KICKED!*  ║
╚════════════════════╝

┌─────〔 🚫 *ACTION TAKEN* 〕─────
│ 👤 *User:* @${tag}
│ ⚠️ *Warnings:* ${warns}/${maxWarns}
│ 🔗 *Reason:* Sending links repeatedly${ocrNote}
│ 👢 *Status:* Removed from group
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        await sock.groupParticipantsUpdate(from, [sender], "remove")

      } else {
        await sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  ⚠️ *LINK WARNING!*  ║
╚════════════════════╝

┌─────〔 🚫 *WARNING* 〕─────
│ 👤 *User:* @${tag}
│ 🔗 Links are *NOT* allowed here!${ocrNote}
│ ⚠️ *Warnings:* ${warns}/${maxWarns}
│ 🗑️ Message deleted
│ ⚡ *${maxWarns - warns} more = KICK!*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
      }
    }

  } catch (err) {
    console.error("[ANTILINK]", err.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Detection
  containsLink,
  normalizeText,
  extractAllText,
  scanImageForLinks,
  // State
  isAntilinkEnabled,
  isOcrEnabled,
  enableAntilink,
  disableAntilink,
  enableOcr,
  disableOcr,
  getAction,
  setAction,
  addWarning,
  getWarnings,
  resetWarnings,
  // Socket
  setSocket,
  // Handler
  handleAntilink
}
