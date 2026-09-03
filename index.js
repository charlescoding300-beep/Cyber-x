require("dotenv").config()
const fs   = require("fs")
const path = require("path")
const Pino = require("pino")
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  proto: WAProto,
  Browsers,
} = require("@whiskeysockets/baileys")

const isAdminLib    = require("./lib/isAdmin")
const settingsLib   = require("./lib/settings")
const sessionBackup = require("./lib/sessionBackup")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BOT_START  = Math.floor(Date.now() / 1000)
const CMD_DIR    = path.join(__dirname, "commands")
const LIB_DIR    = path.join(__dirname, "lib")
const UTILS_DIR  = path.join(__dirname, "utils")
const API_DIR    = path.join(__dirname, "api")
const CONFIG_DIR = path.join(__dirname, "config")
const TEMP_DIR   = path.join(__dirname, "temp")
const SESS_ROOT  = path.join(__dirname, "sessions")
const META_FILE  = path.join(SESS_ROOT, "_meta.json")
const BOT_PREFIX = process.env.BOT_PREFIX || "."

const SETTINGS_ROOT = path.join(__dirname, "data", "settings")
if (!fs.existsSync(SETTINGS_ROOT)) fs.mkdirSync(SETTINGS_ROOT, { recursive: true })

const OWNER_NUMBERS = (process.env.OWNER_NUMBER || "")
  .split(",").map(n => n.replace(/\D/g, "").trim()).filter(Boolean)

const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || "")
  .split(",").map(n => n.replace(/\D/g, "").trim()).filter(Boolean)

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, API_DIR, CONFIG_DIR, TEMP_DIR, SESS_ROOT])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// SERVER SLOTS
// ─────────────────────────────────────────────────────────────────────────────
const SLOT_COUNT    = 10
const SLOT_CAPACITY = parseInt(process.env.SLOT_CAPACITY || "50", 10)
const SLOTS_FILE    = path.join(__dirname, "data", "slots.json")

let slotAssignments = {}

function loadSlotAssignments() {
  try {
    if (fs.existsSync(SLOTS_FILE)) {
      slotAssignments = JSON.parse(fs.readFileSync(SLOTS_FILE, "utf8"))
    }
  } catch (e) {
    console.error("[SLOTS] load error:", e.message)
    slotAssignments = {}
  }
}
loadSlotAssignments()

function saveSlotAssignments() {
  try {
    fs.mkdirSync(path.dirname(SLOTS_FILE), { recursive: true })
    fs.writeFileSync(SLOTS_FILE, JSON.stringify(slotAssignments, null, 2))
  } catch (e) {
    console.error("[SLOTS] save error:", e.message)
  }
}

function getDisplaySlotCounts() {
  const counts = {}
  for (let i = 1; i <= SLOT_COUNT; i++) counts[i] = 0
  for (const phone of Object.keys(slotAssignments)) {
    const slot = slotAssignments[phone]
    if (counts[slot] !== undefined) counts[slot]++
  }
  return counts
}

function getLiveSlotCounts() {
  const counts = {}
  for (let i = 1; i <= SLOT_COUNT; i++) counts[i] = 0
  for (const phone of Object.keys(slotAssignments)) {
    const slot = slotAssignments[phone]
    if (sessions.has(phone) && counts[slot] !== undefined) counts[slot]++
  }
  return counts
}

function getNextAvailableSlot() {
  const counts = getLiveSlotCounts()
  for (let i = 1; i <= SLOT_COUNT; i++) {
    if (counts[i] < SLOT_CAPACITY) return i
  }
  return null
}

function assignToSlot(phone, preferredSlot = null) {
  if (slotAssignments[phone]) return slotAssignments[phone]
  const counts = getLiveSlotCounts()
  let slot = null
  if (preferredSlot && preferredSlot >= 1 && preferredSlot <= SLOT_COUNT && counts[preferredSlot] < SLOT_CAPACITY) {
    slot = preferredSlot
  } else {
    slot = getNextAvailableSlot()
  }
  if (slot === null) return null
  slotAssignments[phone] = slot
  saveSlotAssignments()
  return slot
}

function getSlotsSummary() {
  const result = []
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const everPaired  = Object.keys(slotAssignments).filter(p => slotAssignments[p] === i)
    const liveInSlot  = everPaired.filter(p => sessions.has(p))
    const onlineCount = liveInSlot.filter(p => sessions.get(p)?.connected).length
    result.push({
      slot:        i,
      connected:   everPaired.length,
      online:      onlineCount > 0,
      onlineCount,
      capacity:    SLOT_CAPACITY,
      full:        everPaired.length >= SLOT_CAPACITY,
    })
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO LOADER
// ─────────────────────────────────────────────────────────────────────────────
const lib    = {}
const api    = {}
const config = {}

function loadDir(dir, bucket, label) {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    try {
      const full = path.join(dir, file)
      delete require.cache[require.resolve(full)]
      const exp  = require(full)
      bucket[path.basename(file, ".js")] = exp
      if (exp && typeof exp === "object") Object.assign(bucket, exp)
      console.log(`[${label}] ✔ ${file}`)
    } catch (e) { console.error(`[${label}] ✗ ${file}: ${e.message}`) }
  }
}

function loadAllSupportDirs() {
  loadDir(LIB_DIR,    lib,    "LIB")
  loadDir(UTILS_DIR,  lib,    "UTILS")
  loadDir(API_DIR,    api,    "API")
  loadDir(CONFIG_DIR, config, "CONFIG")
}
loadAllSupportDirs()

let supportWatchStarted = false
function watchSupportDirs() {
  if (supportWatchStarted) return
  supportWatchStarted = true
  let debounce = null
  for (const [dir, label] of [[LIB_DIR, "LIB"], [UTILS_DIR, "UTILS"], [API_DIR, "API"], [CONFIG_DIR, "CONFIG"]]) {
    if (!fs.existsSync(dir)) continue
    fs.watch(dir, { persistent: false }, (_, f) => {
      if (!f?.endsWith(".js")) return
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        loadAllSupportDirs()
        console.log(`[${label}] ↺ reloaded (${f} changed)`)
      }, 150)
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMP FILE CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
function cleanupTempDir(maxAgeMs = 30 * 60 * 1000) {
  if (!fs.existsSync(TEMP_DIR)) return
  const now = Date.now()
  let cleaned = 0
  for (const file of fs.readdirSync(TEMP_DIR)) {
    const full = path.join(TEMP_DIR, file)
    try {
      const stat = fs.statSync(full)
      if (now - stat.mtimeMs > maxAgeMs) {
        if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true })
        else fs.unlinkSync(full)
        cleaned++
      }
    } catch {}
  }
  if (cleaned > 0) console.log(`[CLEANUP] 🧹 Removed ${cleaned} stale temp item(s)`)
}
cleanupTempDir()
setInterval(cleanupTempDir, 15 * 60 * 1000)

// ─────────────────────────────────────────────────────────────────────────────
// AUTO RAM DETECTION — replaces the old hardcoded MAX_RAM_MB=450.
//
// This build runs MULTIPLE WhatsApp sessions in one process, so a fixed
// 450MB ceiling makes even less sense here than on a single-session bot —
// a small 512MB box and a 32GB VPS both running this code would hit wildly
// different realities with the same hardcoded number. Instead we detect
// the box's total RAM at boot (os.totalmem()), reserve a slice for the
// OS + Node's own overhead, and use whatever's left as the process-wide
// restart threshold — the same threshold the memory guard below already
// checks against, just auto-sized instead of hardcoded.
//
// "Divide" across sessions: since SLOT_CAPACITY * SLOT_COUNT is the most
// sessions this deployment could ever hold, dividing the auto-detected
// budget by that gives a rough per-session RAM allowance — useful as a
// sizing/monitoring number even though the actual shutdown check below
// still applies to the whole process (Node doesn't sandbox memory per
// WhatsApp session, so a true per-session cap isn't enforceable — this
// number is diagnostic, to help you judge whether SLOT_CAPACITY is set
// too high for the box you're on).
//
// Override anytime with MAX_RAM_MB or MEM_RESERVE_MB in .env if you want
// to hand-tune it instead of relying on auto-detection.
// ─────────────────────────────────────────────────────────────────────────────
const os = require("os")

const TOTAL_RAM_MB = Math.round(os.totalmem() / (1024 * 1024))

const MEM_RESERVE_MB = parseInt(
  process.env.MEM_RESERVE_MB || Math.max(50, Math.round(TOTAL_RAM_MB * 0.12)),
  10
)

const AUTO_MAX_RAM_MB = Math.max(150, TOTAL_RAM_MB - MEM_RESERVE_MB)

const MAX_RAM_MB = parseInt(process.env.MAX_RAM_MB || AUTO_MAX_RAM_MB, 10)

const MAX_POSSIBLE_SESSIONS  = SLOT_COUNT * SLOT_CAPACITY
const PER_SESSION_BUDGET_MB  = Math.max(1, Math.floor(MAX_RAM_MB / MAX_POSSIBLE_SESSIONS))

console.log(
  `[RAM] Detected host RAM: ${TOTAL_RAM_MB}MB | Reserved for OS/overhead: ${MEM_RESERVE_MB}MB | ` +
  `Restart threshold: ${MAX_RAM_MB}MB${process.env.MAX_RAM_MB ? " (manual override via .env)" : " (auto-calculated)"}`
)
console.log(
  `[RAM] Divided across max possible sessions (${SLOT_COUNT} slots × ${SLOT_CAPACITY} capacity = ${MAX_POSSIBLE_SESSIONS}): ` +
  `~${PER_SESSION_BUDGET_MB}MB/session budget (diagnostic only — actual RAM use per session varies with group count/media/etc)`
)

// ── Memory guard ──────────────────────────────────────────────────────────────
setInterval(() => { if (global.gc) global.gc() }, 60_000)

let memoryShutdownInProgress = false
setInterval(async () => {
  const usedMB = process.memoryUsage().rss / 1024 / 1024

  if (usedMB > MAX_RAM_MB && !memoryShutdownInProgress) {
    memoryShutdownInProgress = true
    console.log(`[MEMORY] ⚠ RAM too high (${usedMB.toFixed(0)}MB / limit ${MAX_RAM_MB}MB) — pushing backup then exiting for clean restart`)

    try {
      await Promise.race([
        sessionBackup.pushAll(),
        new Promise(resolve => setTimeout(resolve, 8000)),
      ])
      console.log("[MEMORY] ✔ Final backup pushed before restart")
    } catch (e) {
      console.error("[MEMORY] ✗ Backup push failed before restart:", e.message)
    }

    console.log("[MEMORY] 🔄 Exiting now for clean restart")
    process.exit(1)
  }
}, 30_000)

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND REGISTRY — supports BOTH formats:
//   OLD: { pattern: 'name', alias: [...], run }
//   NEW: { name: 'name', aliases: [...], run }
// ─────────────────────────────────────────────────────────────────────────────
const registry = { map: new Map(), list: [], details: [], aliases: new Map() }

const isValidCmd = m =>
  m && (typeof m.pattern === "string" || typeof m.name === "string") && typeof m.run === "function"

const toKey = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

const CMD_RESERVED_KEYS = new Set(["run", "pattern", "name", "alias", "aliases", "desc", "usage", "category"])

function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (mod && typeof mod === "object") {
      for (const k of Object.keys(mod)) {
        if (CMD_RESERVED_KEYS.has(k)) continue
        if (k === "storeMessage" || k === "handleMessageRevocation") continue
        if (typeof mod[k] === "function") lib[k] = mod[k]
      }
    }
    if (!isValidCmd(mod)) return false

    const cmdName = mod.name || mod.pattern
    const key     = toKey(cmdName)
    registry.map.set(key, mod)

    const aliasList = mod.aliases || mod.alias || []
    if (Array.isArray(aliasList)) {
      for (const a of aliasList) registry.aliases.set(toKey(a), key)
    }
    return true
  } catch (e) { console.error(`[CMD] ✗ ${file}: ${e.message}`); return false }
}

function rebuildLists() {
  const mods = [...registry.map.values()]
  registry.list = mods.map(c => {
    const n = c.name || c.pattern
    return n.startsWith(".") ? n : `.${n}`
  }).sort()

  registry.details = mods.map(c => {
    const n = c.name || c.pattern
    return {
      pattern:  n.startsWith(".") ? n : `.${n}`,
      desc:     c.desc || "",
      usage:    c.usage || "",
      category: c.category || "general",
      alias:    c.aliases || c.alias || [],
    }
  }).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

function logCommandTable() {
  const cmds = [...registry.map.values()]
  if (!cmds.length) return
  const groups = {}
  for (const c of cmds) {
    const cat = (c.category || "GENERAL").toUpperCase()
    const n   = c.name || c.pattern
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(n.startsWith(".") ? n : `.${n}`)
  }
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║         ⚡ CYBER X — COMMAND REGISTRY        ║")
  console.log("╠══════════════════════════════════════════════╣")
  const cats = Object.keys(groups).sort()
  for (const cat of cats) {
    const cmdsInCat = groups[cat].sort()
    console.log(`║  【 ${cat} 】`)
    for (let i = 0; i < cmdsInCat.length; i += 3) {
      const row = cmdsInCat.slice(i, i + 3).map(c => c.padEnd(18)).join(" ")
      console.log(`║    ${row}`)
    }
  }
  console.log("╠══════════════════════════════════════════════╣")
  console.log(`║  Total: ${cmds.length} commands across ${cats.length} categories`.padEnd(47) + "║")
  console.log("╚══════════════════════════════════════════════╝\n")
}

async function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  const startedAt = Date.now()
  registry.map.clear(); registry.aliases.clear()
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()
  let ok = 0, fail = 0
  for (const f of files) { if (loadFile(f)) ok++; else fail++ }
  rebuildLists()
  global.__commandCount = ok
  console.log(`[CMD] ⚡ ${ok} loaded | ${fail} skipped | ${Date.now() - startedAt}ms`)
  console.log(`[ANTIBOT-CHECK] lib.handleAntibot is: ${typeof lib.handleAntibot}`)
  logCommandTable()
}

let watchStarted = false
function watchCommands() {
  if (watchStarted || !fs.existsSync(CMD_DIR)) return
  watchStarted = true
  let debounce = null
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      loadFile(f); rebuildLists(); logCommandTable()
      console.log(`[CMD] ↺ ${f}`)
    }, 100)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// JID NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────
function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE PICTURE — retry-safe wrapper.
// ─────────────────────────────────────────────────────────────────────────────
async function getProfilePictureSafe(sock, jid, opts = {}) {
  const retries = opts.retries ?? 2
  const delayMs = opts.delayMs ?? 800
  const type    = opts.type || "image"

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = await sock.profilePictureUrl(jid, type)
      if (url) return url
    } catch (e) {
      if (attempt === retries) {
        console.warn(`[PP] Failed to fetch profile picture for ${jid} after ${retries + 1} attempt(s): ${e.message}`)
        return null
      }
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER / ADMIN RECOGNITION
// ─────────────────────────────────────────────────────────────────────────────
function checkIsOwner(state, sender, senderAlt, fromMe) {
  if (fromMe === true) return true
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)
  const sessionPhone = normalizeNum(state.phone)
  if (sessionPhone && candidates.some(n => n === sessionPhone)) return true
  if (OWNER_NUMBERS.length && candidates.some(n => OWNER_NUMBERS.includes(n))) return true
  if ([sender, senderAlt].filter(Boolean).some(j => {
    try { return isAdminLib.isOwner(j) } catch { return false }
  })) return true
  try {
    const dynamicOwners = settingsLib.get?.("owners") || []
    if (Array.isArray(dynamicOwners) && candidates.some(n => dynamicOwners.map(normalizeNum).includes(n)))
      return true
  } catch {}
  return false
}

async function checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner) {
  if (isOwner) return { isAdmin: true, isBotAdmin: true }
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)
  let meta = state.groupCache[from]
  if (!meta || (Date.now() - (meta._cachedAt || 0)) > 5 * 60 * 1000) {
    try { meta = await sock.groupMetadata(from); state.groupCache[from] = { ...meta, _cachedAt: Date.now() } } catch {}
  }
  let isBotAdmin = false
  try { isBotAdmin = isAdminLib.isBotAdmin(state.groupCache, from, sock) } catch {}
  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n)))
    return { isAdmin: true, isBotAdmin }
  let isAdmin = false
  try { isAdmin = isAdminLib.isAdmin(state.groupCache, from, sender, sock, null, senderAlt) } catch {}
  if (!isAdmin && meta?.participants) {
    const adminSet = new Set(
      meta.participants.filter(p => p.admin === "admin" || p.admin === "superadmin").map(p => normalizeNum(p.id))
    )
    isAdmin = candidates.some(n => adminSet.has(n))
  }
  return { isAdmin, isBotAdmin }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function extractBody(msg) {
  const m = msg?.message
  if (!m) return ""
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.documentMessage?.caption ||
    inner.buttonsResponseMessage?.selectedButtonId ||
    inner.listResponseMessage?.singleSelectReply?.selectedRowId ||
    inner.templateButtonReplyMessage?.selectedId ||
    ""
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST, RESILIENT HTTP LAYER — used for every outbound "get something from
// the internet" call (image gen, AI, downloads, etc). Retries with
// exponential backoff + jitter, hard timeout via AbortController, and a
// single shared keep-alive agent so repeated calls don't pay a fresh
// TCP/TLS handshake every time.
// ─────────────────────────────────────────────────────────────────────────────
const http  = require("http")
const https = require("https")
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 })

function pickAgent(url) {
  try { return new URL(url).protocol === "http:" ? httpAgent : httpsAgent } catch { return httpsAgent }
}

async function fetchWithRetry(url, opts = {}) {
  const {
    retries    = 3,
    timeoutMs  = 15000,
    backoffMs  = 500,
    maxBackoff = 6000,
    ...fetchOpts
  } = opts

  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        agent: pickAgent(url),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok && res.status >= 500 && attempt < retries) {
        throw new Error(`HTTP ${res.status}`)
      }
      return res
    } catch (e) {
      clearTimeout(timer)
      lastErr = e
      if (attempt === retries) break
      const jitter = Math.random() * 200
      const delay  = Math.min(backoffMs * Math.pow(2, attempt), maxBackoff) + jitter
      console.warn(`[NET] ⚠ ${url.split("?")[0]} attempt ${attempt + 1}/${retries + 1} failed (${e.message}) — retrying in ${Math.round(delay)}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

async function fetchJsonSafe(url, opts = {}) {
  const res = await fetchWithRetry(url, opts)
  return res.json()
}

async function fetchBufferSafe(url, opts = {}) {
  const res = await fetchWithRetry(url, opts)
  const ab  = await res.arrayBuffer()
  return Buffer.from(ab)
}

async function downloadMediaSafe(msg, sock, retries = 2) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      return await downloadMediaMessage(msg, "buffer", {}, { logger: Pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage })
    } catch (e) {
      lastErr = e
      if (i < retries) await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
  console.error("[NET] media download failed after retries:", lastErr?.message)
  return null
}

const helper = {
  async reply(sock, msg, text)  { return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg }) },
  async send(sock, jid, text)   { return sock.sendMessage(jid, { text }) },
  async react(sock, msg, emoji) { return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }) },
  async sendImage(sock, jid, url, caption = "")  { return sock.sendMessage(jid, { image: { url }, caption }) },
  async sendVideo(sock, jid, url, caption = "")  { return sock.sendMessage(jid, { video: { url }, caption }) },
  async sendGif(sock, jid, url, caption = "")    { return sock.sendMessage(jid, { video: { url }, gifPlayback: true, caption }) },
  async sendAudio(sock, jid, buf, ptt = false)   { return sock.sendMessage(jid, { audio: buf, ptt, mimetype: "audio/mpeg" }) },
  async sendDoc(sock, jid, buf, filename, mimetype = "application/octet-stream") {
    return sock.sendMessage(jid, { document: buf, fileName: filename, mimetype })
  },
  getProfilePictureSafe: (sock, jid, opts) => getProfilePictureSafe(sock, jid, opts),
  fetchWithRetry,
  fetchJson:   fetchJsonSafe,
  fetchBuffer: fetchBufferSafe,
  downloadMediaSafe: (msg, sock, retries) => downloadMediaSafe(msg, sock, retries),
  box(title, lines = []) {
    const body = lines.map(l => `║  ${l}`).join("\n")
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n${body}\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝖤𝕽 𝖃 ™`
  },
  msToTime(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s` },
  sleep(ms)    { return new Promise(r => setTimeout(r, ms)) },
}

api.fetch       = fetchWithRetry
api.fetchJson   = fetchJsonSafe
api.fetchBuffer = fetchBufferSafe

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────
const sessions = new Map()

function makeSessionSettings(phone) {
  return settingsLib.forUser(phone)
}

function makeSessionState(phone) {
  const sessDir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })
  return {
    phone, sessDir,
    settings:      makeSessionSettings(phone),
    groupCache:    {},
    retries:       0,
    sock:                 null,
    connected:            false,
    pairingCode:          null,
    pairingCodeExpiresAt: null,
    presenceTimer:        null,
  }
}

function nowWAT() {
  return new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })
}

const PAIRING_CODE_TTL_MS = 60 * 1000

function getValidPairingCode(state) {
  if (!state.pairingCode) return null
  if (!state.pairingCodeExpiresAt || Date.now() > state.pairingCodeExpiresAt) {
    console.log(`[${state.phone}] ⌛ Pairing code expired (60s) at ${nowWAT()} WAT`)
    state.pairingCode = null
    state.pairingCodeExpiresAt = null
    return null
  }
  return state.pairingCode
}

function saveMeta() {
  try {
    const meta = [...sessions.keys()]
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  } catch (e) { console.error("[META] save error:", e.message) }
}

function loadMetaPhones() {
  try {
    if (fs.existsSync(META_FILE)) return JSON.parse(fs.readFileSync(META_FILE, "utf8"))
  } catch {}
  return []
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDINARY MESSAGE SIDE EFFECTS
// ─────────────────────────────────────────────────────────────────────────────
async function handleOrdinaryMessage(state, sock, msg, from) {
  const s = state.settings
  if (s.get("autoTyping")) {
    try { await sock.sendPresenceUpdate("composing", from); await helper.sleep(10000); await sock.sendPresenceUpdate("paused", from) } catch {}
  }
  if (s.get("autoRecording")) {
    try { await sock.sendPresenceUpdate("recording", from); await helper.sleep(7000); await sock.sendPresenceUpdate("paused", from) } catch {}
  }
  if (s.get("autoReply")) {
    const prefix = s.get("prefix") || BOT_PREFIX
    const text = (s.get("autoReplyText") || "").replace(/\{prefix\}/g, prefix)
    if (text) { try { await sock.sendMessage(from, { text }, { quoted: msg }) } catch {} }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS AUTO-VIEW / AUTO-REACT — hardened queue + retry.
// ─────────────────────────────────────────────────────────────────────────────
const statusQueues = new Map()

function queueStatusJob(phone, job) {
  const prev = statusQueues.get(phone) || Promise.resolve()
  const next = prev.then(job).catch(e => console.error(`[STATUS:${phone}] queue error:`, e.message))
  statusQueues.set(phone, next)
  return next
}

async function withRetry(fn, retries = 2, delayMs = 700) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try { return await fn() }
    catch (e) {
      lastErr = e
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastErr
}

async function handleStatus(state, sock, msg) {
  if (msg.key.fromMe) return
  const s = state.settings
  const wantsView  = !!s.get("autoViewStatus")
  const wantsReact = !!s.get("autoReactStatus")
  if (!wantsView && !wantsReact) return

  queueStatusJob(state.phone, async () => {
    if (wantsView) {
      try {
        await withRetry(() => sock.readMessages([msg.key]), 2, 600)
      } catch (e) {
        console.error(`[${state.phone}] STATUS VIEW ✗ gave up after retries (${msg.key.participant || "?"}):`, e.message)
      }
    }

    if (wantsReact) {
      const emoji   = s.get("statusReactEmoji") || "🙃"
      const jidList = [...new Set([msg.key.participant, sock.user?.id].filter(Boolean))]
      try {
        await withRetry(() => sock.sendMessage("status@broadcast", {
          react: { text: emoji, key: msg.key }
        }, { statusJidList: jidList }), 2, 800)
      } catch (e) {
        console.error(`[${state.phone}] STATUS REACT ✗ gave up after retries (${msg.key.participant || "?"}):`, e.message)
      }
    }

    await new Promise(r => setTimeout(r, 300))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTIDELETE
// ─────────────────────────────────────────────────────────────────────────────
const ANTIDELETE_MAX_ENTRIES = 500
const ANTIDELETE_MAX_AGE_MS  = 15 * 60 * 1000

const antideleteCache = new Map()
const antideleteOrder  = []

function antideleteEvictIfNeeded() {
  while (antideleteOrder.length > ANTIDELETE_MAX_ENTRIES) {
    const oldestId = antideleteOrder.shift()
    antideleteCache.delete(oldestId)
  }
}

function antideleteSweepExpired() {
  const now = Date.now()
  let removed = 0
  for (const id of [...antideleteOrder]) {
    const entry = antideleteCache.get(id)
    if (!entry || now - entry.cachedAt > ANTIDELETE_MAX_AGE_MS) {
      antideleteCache.delete(id)
      const idx = antideleteOrder.indexOf(id)
      if (idx !== -1) antideleteOrder.splice(idx, 1)
      removed++
    }
  }
  if (removed > 0) console.log(`[ANTIDELETE] 🧹 expired ${removed} cached message(s)`)
}
setInterval(antideleteSweepExpired, 5 * 60 * 1000)

function antideleteGetEnabled(phone) {
  try {
    if (typeof lib.userDb?.getSection === "function") {
      const section = lib.userDb.getSection(phone, "antidelete")
      return !!section?.enabled
    }
  } catch {}
  return false
}

function antideleteSetEnabled(phone, enabled) {
  try {
    if (typeof lib.userDb?.setSection === "function") {
      lib.userDb.setSection(phone, "antidelete", { enabled })
    }
  } catch (e) {
    console.error("[ANTIDELETE] setEnabled error:", e.message)
  }
}

async function antideleteDownloadSafe(msg, sock) {
  return downloadMediaSafe(msg, sock, 2)
}

async function storeMessage(sock, msg) {
  if (!msg?.message || !msg.key?.id) return
  if (msg.key.fromMe) return
  const m = msg.message
  if (m.protocolMessage) return
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m
  const jid       = msg.key.remoteJid
  const sender    = msg.key.participant || jid
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)
  let type = "text", text = "", mediaBuffer = null, mimetype = null, caption = "", ptt = false, gifPlayback = false
  try {
    if (inner.conversation) {
      type = "text"; text = inner.conversation
    } else if (inner.extendedTextMessage?.text) {
      type = "text"; text = inner.extendedTextMessage.text
    } else if (inner.imageMessage) {
      type = "image"; caption = inner.imageMessage.caption || ""; mimetype = inner.imageMessage.mimetype || "image/jpeg"
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else if (inner.videoMessage) {
      gifPlayback = !!inner.videoMessage.gifPlayback; type = gifPlayback ? "gif" : "video"
      caption = inner.videoMessage.caption || ""; mimetype = inner.videoMessage.mimetype || "video/mp4"
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else if (inner.stickerMessage) {
      type = "sticker"; mimetype = inner.stickerMessage.mimetype || "image/webp"
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else if (inner.audioMessage) {
      ptt = !!inner.audioMessage.ptt; type = ptt ? "voice" : "audio"
      mimetype = inner.audioMessage.mimetype || "audio/ogg"
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else { type = "other" }
  } catch (e) { console.error("[ANTIDELETE] storeMessage error:", e.message) }
  antideleteCache.set(msg.key.id, {
    jid, sender, senderAlt, timestamp, type, text, caption,
    mediaBuffer, mimetype, ptt, gifPlayback, cachedAt: Date.now(),
  })
  antideleteOrder.push(msg.key.id)
  antideleteEvictIfNeeded()
}

function antideleteIsRevoke(proto) {
  if (!proto) return false
  if (proto.type === "REVOKE") return true
  try {
    const REVOKE_VALUE = WAProto?.Message?.ProtocolMessage?.Type?.REVOKE
    if (REVOKE_VALUE !== undefined && proto.type === REVOKE_VALUE) return true
  } catch {}
  if (proto.key?.id && proto.editedMessage === undefined && proto.type === undefined) return true
  return false
}

async function antideleteReport(sock, phone, proto, deleterKey) {
  if (!antideleteGetEnabled(phone)) return
  const deletedId = proto.key?.id
  if (!deletedId) return
  const cached = antideleteCache.get(deletedId)
  if (!cached) return
  const deleterJid = deleterKey.participant || deleterKey.remoteJid
  const deleterNum = (deleterJid || "").split("@")[0]
  const chatJid    = deleterKey.remoteJid
  const isGroup    = chatJid.endsWith("@g.us")
  let chatLabel = "a private DM"
  if (isGroup) {
    try {
      const meta = await sock.groupMetadata(chatJid)
      chatLabel = `${meta.subject || chatJid} (group)`
    } catch { chatLabel = `${chatJid} (group)` }
  }
  const ownerJid   = `${phone}@s.whatsapp.net`
  const when       = new Date(cached.timestamp * 1000).toLocaleString()
  const headerText = `🗑️ *Antidelete*\n\n*Deleted by:* @${deleterNum}\n*Where:* ${chatLabel}\n*When sent:* ${when}`
  try {
    if (cached.type === "text") {
      await sock.sendMessage(ownerJid, { text: `${headerText}\n\n*Message:*\n${cached.text || "(empty)"}`, mentions: [deleterJid] })
    } else if (cached.mediaBuffer && cached.type === "image") {
      await sock.sendMessage(ownerJid, { image: cached.mediaBuffer, caption: `${headerText}${cached.caption ? `\n\n*Caption:*\n${cached.caption}` : ""}`, mentions: [deleterJid] })
    } else if (cached.mediaBuffer && (cached.type === "video" || cached.type === "gif")) {
      await sock.sendMessage(ownerJid, { video: cached.mediaBuffer, gifPlayback: cached.gifPlayback, caption: `${headerText}${cached.caption ? `\n\n*Caption:*\n${cached.caption}` : ""}`, mentions: [deleterJid] })
    } else if (cached.mediaBuffer && cached.type === "sticker") {
      await sock.sendMessage(ownerJid, { sticker: cached.mediaBuffer })
      await sock.sendMessage(ownerJid, { text: headerText, mentions: [deleterJid] })
    } else if (cached.mediaBuffer && (cached.type === "voice" || cached.type === "audio")) {
      await sock.sendMessage(ownerJid, { audio: cached.mediaBuffer, ptt: cached.ptt, mimetype: cached.mimetype || "audio/ogg" })
      await sock.sendMessage(ownerJid, { text: headerText, mentions: [deleterJid] })
    } else {
      await sock.sendMessage(ownerJid, { text: `${headerText}\n\n_Content type: ${cached.type} — could not recover media content._`, mentions: [deleterJid] })
    }
  } catch (e) { console.error("[ANTIDELETE] failed to report deletion to owner:", e.message) }
  antideleteCache.delete(deletedId)
  const idx = antideleteOrder.indexOf(deletedId)
  if (idx !== -1) antideleteOrder.splice(idx, 1)
}

async function handleMessageRevocation(sock, phone, payload, source) {
  if (source === "upsert") {
    const msg = payload
    const proto = msg?.message?.protocolMessage
    if (!antideleteIsRevoke(proto)) return
    await antideleteReport(sock, phone, proto, msg.key)
  } else if (source === "update") {
    const updates = payload
    for (const u of updates) {
      const proto = u.update?.message?.protocolMessage || u.update?.protocolMessage
      if (!antideleteIsRevoke(proto)) continue
      await antideleteReport(sock, phone, proto, u.key)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTILINK
// ─────────────────────────────────────────────────────────────────────────────
const ANTILINK_DIR = path.join(__dirname, "data", "antilink")
if (!fs.existsSync(ANTILINK_DIR)) fs.mkdirSync(ANTILINK_DIR, { recursive: true })

function antilinkSafePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function antilinkFilePath(phone) {
  return path.join(ANTILINK_DIR, `${antilinkSafePhone(phone)}.json`)
}
function antilinkLoad(phone) {
  const file = antilinkFilePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTILINK] load error for ${phone}:`, e.message)
  }
  return { groups: {}, warnings: {} }
}
function antilinkSave(phone, data) {
  try {
    fs.writeFileSync(antilinkFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTILINK] save error for ${phone}:`, e.message)
  }
}

const ANTILINK_HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

// Fullwidth Unicode block (Ａ-Ｚ ａ-ｚ ０-９ ．etc.) → ASCII. Fullwidth forms
// sit at a fixed offset (0xFEE0) above their ASCII twin.
function antilinkDefullwidth(str) {
  return str.replace(/[\uFF01-\uFF5E]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  ).replace(/\u3000/g, " ")
}

// Common homoglyphs used to spoof domains — Cyrillic/Greek letters that
// render visually identical to Latin ones.
const ANTILINK_CONFUSABLES = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y",
  "і": "i", "ѕ": "s", "һ": "h", "ԁ": "d", "ⅰ": "i", "ⅼ": "l",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K",
  "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  "α": "a", "ο": "o", "ρ": "p", "ι": "i", "υ": "u", "ν": "v",
}
function antilinkDeconfuse(str) {
  return str.replace(/[\u0370-\u03FF\u0400-\u04FF]/g, ch => ANTILINK_CONFUSABLES[ch] || ch)
}

// Unicode "dot" lookalikes: 。．․‧
const ANTILINK_DOT_LOOKALIKES = /[\u3002\uFF0E\u2024\u2027]/g

function antilinkNormalize(text) {
  if (!text) return ""
  let t = text.replace(ANTILINK_HIDDEN_CHARS, "")
  t = antilinkDefullwidth(t)
  t = antilinkDeconfuse(t)
  t = t.replace(ANTILINK_DOT_LOOKALIKES, ".")
  t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, ".")
       .replace(/\s+dot\s+/gi, ".")
  t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ""))
  t = t.replace(/[.]{2,}/g, ".").replace(/\s{2,}/g, " ")
  return t
}

// Full official IANA TLD list (1,287 entries) — data.iana.org/TLD
const IANA_TLDS = [
  'aaa','aarp','abb','abbott','abbvie','abc','able','abogado','abudhabi','ac','academy','accenture',
  'accountant','accountants','aco','actor','ad','ads','adult','ae','aeg','aero','aetna','af','afl',
  'africa','ag','agakhan','agency','ai','aig','airbus','airforce','airtel','akdn','al','alibaba',
  'alipay','allfinanz','allstate','ally','alsace','alstom','am','amazon','americanexpress',
  'americanfamily','amex','amfam','amica','amsterdam','analytics','android','anquan','anz','ao','aol',
  'apartments','app','apple','aq','aquarelle','ar','arab','aramco','archi','army','arpa','art','arte',
  'as','asda','asia','associates','at','athleta','attorney','au','auction','audi','audible','audio',
  'auspost','author','auto','autos','aw','aws','ax','axa','az','azure','ba','baby','baidu','banamex',
  'band','bank','bar','barcelona','barclaycard','barclays','barefoot','bargains','baseball',
  'basketball','bauhaus','bayern','bb','bbc','bbt','bbva','bcg','bcn','bd','be','beats','beauty',
  'beer','berlin','best','bestbuy','bet','bf','bg','bh','bharti','bi','bible','bid','bike','bing',
  'bingo','bio','biz','bj','black','blackfriday','blockbuster','blog','bloomberg','blue','bm','bms',
  'bmw','bn','bnpparibas','bo','boats','boehringer','bofa','bom','bond','boo','book','booking','bosch',
  'bostik','boston','bot','boutique','box','br','bradesco','bridgestone','broadway','broker','brother',
  'brussels','bs','bt','build','builders','business','buy','buzz','bv','bw','by','bz','bzh','ca','cab',
  'cafe','cal','call','calvinklein','cam','camera','camp','canon','capetown','capital','capitalone',
  'car','caravan','cards','care','career','careers','cars','casa','case','cash','casino','cat',
  'catering','catholic','cba','cbn','cbre','cc','cd','center','ceo','cern','cf','cfa','cfd','cg','ch',
  'chanel','channel','charity','chase','chat','cheap','chintai','christmas','chrome','church','ci',
  'cipriani','circle','cisco','citadel','citi','citic','city','ck','cl','claims','cleaning','click',
  'clinic','clinique','clothing','cloud','club','clubmed','cm','cn','co','coach','codes','coffee',
  'college','cologne','com','commbank','community','company','compare','computer','comsec','condos',
  'construction','consulting','contact','contractors','cooking','cool','coop','corsica','country',
  'coupon','coupons','courses','cpa','cr','credit','creditcard','creditunion','cricket','crown','crs',
  'cruise','cruises','cu','cuisinella','cv','cw','cx','cy','cymru','cyou','cz','dad','dance','data',
  'date','dating','datsun','day','dclk','dds','de','deal','dealer','deals','degree','delivery','dell',
  'deloitte','delta','democrat','dental','dentist','desi','design','dev','dhl','diamonds','diet',
  'digital','direct','directory','discount','discover','dish','diy','dj','dk','dm','dnp','do','docs',
  'doctor','dog','domains','dot','download','drive','dtv','dubai','dupont','durban','dvag','dvr','dz',
  'earth','eat','ec','eco','edeka','edu','education','ee','eg','email','emerck','energy','engineer',
  'engineering','enterprises','epson','equipment','er','ericsson','erni','es','esq','estate','et','eu',
  'eurovision','eus','events','exchange','expert','exposed','express','extraspace','fage','fail',
  'fairwinds','faith','family','fan','fans','farm','farmers','fashion','fast','fedex','feedback',
  'ferrari','ferrero','fi','fidelity','fido','film','final','finance','financial','fire','firestone',
  'firmdale','fish','fishing','fit','fitness','fj','fk','flickr','flights','flir','florist','flowers',
  'fly','fm','fo','foo','food','football','ford','forex','forsale','forum','foundation','fox','fr',
  'free','fresenius','frl','frogans','frontier','ftr','fujitsu','fun','fund','furniture','futbol',
  'fyi','ga','gal','gallery','gallo','gallup','game','games','gap','garden','gay','gb','gbiz','gd',
  'gdn','ge','gea','gent','genting','george','gf','gg','ggee','gh','gi','gift','gifts','gives',
  'giving','gl','glass','gle','global','globo','gm','gmail','gmbh','gmo','gmx','gn','godaddy','gold',
  'goldpoint','golf','goodyear','goog','google','gop','got','gov','gp','gq','gr','grainger','graphics',
  'gratis','green','gripe','grocery','group','gs','gt','gu','gucci','guge','guide','guitars','guru',
  'gw','gy','hair','hamburg','hangout','haus','hbo','hdfc','hdfcbank','health','healthcare','help',
  'helsinki','here','hermes','hiphop','hisamitsu','hitachi','hiv','hk','hkt','hm','hn','hockey',
  'holdings','holiday','homedepot','homegoods','homes','homesense','honda','horse','hospital','host',
  'hosting','hot','hotels','hotmail','house','how','hr','hsbc','ht','hu','hughes','hyatt','hyundai',
  'ibm','icbc','ice','icu','id','ie','ieee','ifm','ikano','il','im','imamat','imdb','immo',
  'immobilien','in','inc','industries','infiniti','info','ing','ink','institute','insurance','insure',
  'int','international','intuit','investments','io','ipiranga','iq','ir','irish','is','ismaili','ist',
  'istanbul','it','itau','itv','jaguar','java','jcb','je','jeep','jetzt','jewelry','jio','jll','jm',
  'jmp','jnj','jo','jobs','joburg','jot','joy','jp','jpmorgan','jprs','juegos','juniper','kaufen',
  'kddi','ke','kerryhotels','kerryproperties','kfh','kg','kh','ki','kia','kids','kim','kindle',
  'kitchen','kiwi','km','kn','koeln','komatsu','kosher','kp','kpmg','kpn','kr','krd','kred',
  'kuokgroup','kw','ky','kyoto','kz','la','lacaixa','lamborghini','lamer','land','landrover','lanxess',
  'lasalle','lat','latino','latrobe','law','lawyer','lb','lc','lds','lease','leclerc','lefrak','legal',
  'lego','lexus','lgbt','li','lidl','life','lifeinsurance','lifestyle','lighting','like','lilly',
  'limited','limo','lincoln','link','live','living','lk','llc','llp','loan','loans','locker','locus',
  'lol','london','lotte','lotto','love','lpl','lplfinancial','lr','ls','lt','ltd','ltda','lu',
  'lundbeck','luxe','luxury','lv','ly','ma','madrid','maif','maison','makeup','man','management',
  'mango','map','market','marketing','markets','marriott','marshalls','mattel','mba','mc','mckinsey',
  'md','me','med','media','meet','melbourne','meme','memorial','men','menu','merck','merckmsd','mg',
  'mh','miami','microsoft','mil','mini','mint','mit','mitsubishi','mk','ml','mlb','mls','mm','mma',
  'mn','mo','mobi','mobile','moda','moe','moi','mom','monash','money','monster','mormon','mortgage',
  'moscow','moto','motorcycles','mov','movie','mp','mq','mr','ms','msd','mt','mtn','mtr','mu','museum',
  'music','mv','mw','mx','my','mz','na','nab','nagoya','name','navy','nba','nc','ne','nec','net',
  'netbank','netflix','network','neustar','new','news','next','nextdirect','nexus','nf','nfl','ng',
  'ngo','nhk','ni','nico','nike','nikon','ninja','nissan','nissay','nl','no','nokia','norton','now',
  'nowruz','nowtv','np','nr','nra','nrw','ntt','nu','nyc','nz','obi','observer','office','okinawa',
  'olayan','olayangroup','ollo','om','omega','one','ong','onl','online','ooo','open','oracle','orange',
  'org','organic','origins','osaka','otsuka','ott','ovh','pa','page','panasonic','paris','pars',
  'partners','parts','party','pay','pccw','pe','pet','pf','pfizer','pg','ph','pharmacy','phd',
  'philips','phone','photo','photography','photos','physio','pics','pictet','pictures','pid','pin',
  'ping','pink','pioneer','pizza','pk','pl','place','play','playstation','plumbing','plus','pm','pn',
  'pnc','pohl','poker','politie','porn','post','pr','praxi','press','prime','pro','prod','productions',
  'prof','progressive','promo','properties','property','protection','pru','prudential','ps','pt','pub',
  'pw','pwc','py','qa','qpon','quebec','quest','racing','radio','re','read','realestate','realtor',
  'realty','recipes','red','redumbrella','rehab','reise','reisen','reit','reliance','ren','rent',
  'rentals','repair','report','republican','rest','restaurant','review','reviews','rexroth','rich',
  'richardli','ricoh','ril','rio','rip','ro','rocks','rodeo','rogers','room','rs','rsvp','ru','rugby',
  'ruhr','run','rw','rwe','ryukyu','sa','saarland','safe','safety','sakura','sale','salon','samsclub',
  'samsung','sandvik','sandvikcoromant','sanofi','sap','sarl','sas','save','saxo','sb','sbi','sbs',
  'sc','scb','schaeffler','schmidt','scholarships','school','schule','schwarz','science','scot','sd',
  'se','search','seat','secure','security','seek','select','sener','services','seven','sew','sex',
  'sexy','sfr','sg','sh','shangrila','sharp','shell','shia','shiksha','shoes','shop','shopping',
  'shouji','show','si','silk','sina','singles','site','sj','sk','ski','skin','sky','skype','sl',
  'sling','sm','smart','smile','sn','sncf','so','soccer','social','softbank','software','sohu','solar',
  'solutions','song','sony','soy','spa','space','sport','spot','sr','srl','ss','st','stada','staples',
  'star','statebank','statefarm','stc','stcgroup','stockholm','storage','store','stream','studio',
  'study','style','su','sucks','supplies','supply','support','surf','surgery','suzuki','sv','swatch',
  'swiss','sx','sy','sydney','systems','sz','tab','taipei','talk','taobao','target','tatamotors',
  'tatar','tattoo','tax','taxi','tc','tci','td','tdk','team','tech','technology','tel','temasek',
  'tennis','teva','tf','tg','th','thd','theater','theatre','tiaa','tickets','tienda','tips','tires',
  'tirol','tj','tjmaxx','tjx','tk','tkmaxx','tl','tm','tmall','tn','to','today','tokyo','tools','top',
  'toray','toshiba','total','tours','town','toyota','toys','tr','trade','trading','training','travel',
  'travelers','travelersinsurance','trust','trv','tt','tube','tui','tunes','tushu','tv','tvs','tw',
  'tz','ua','ubank','ubs','ug','uk','unicom','university','uno','uol','ups','us','uy','uz','va',
  'vacations','vana','vanguard','vc','ve','vegas','ventures','verisign','versicherung','vet','vg','vi',
  'viajes','video','vig','viking','villas','vin','vip','virgin','visa','vision','viva','vivo',
  'vlaanderen','vn','vodka','volvo','vote','voting','voto','voyage','vu','wales','walmart','walter',
  'wang','wanggou','watch','watches','weather','weatherchannel','web','webcam','weber','website','wed',
  'wedding','weibo','weir','wf','whoswho','wien','wiki','williamhill','win','windows','wine','winners',
  'wme','woodside','work','works','world','wow','ws','wtc','wtf','xbox','xerox','xihuan','xin','xxx',
  'xyz','yachts','yahoo','yamaxun','yandex','ye','yodobashi','yoga','yokohama','you','youtube','yt',
  'yun','za','zappos','zara','zero','zip','zm','zone','zuerich','zw'
]

const ANTILINK_TLD_GROUP = IANA_TLDS.join("|")

const ANTILINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /discord(?:\.gg|\.com\/invite)\/[^\s]{2,}/gi,
  /wa\.me\/[^\s]{2,}/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  new RegExp(`\\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\\.(?:${ANTILINK_TLD_GROUP})\\b(?:\\/[^\\s]*)?`, "gi"),
  // bare IPv4 used as a link host
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:\/[^\s]*)?/g,
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

let AntilinkTesseract = null
try { AntilinkTesseract = require("tesseract.js") } catch {}
const ANTILINK_OCR_AVAILABLE = !!AntilinkTesseract

async function antilinkScanImage(msg) {
  if (!ANTILINK_OCR_AVAILABLE) return false
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

function antilinkIsEnabled(phone, groupId) {
  return !!antilinkLoad(phone).groups[groupId]?.enabled
}
function antilinkEnable(phone, groupId, action = "warn") {
  const data = antilinkLoad(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  data.groups[groupId].action = action
  antilinkSave(phone, data)
}
function antilinkDisable(phone, groupId) {
  const data = antilinkLoad(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; antilinkSave(phone, data) }
}
function antilinkGetAction(phone, groupId) {
  return antilinkLoad(phone).groups[groupId]?.action || "warn"
}
function antilinkAddWarning(phone, groupId, sender) {
  const data = antilinkLoad(phone)
  if (!data.warnings[groupId]) data.warnings[groupId] = {}
  if (!data.warnings[groupId][sender]) data.warnings[groupId][sender] = 0
  data.warnings[groupId][sender]++
  antilinkSave(phone, data)
  return data.warnings[groupId][sender]
}
function antilinkResetWarnings(phone, groupId, sender) {
  const data = antilinkLoad(phone)
  if (data.warnings[groupId]?.[sender] !== undefined) {
    data.warnings[groupId][sender] = 0
    antilinkSave(phone, data)
  }
}

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
    if (!foundText) { msg._sockRef = sock; foundOcr = await antilinkScanImage(msg) }
    if (!foundText && !foundOcr) return

    let groupMeta
    try { groupMeta = await sock.groupMetadata(groupId) } catch (e) {
      console.error("[ANTILINK] metadata fetch failed:", e.message)
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
      console.log(`[ANTILINK:${phone}] link from ${senderNorm} in ${groupId} but bot isn't admin — skipping`)
      return
    }

    const action = antilinkGetAction(phone, groupId)
    const tag = senderNorm
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
      try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
      catch (e) { console.error("[ANTILINK] kick failed:", e.message) }
    } else if (action === "warn") {
      const warns = antilinkAddWarning(phone, groupId, sender)
      const maxWarns = 3
      if (warns >= maxWarns) {
        antilinkResetWarnings(phone, groupId, sender)
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ACTION TAKEN* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🔗 *Reason:* Sending links repeatedly${ocrNote}\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        })
        try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
        catch (e) { console.error("[ANTILINK] warn-kick failed:", e.message) }
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

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM COMMANDS
// ─────────────────────────────────────────────────────────────────────────────
const CUSTOMCMD_DIR = path.join(__dirname, "data", "customcmds")
if (!fs.existsSync(CUSTOMCMD_DIR)) fs.mkdirSync(CUSTOMCMD_DIR, { recursive: true })

function customCmdSafePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function customCmdFilePath(phone) {
  return path.join(CUSTOMCMD_DIR, `${customCmdSafePhone(phone)}.json`)
}
function customCmdLoad(phone) {
  const file = customCmdFilePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[CUSTOMCMD] load error for ${phone}:`, e.message)
  }
  return {}
}
function customCmdSave(phone, data) {
  try {
    fs.writeFileSync(customCmdFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[CUSTOMCMD] save error for ${phone}:`, e.message)
  }
}
function customCmdAdd(phone, trigger, response) {
  const data = customCmdLoad(phone)
  data[trigger.toLowerCase().trim()] = response
  customCmdSave(phone, data)
}
function customCmdRemove(phone, trigger) {
  const data = customCmdLoad(phone)
  const key = trigger.toLowerCase().trim()
  if (data[key] === undefined) return false
  delete data[key]
  customCmdSave(phone, data)
  return true
}
function customCmdGet(phone, trigger) {
  const data = customCmdLoad(phone)
  return data[trigger.toLowerCase().trim()] || null
}
function customCmdList(phone) {
  return Object.keys(customCmdLoad(phone))
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTITAG
// ─────────────────────────────────────────────────────────────────────────────
const ANTITAG_DIR = path.join(__dirname, "data", "antitag")
if (!fs.existsSync(ANTITAG_DIR)) fs.mkdirSync(ANTITAG_DIR, { recursive: true })

function antitagSafePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function antitagFilePath(phone) {
  return path.join(ANTITAG_DIR, `${antitagSafePhone(phone)}.json`)
}
function antitagLoad(phone) {
  const file = antitagFilePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTITAG] load error for ${phone}:`, e.message)
  }
  return { groups: {} }
}
function antitagSave(phone, data) {
  try {
    fs.writeFileSync(antitagFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTITAG] save error for ${phone}:`, e.message)
  }
}
function antitagIsEnabled(phone, groupId) {
  return !!antitagLoad(phone).groups[groupId]?.enabled
}
function antitagEnable(phone, groupId) {
  const data = antitagLoad(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  antitagSave(phone, data)
}
function antitagDisable(phone, groupId) {
  const data = antitagLoad(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; antitagSave(phone, data) }
}

function antitagGetMentions(msg) {
  const m = msg.message
  const ctx = m?.extendedTextMessage?.contextInfo || m?.imageMessage?.contextInfo ||
              m?.videoMessage?.contextInfo || m?.conversation?.contextInfo
  return ctx?.mentionedJid || []
}

async function handleAntitagInline(sock, msg, phone) {
  try {
    if (!msg?.message) return
    const groupId = msg.key.remoteJid
    if (!groupId?.endsWith("@g.us")) return
    if (msg.key.fromMe) return
    if (!antitagIsEnabled(phone, groupId)) return

    const mentions = antitagGetMentions(msg)
    if (!mentions.length) return

    const sender = msg.key.participant || groupId
    const senderNorm = normalizeNum(sender)
    const sessionPhone = normalizeNum(sock.user?.id || "")

    if (senderNorm === sessionPhone) return
    if (OWNER_NUMBERS.includes(senderNorm)) return

    try {
      const groupMeta = await sock.groupMetadata(groupId)
      const isSenderAdmin = groupMeta.participants?.some(p =>
        normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin"))
      if (isSenderAdmin) return
    } catch (e) {
      console.error(`[ANTITAG:${phone}] admin check failed:`, e.message)
    }

    try {
      await sock.sendMessage(groupId, { delete: msg.key })
      console.log(`[ANTITAG:${phone}] 🗑️ Deleted tag/mention message from ${senderNorm} in ${groupId} (${mentions.length} mention(s))`)

      await sock.sendMessage(groupId, {
        text: '> *Tags are not allowed in this group*',
        mentions: [sender],
      })
    } catch (e) {
      console.error(`[ANTITAG:${phone}] delete failed (bot may not be admin):`, e.message)
    }
  } catch (err) {
    console.error("[ANTITAG]", err.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTISTATUS
// ─────────────────────────────────────────────────────────────────────────────
const ANTISTATUS_DIR = path.join(__dirname, "data", "antistatus")
if (!fs.existsSync(ANTISTATUS_DIR)) fs.mkdirSync(ANTISTATUS_DIR, { recursive: true })

function antistatusSafePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function antistatusFilePath(phone) {
  return path.join(ANTISTATUS_DIR, `${antistatusSafePhone(phone)}.json`)
}
function antistatusLoad(phone) {
  const file = antistatusFilePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTISTATUS] load error for ${phone}:`, e.message)
  }
  return { groups: {}, warnings: {} }
}
function antistatusSave(phone, data) {
  try {
    fs.writeFileSync(antistatusFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTISTATUS] save error for ${phone}:`, e.message)
  }
}
function antistatusIsEnabled(phone, groupId) {
  return !!antistatusLoad(phone).groups[groupId]?.enabled
}
function antistatusEnable(phone, groupId, mode = "warn") {
  const data = antistatusLoad(phone)
  if (!data.groups[groupId]) data.groups[groupId] = {}
  data.groups[groupId].enabled = true
  data.groups[groupId].mode = mode
  antistatusSave(phone, data)
}
function antistatusDisable(phone, groupId) {
  const data = antistatusLoad(phone)
  if (data.groups[groupId]) { data.groups[groupId].enabled = false; antistatusSave(phone, data) }
}
function antistatusGetMode(phone, groupId) {
  return antistatusLoad(phone).groups[groupId]?.mode || "warn"
}
function antistatusAddWarning(phone, groupId, sender) {
  const data = antistatusLoad(phone)
  if (!data.warnings[groupId]) data.warnings[groupId] = {}
  if (!data.warnings[groupId][sender]) data.warnings[groupId][sender] = 0
  data.warnings[groupId][sender]++
  antistatusSave(phone, data)
  return data.warnings[groupId][sender]
}
function antistatusResetWarnings(phone, groupId, sender) {
  const data = antistatusLoad(phone)
  if (data.warnings[groupId]?.[sender] !== undefined) {
    data.warnings[groupId][sender] = 0
    antistatusSave(phone, data)
  }
}

async function handleAntistatusInline(sock, msg, phone) {
  try {
    if (!msg?.message) return
    if (msg.key.fromMe) return

    const m = msg.message
    const ctx = m?.extendedTextMessage?.contextInfo || m?.imageMessage?.contextInfo || m?.videoMessage?.contextInfo
    const groupMentions = ctx?.groupMentions || []
    if (!groupMentions.length) return

    const sender = msg.key.participant || msg.key.remoteJid
    const senderNorm = normalizeNum(sender)
    const sessionPhone = normalizeNum(sock.user?.id || "")

    for (const gm of groupMentions) {
      const groupId = gm.groupJid || gm.jid
      if (!groupId) continue
      if (!antistatusIsEnabled(phone, groupId)) continue

      if (senderNorm === sessionPhone) continue

      let groupMeta
      try { groupMeta = await sock.groupMetadata(groupId) } catch (e) {
        console.error("[ANTISTATUS] metadata fetch failed:", e.message)
        continue
      }

      const isMember = groupMeta.participants?.some(p => normalizeNum(p.id) === senderNorm)
      if (!isMember) continue

      const isSenderAdmin = groupMeta.participants?.some(p =>
        normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin"))
      if (isSenderAdmin) continue

      const botNorm = normalizeNum(sock.user?.id || "")
      const botIsAdmin = groupMeta.participants?.some(p =>
        normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin"))

      const mode = antistatusGetMode(phone, groupId)
      const tag = senderNorm

      try {
        await sock.sendMessage(msg.key.remoteJid, { delete: msg.key })
        console.log(`[ANTISTATUS:${phone}] delete attempt sent for status from ${tag}`)
      } catch (e) {
        console.log(`[ANTISTATUS:${phone}] could not delete status from ${tag} (WhatsApp restricts deleting others' status): ${e.message}`)
      }

      if (!botIsAdmin && mode === "kick") {
        console.log(`[ANTISTATUS:${phone}] would kick ${tag} from ${groupId} but bot isn't admin there`)
        continue
      }

      if (mode === "kick") {
        try {
          await sock.groupParticipantsUpdate(groupId, [sender], "remove")
          await sock.sendMessage(groupId, {
            text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 📱 *Reason:* Tagged this group in their status\n│ ⚡ *Mode:* Instant kick\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
            mentions: [sender]
          })
        } catch (e) {
          console.error("[ANTISTATUS] kick failed:", e.message)
        }
      } else if (mode === "warn") {
        const warns = antistatusAddWarning(phone, groupId, sender)
        const maxWarns = 3
        if (warns >= maxWarns) {
          antistatusResetWarnings(phone, groupId, sender)
          try {
            await sock.groupParticipantsUpdate(groupId, [sender], "remove")
            await sock.sendMessage(groupId, {
              text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 📱 *Reason:* Repeatedly tagged this group in status\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
              mentions: [sender]
            })
          } catch (e) {
            console.error("[ANTISTATUS] warn-kick failed:", e.message)
          }
        } else {
          await sock.sendMessage(groupId, {
            text: `╔════════════════════╗\n║  ⚠️ *STATUS WARNING* ║\n╚════════════════════╝\n\n┌─────〔 📱 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 🚫 Don't tag this group in your status!\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ ⚡ *${maxWarns - warns} more = KICK!*\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
            mentions: [sender]
          }).catch(() => {})
        }
      } else {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  📱 *STATUS ACTION* ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 🚫 Tagged this group in their status — action taken\n└──────────────────────────\n> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
          mentions: [sender]
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.error("[ANTISTATUS]", err.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BAN SYSTEM — hardened, cached, applied uniformly everywhere
// ─────────────────────────────────────────────────────────────────────────────
const BAN_CACHE_TTL_MS = 15000
const banCache = new Map()

function banCacheKey(sessionPhone, targetPhone) {
  return `${sessionPhone}:${targetPhone}`
}

function banCacheInvalidate(sessionPhone, targetPhone) {
  banCache.delete(banCacheKey(sessionPhone, targetPhone))
}

async function isBannedFast(sessionPhone, targetPhone, chatJid) {
  const key = banCacheKey(sessionPhone, targetPhone)
  const cached = banCache.get(key)
  if (cached && Date.now() < cached.expiresAt) return cached.banned

  let banned = false
  if (typeof global.__isBanned === "function") {
    try { banned = !!(await global.__isBanned(sessionPhone, targetPhone, chatJid)) }
    catch (e) { console.error("[BAN] check error:", e.message); banned = false }
  }
  banCache.set(key, { banned, expiresAt: Date.now() + BAN_CACHE_TTL_MS })
  return banned
}

global.__banCacheInvalidate = banCacheInvalidate

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE-MODE LOCKDOWN
// ─────────────────────────────────────────────────────────────────────────────
function isPrivateLockdownActive(state) {
  return (state.settings.get("mode") || "public") === "private"
}

function isBlockedByPrivateMode(state, isOwner, fromMe, sender, senderAlt) {
  if (isOwner || fromMe) return false
  if (!isPrivateLockdownActive(state)) return false
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)
  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n))) return false
  return true
}

async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true

  if (!fromMe) {
    const sessionPhone = normalizeNum(sock.user?.id || "")
    const senderPhone  = normalizeNum(sender || from)
    if (await isBannedFast(sessionPhone, senderPhone, from)) {
      console.log(`[BAN] 🚫 Blocked message from ${senderPhone} on session ${sessionPhone}`)
      return
    }
  }

  const isOwnerEarly = checkIsOwner(state, sender, senderAlt, fromMe)
  if (isBlockedByPrivateMode(state, isOwnerEarly, fromMe, sender, senderAlt)) {
    console.log(`[${state.phone}] 🔒 Private-mode lockdown: ignoring ${normalizeNum(sender || from)} in ${from}`)
    return
  }

  if (!fromMe && state.settings.get("autoRead")) {
    sock.readMessages([msg.key]).catch(() => {})
  }

  const prefix = state.settings.get("prefix") || BOT_PREFIX
  if (!body.startsWith(prefix)) {
    if (!fromMe) handleOrdinaryMessage(state, sock, msg, from).catch(() => {})
    return
  }

  const isOwner = isOwnerEarly
  const isGroup = from.endsWith("@g.us")
  if (state.settings.get("groupOnly") && !isGroup && !isOwner) return
  if (state.settings.get("dmOnly") && isGroup && !isOwner) return

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []
  const canonical = registry.aliases.get(rawCmd) || rawCmd
  const command   = registry.map.get(canonical)

  if (!command) {
    const customResponse = customCmdGet(state.phone, rawCmd)
    if (customResponse) {
      try {
        await sock.sendMessage(from, {
          text: customResponse.replace(/\{prefix\}/g, prefix)
        }, { quoted: msg })
      } catch (e) {
        console.error(`[${state.phone}] custom cmd send error:`, e.message)
      }
    }
    return
  }

  let isAdmin = false, isBotAdmin = false
  if (isGroup) { ({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner)) }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} botAdmin:${isBotAdmin}`)

  const runOnce = () => command.run({
    sock, from, msg, message: msg, sender, args,
    text: rest, full: body,
    commands: registry.map, cmdList: registry.list, cmdDetails: registry.details,
    settings: state.settings, lib, api, config, helper,
    isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
    extractBody, groupCache: state.groupCache,
    checkIsOwner: (s, a) => checkIsOwner(state, s, a, false),
    checkGroupAdmin: (f, s, a) => checkGroupAdmin(state, sock, f, s, a, isOwner),
    antideleteGetEnabled: () => antideleteGetEnabled(state.phone),
    antideleteSetEnabled: (enabled) => antideleteSetEnabled(state.phone, enabled),
    banCacheInvalidate: (targetPhone) => banCacheInvalidate(normalizeNum(sock.user?.id || ""), normalizeNum(targetPhone)),
  })

  const startedAt = Date.now()

  try {
    await runOnce()
    console.log(`[${state.phone}] ⚡ ${rawCmd} completed in ${Date.now() - startedAt}ms`)
  } catch (e) {
    console.warn(`[${state.phone}] RUN ERR ${rawCmd} (attempt 1, ${Date.now() - startedAt}ms): ${e.message} — retrying with fresh group metadata`)
    try {
      if (isGroup) {
        const fresh = await sock.groupMetadata(from)
        state.groupCache[from] = { ...fresh, _cachedAt: Date.now() }
        ;({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner))
      }
      const retryStartedAt = Date.now()
      await runOnce()
      console.log(`[${state.phone}] ✔ ${rawCmd} succeeded on retry in ${Date.now() - retryStartedAt}ms`)
    } catch (e2) {
      console.error(`[${state.phone}] RUN ERR ${rawCmd} (attempt 2, final): ${e2.message}`)
      try { await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e2.message}` }, { quoted: msg }) } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT START
// ─────────────────────────────────────────────────────────────────────────────
async function startBot(phone) {
  let state = sessions.get(phone)
  if (!state) { state = makeSessionState(phone); sessions.set(phone, state) }

  const { state: authState, saveCreds } = await useMultiFileAuthState(state.sessDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys:  makeCacheableSignalKeyStore(authState.keys, Pino({ level: "silent" })),
    },
    browser:             Browsers.macOS("Chrome"),
    logger:              Pino({ level: "silent" }),
    printQRInTerminal:   false,
    markOnlineOnConnect: false,
    syncFullHistory:     false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs:    60000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount:    5,
    shouldSyncHistoryMessage: m => m.syncType === 0,
    cachedGroupMetadata:  async jid => state.groupCache[jid],
  })

  state.sock = sock

  if (state.presenceTimer) clearInterval(state.presenceTimer)
  state.presenceTimer = setInterval(() => {
    if (state.connected && state.settings.get("alwaysOnline")) {
      sock.sendPresenceUpdate("available").catch(() => {})
    }
  }, 8000)

  sock.ev.on("creds.update", async () => {
    await saveCreds()
    sessionBackup.schedulePush(phone)
  })

  sock.ev.on("groups.upsert", gs => {
    for (const g of gs) state.groupCache[g.id] = { ...g, _cachedAt: Date.now() }
  })

  sock.ev.on("groups.update", us => {
    for (const u of us) state.groupCache[u.id] = { ...(state.groupCache[u.id] || {}), ...u, _cachedAt: Date.now() }
  })

  sock.ev.on("group-participants.update", async (update) => {
    let meta = null
    try {
      meta = await sock.groupMetadata(update.id)
      state.groupCache[update.id] = { ...meta, _cachedAt: Date.now() }
    } catch (e) {
      console.error(`[WATCHDOG:${phone}] metadata fetch failed for ${update.id}:`, e.message)
    }

    if (typeof lib.handleGroupUpdate === "function") {
      lib.handleGroupUpdate(sock, update).catch(e =>
        console.error(`[${phone}] handleGroupUpdate ERR:`, e.message)
      )
    }

    const { id: groupId, participants, action, author } = update
    if (!groupId?.endsWith("@g.us")) return
    if (!["add", "remove", "promote", "demote"].includes(action)) return

    const groupName   = meta?.subject || groupId
    const memberCount = (meta?.participants || []).length
    const adminCount  = (meta?.participants || []).filter(p => p.admin === "admin" || p.admin === "superadmin").length

    for (const rawParticipant of participants) {
      const participantJid = typeof rawParticipant === "string"
        ? rawParticipant
        : (rawParticipant?.phoneNumber || rawParticipant?.id || "")

      if (!participantJid) {
        console.warn(`[WATCHDOG:${phone}] Skipping participant with no resolvable JID:`, JSON.stringify(rawParticipant))
        continue
      }

      const memberPhone = participantJid.replace("@s.whatsapp.net", "").replace(/:\d+$/, "")

      const actionLabel = {
        add:     "🟢 JOINED",
        remove:  "🔴 LEFT",
        promote: "⬆️  PROMOTED",
        demote:  "⬇️  DEMOTED",
      }[action] || action.toUpperCase()

      console.log(`[WATCHDOG:${phone}] ${actionLabel} → ${memberPhone} in "${groupName}" (${groupId}) | members now: ${memberCount}`)

      if (action === "promote" || action === "demote") {
        try {
          const section = lib.userDb?.getSection?.(phone, "adminlog") || { groups: {} }
          const groupSettings = section.groups?.[groupId] || {}
          const enabled = action === "promote" ? groupSettings.promoteEnabled : groupSettings.demoteEnabled

          if (enabled) {
            const actorPhone = author ? author.replace("@s.whatsapp.net", "").replace(/:\d+$/, "") : null
            const actorJid   = author || null

            const boxTitle = action === "promote" ? "⬆️ ADMIN PROMOTION" : "⬇️ ADMIN DEMOTED"
            const verb     = action === "promote" ? "promoted to" : "demoted from"

            const text =
              `╔═══════════════════════════╗\n` +
              `║   ${boxTitle}${" ".repeat(Math.max(0, 21 - boxTitle.length))}║\n` +
              `╚═══════════════════════════╝\n\n` +
              `👤 @${memberPhone} has been ${verb} *Admin*\n` +
              `🛡️ ${action === "promote" ? "Promoted" : "Demoted"} by: ${actorJid ? "@" + actorPhone : "Unknown"}\n` +
              `📊 Total Admins: ${adminCount}\n\n` +
              `> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™`

            const mentions = [participantJid, ...(actorJid ? [actorJid] : [])]

            await sock.sendMessage(groupId, { text, mentions })
            console.log(`[WATCHDOG:${phone}] ✅ Sent ${action.toUpperCase()} announcement to "${groupName}" for ${memberPhone}`)
          }
        } catch (e) {
          console.error(`[WATCHDOG:${phone}] ${action} announcement error:`, e.message)
        }
      }

      if (action !== "add" && action !== "remove") continue

      try {
        const welcomeCmd = require('./commands/welcome.js')
        const goodbyeCmd = require('./commands/goodbye.js')

        let pushName = ""
        try {
          const contact = meta?.participants?.find(p => p.id === participantJid || p.id?.startsWith(memberPhone))
          pushName = contact?.notify || contact?.name || ""
        } catch {}

        const type      = action === "add" ? "welcome" : "goodbye"
        const cmdModule = type === "welcome" ? welcomeCmd : goodbyeCmd

        const greetData = cmdModule.loadGreet(phone, groupId)
        const settings  = type === "welcome" ? greetData.welcome : greetData.goodbye

        if (!settings?.enabled) {
          console.log(`[WATCHDOG:${phone}] ⚠️ ${type} is DISABLED for "${groupName}" — nothing sent. Run .${type} on to enable.`)
          continue
        }

        let text
        if (type === "welcome") {
          text = await welcomeCmd.buildRichWelcomeText(sock, {
            groupId, participantJid, pushName, groupName, memberCount, meta,
          })
        } else {
          const defaultMsg = "Goodbye @{tag}! 👋\nWe'll miss you in *{group}*.\nWe now have *{members}* members."
          const template = settings.message || defaultMsg
          text = template
            .replace(/{tag}/g,     memberPhone)
            .replace(/{group}/g,   groupName)
            .replace(/{members}/g, String(memberCount))
        }

        const ppUrl = await getProfilePictureSafe(sock, participantJid, { retries: 2, delayMs: 800 })

        if (ppUrl) {
          await sock.sendMessage(groupId, { image: { url: ppUrl }, caption: text, mentions: [participantJid] })
        } else {
          await sock.sendMessage(groupId, { text, mentions: [participantJid] })
        }

        console.log(`[WATCHDOG:${phone}] ✅ ${type === "welcome" ? "Sent WELCOME" : "Sent GOODBYE"} to "${groupName}" for ${memberPhone}`)

      } catch (e) {
        console.error(`[WATCHDOG:${phone}] send error for ${memberPhone}:`, e.message)
      }
    }
  })

  const antiCallNotified = new Set()

  sock.ev.on("call", async (calls) => {
    try {
      if (!state.settings.get("anticall")) return
      for (const call of calls) {
        const callerJid = call.from || call.peerJid || call.chatId
        if (!callerJid) continue

        const sessionPhone = normalizeNum(sock.user?.id || "")
        const callerPhone  = normalizeNum(callerJid)
        const callerBanned = await isBannedFast(sessionPhone, callerPhone, callerJid)

        try {
          if (typeof sock.rejectCall === "function" && call.id) {
            await sock.rejectCall(call.id, callerJid)
          } else if (typeof sock.sendCallOfferAck === "function" && call.id) {
            await sock.sendCallOfferAck(call.id, callerJid, "reject")
          }
        } catch (e) {
          console.error(`[ANTICALL:${phone}] reject failed:`, e.message)
        }

        if (!callerBanned && !antiCallNotified.has(callerJid)) {
          antiCallNotified.add(callerJid)
          setTimeout(() => antiCallNotified.delete(callerJid), 60000)
          try {
            await sock.sendMessage(callerJid, {
              text: "📵 Anticall is enabled. Your call was rejected.",
            })
          } catch {}
        }
      }
    } catch (e) {
      console.error(`[ANTICALL:${phone}] handler error:`, e.message)
    }
  })

  let pairingCodeRequested = false

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (
      !authState.creds.registered &&
      !pairingCodeRequested &&
      connection === "connecting" &&
      !qr
    ) {
      pairingCodeRequested = true
      const number = phone.replace(/\D/g, "")
      try {
        await new Promise(r => setTimeout(r, 3000))
        const code = await sock.requestPairingCode(number)
        state.pairingCode          = code
        state.pairingCodeExpiresAt = Date.now() + PAIRING_CODE_TTL_MS
        console.log(`[${phone}] 📱 PAIRING CODE: ${code} (generated ${nowWAT()} WAT — expires in 60s)`)
      } catch (e) {
        console.error(`[${phone}] PAIR ERR:`, e.message)
        pairingCodeRequested = false
        state.pairingCode          = null
        state.pairingCodeExpiresAt = null
      }
    }

    if (connection === "open") {
      state.connected            = true
      state.retries              = 0
      state.pairingCode          = null
      state.pairingCodeExpiresAt = null
      console.log(`[${phone}] ⚡ Connected — ${sock.user?.id || "unknown"} at ${nowWAT()} WAT`)
      const allSettings = state.settings.getAll()
      const settingKeys = Object.keys(allSettings)
      if (settingKeys.length > 0) {
        console.log(`[${phone}] 💾 Restored settings: ${settingKeys.map(k => `${k}=${JSON.stringify(allSettings[k])}`).join(", ")}`)
        if (allSettings.mode === "private") {
          console.log(`[${phone}] 🔒 Private-mode lockdown is ACTIVE (persisted) — only owner/sudo can use the bot`)
        }
      } else {
        console.log(`[${phone}] 💾 No saved settings — using defaults`)
      }
      console.log(`[${phone}] 👀 autoViewStatus=${!!allSettings.autoViewStatus} autoReactStatus=${!!allSettings.autoReactStatus} emoji=${allSettings.statusReactEmoji || "🙃"} — if these show false but you expect them on, the toggle command isn't saving correctly`)
      saveMeta()
      sessionBackup.pushImmediate(phone).catch(e => console.error(`[${phone}] BACKUP PUSH ERR:`, e.message))
    }

    if (connection === "close") {
      state.connected = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut  = statusCode === DisconnectReason.loggedOut
      if (loggedOut) {
        console.log(`[${phone}] ✗ Logged out — removing session`)
        await removeSession(phone)
        await sessionBackup.deleteSession(phone).catch(() => {})
        return
      }
      state.retries++
      const delay = Math.min(1000 * Math.pow(2, state.retries), 30000)
      console.log(`[${phone}] ↻ Reconnecting in ${delay}ms (code ${statusCode})`)
      setTimeout(() => startBot(phone).catch(e => console.error(`[${phone}] RESTART ERR:`, e.message)), delay)
    }
  })

  if (typeof lib.setSocket      === "function") lib.setSocket(sock)
  if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)
  try { lib.groupParticipants?.setStore?.({ groupMetadata: state.groupCache }) } catch {}

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    const sessionPhone = normalizeNum(sock.user?.id || "")
    for (const m of messages) {
      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue

      if (!m.key.fromMe && m.key.remoteJid !== "status@broadcast") {
        const senderPhone = normalizeNum(m.key.participant || m.key.remoteJid)
        if (await isBannedFast(sessionPhone, senderPhone, m.key.remoteJid)) continue
      }

      if (m.key.remoteJid === "status@broadcast") {
        handleStatus(state, sock, m).catch(e => console.error(`[${phone}] STATUS ERR:`, e.message))
        handleAntistatusInline(sock, m, phone).catch(e => console.error(`[${phone}] ANTISTATUS ERR:`, e.message))
        continue
      }
      storeMessage(sock, m).catch(e => console.error(`[${phone}] storeMessage ERR:`, e.message))
      handleMessageRevocation(sock, phone, m, "upsert").catch(e =>
        console.error(`[${phone}] antideleteUpsert ERR:`, e.message)
      )
      if (!m.key.fromMe) {
        if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
        ;(lib.handleAntilinkInline || handleAntilinkInline)(sock, m, phone).catch(e => console.error(`[${phone}] ANTILINK ERR:`, e.message))
        handleAntitagInline(sock, m, phone).catch(e => console.error(`[${phone}] ANTITAG ERR:`, e.message))
        if (typeof lib.handleBadword  === "function") lib.handleBadword(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleAntibot === "function") lib.handleAntibot(sock, m, extractBody, lib).catch(() => {})
      }
      handleMessage(state, sock, m).catch(e => console.error(`[${phone}] MSG ERR:`, e.message))
    }
  })

  sock.ev.on("messages.update", async (updates) => {
    handleMessageRevocation(sock, phone, updates, "update").catch(e =>
      console.error(`[${phone}] antideleteUpdate ERR:`, e.message)
    )
  })

  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// DEAD SESSION CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
async function cleanupDeadSessions(waitMs = 60000) {
  console.log(`[SESSION-GUARD] ⏳ Watching sessions — will remove any that fail to connect within ${waitMs / 1000}s...`)
  await new Promise(r => setTimeout(r, waitMs))
  const dead = []
  for (const [phone, state] of sessions.entries()) {
    if (!state.connected) dead.push(phone)
  }
  if (!dead.length) {
    console.log("[SESSION-GUARD] ✅ All sessions connected successfully — nothing to remove")
    return
  }
  console.log(`[SESSION-GUARD] 🧹 ${dead.length} session(s) failed after ${waitMs / 1000}s — permanently removing: ${dead.join(", ")}`)
  for (const phone of dead) {
    try {
      const state = sessions.get(phone)
      if (state) {
        if (state.presenceTimer) clearInterval(state.presenceTimer)
        try { state.sock?.end(undefined) } catch {}
        sessions.delete(phone)
        console.log(`[SESSION-GUARD] 🗑 Removed from bot memory: ${phone}`)
      }
      try {
        const sessDir = path.join(SESS_ROOT, phone)
        if (fs.existsSync(sessDir)) {
          fs.rmSync(sessDir, { recursive: true, force: true })
          console.log(`[SESSION-GUARD] 🗑 Removed from disk: ${phone}`)
        }
      } catch (e) {
        console.error(`[SESSION-GUARD] ✗ Disk remove failed for ${phone}:`, e.message)
      }
      try {
        await sessionBackup.deleteSession(phone)
        console.log(`[SESSION-GUARD] 🗑 Wiped from Redis: ${phone}`)
      } catch (e) {
        console.error(`[SESSION-GUARD] ✗ Redis wipe failed for ${phone}:`, e.message)
      }
      if (slotAssignments[phone]) delete slotAssignments[phone]
    } catch (e) {
      console.error(`[SESSION-GUARD] ✗ Error cleaning up ${phone}:`, e.message)
    }
  }
  saveMeta()
  saveSlotAssignments()
  console.log(`[SESSION-GUARD] ✅ Cleanup done — removed ${dead.length} dead session(s). Active sessions: ${sessions.size}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  await loadCommands()
  watchCommands()
  watchSupportDirs()

  if (typeof lib.isBanned === "function") {
    global.__isBanned = lib.isBanned
    console.log("[BAN] ✔ Ban check wired up (per-session, cached, applied to messages + calls)")
  } else {
    console.warn("[BAN] ⚠ commands/ban.js not found or isBanned not exported — ban system inactive")
  }

  global.__antilinkEnable        = lib.antilinkEnable        || antilinkEnable
  global.__antilinkDisable       = lib.antilinkDisable       || antilinkDisable
  global.__antilinkIsEnabled     = lib.antilinkIsEnabled     || antilinkIsEnabled
  global.__antilinkGetAction     = lib.antilinkGetAction     || antilinkGetAction
  global.__antilinkResetWarnings = lib.antilinkResetWarnings || antilinkResetWarnings
  global.__antilinkContainsLink  = lib.antilinkContainsLink  || antilinkContainsLink
  global.__antilinkOcrAvailable  = lib.antilinkOcrAvailable !== undefined ? lib.antilinkOcrAvailable : ANTILINK_OCR_AVAILABLE
  console.log(`[ANTILINK] engine source: ${lib.handleAntilinkInline ? "lib/antilink.js (external)" : "index.js (built-in)"}`)
  console.log(`[ANTILINK] ✔ Wired up inline (OCR ${ANTILINK_OCR_AVAILABLE ? "available" : "unavailable — npm install tesseract.js"})`)

  global.__antitagEnable    = antitagEnable
  global.__antitagDisable   = antitagDisable
  global.__antitagIsEnabled = antitagIsEnabled
  console.log("[ANTITAG] ✔ Wired up inline")

  global.__antistatusEnable    = antistatusEnable
  global.__antistatusDisable   = antistatusDisable
  global.__antistatusIsEnabled = antistatusIsEnabled
  global.__antistatusGetMode   = antistatusGetMode
  console.log("[ANTISTATUS] ✔ Wired up inline")

  global.__customCmdAdd    = customCmdAdd
  global.__customCmdRemove = customCmdRemove
  global.__customCmdGet    = customCmdGet
  global.__customCmdList   = customCmdList
  console.log("[CUSTOMCMD] ✔ Per-session custom command engine wired up")

  try {
    const persist = require("./lib/persist")
    await persist.restoreAllData()
    persist.startAutoSave(60 * 1000)
    console.log("[PERSIST] 💾 Persistence engine active")
  } catch (e) {
    console.warn("[PERSIST] ⚠ lib/persist.js not found — skipping data restore:", e.message)
  }

  console.log("[INIT] 🔄 Restoring sessions from backup...")
  const restoredCount = await sessionBackup.restoreAll().catch(e => {
    console.error("[INIT] ✗ Backup restore failed:", e.message)
    return 0
  })
  if (restoredCount > 0) console.log(`[INIT] ✔ Restored ${restoredCount} session(s) from backup`)

  console.log("[INIT] 🔄 Restoring user/group settings from backup...")
  const dbRestoredCount = await lib.userDb?.restoreAllFromRedis?.().catch(e => {
    console.error("[INIT] ✗ User DB restore failed:", e.message)
    return 0
  })
  if (dbRestoredCount > 0) console.log(`[INIT] ✔ Restored ${dbRestoredCount} user record(s) from backup`)

  if (fs.existsSync(SETTINGS_ROOT)) {
    const settingFiles = fs.readdirSync(SETTINGS_ROOT).filter(f => f.endsWith(".json"))
    if (settingFiles.length > 0) {
      console.log(`[SETTINGS] 💾 Found ${settingFiles.length} saved session setting(s): ${settingFiles.map(f => f.replace(".json","")).join(", ")}`)
    }
  }

  const onDisk = fs.existsSync(SESS_ROOT)
    ? fs.readdirSync(SESS_ROOT).filter(f => {
        const full = path.join(SESS_ROOT, f)
        return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "creds.json"))
      })
    : []

  const fromMeta  = loadMetaPhones()
  const allPhones = [...new Set([...onDisk, ...fromMeta])]

  console.log(`[INIT] ▶ Starting ${allPhones.length} session(s): ${allPhones.join(", ") || "(none)"}`)

  for (const phone of allPhones) {
    try { await startBot(phone) }
    catch (e) { console.error(`[INIT] ✗ Failed to start ${phone}:`, e.message) }
  }

  saveMeta()
  cleanupDeadSessions(60000).catch(e => console.error("[SESSION-GUARD] ✗", e.message))
}

async function addSession(phone, preferredSlot = null) {
  const clean = phone.replace(/\D/g, "")
  if (!clean) throw new Error("Invalid phone number")
  const slot = assignToSlot(clean, preferredSlot)
  if (slot === null) throw new Error("All server slots are full. Please try again later.")
  await startBot(clean)
  saveMeta()
  const state = sessions.get(clean)
  for (let i = 0; i < 30 && !state.pairingCode && !state.connected; i++) {
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!state.pairingCode && !state.connected) {
    throw new Error("Timed out waiting for pairing code — try again")
  }
  return {
    phone:       clean,
    pairingCode: getValidPairingCode(state),
    expiresInMs: state.pairingCodeExpiresAt ? Math.max(0, state.pairingCodeExpiresAt - Date.now()) : 0,
    connected:   state.connected,
    slot,
  }
}

async function removeSession(phone) {
  const clean = phone.replace(/\D/g, "")
  const state = sessions.get(clean)
  if (state) {
    if (state.presenceTimer) clearInterval(state.presenceTimer)
    try { state.sock?.end(undefined) } catch {}
    sessions.delete(clean)
  }
  try {
    const sessDir = path.join(SESS_ROOT, clean)
    fs.rmSync(sessDir, { recursive: true, force: true })
  } catch (e) { console.error(`[REMOVE] ✗ ${clean}:`, e.message) }
  saveMeta()
  sessionBackup.schedulePush(clean)
}

function listBots() {
  return [...sessions.entries()].map(([phone, state]) => ({
    phone,
    connected:     state.connected,
    pairingCode:   getValidPairingCode(state),
    expiresInMs:   state.pairingCodeExpiresAt ? Math.max(0, state.pairingCodeExpiresAt - Date.now()) : 0,
    groups:        Object.keys(state.groupCache || {}).length,
    savedSettings: Object.keys(state.settings.getAll()).length,
    slot:          slotAssignments[phone] || null,
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL EXPOSURE
// ─────────────────────────────────────────────────────────────────────────────
global.__listBots = listBots

module.exports = {
  init, addSession, removeSession, listBots,
  getSlotsSummary, getNextAvailableSlot, SLOT_COUNT, SLOT_CAPACITY,
  TOTAL_RAM_MB, MAX_RAM_MB, MEM_RESERVE_MB, PER_SESSION_BUDGET_MB,
}
