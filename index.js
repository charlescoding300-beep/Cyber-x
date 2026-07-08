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
// PERSISTENT SESSION SETTINGS ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const sessionSettingsCache = new Map()

function getSettingsFile(phone) {
  return path.join(SETTINGS_ROOT, `${phone}.json`)
}

function loadSessionSettings(phone) {
  if (sessionSettingsCache.has(phone)) return sessionSettingsCache.get(phone)
  const file = getSettingsFile(phone)
  let data = {}
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[SETTINGS] ✗ Load failed for ${phone}:`, e.message)
  }
  sessionSettingsCache.set(phone, data)
  return data
}

function saveSessionSettings(phone) {
  const data = sessionSettingsCache.get(phone) || {}
  const file = getSettingsFile(phone)
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[SETTINGS] ✗ Save failed for ${phone}:`, e.message)
  }
}

function makeSessionSettings(phone) {
  const data = loadSessionSettings(phone)
  return {
    get(key)      { return data[key] },
    set(key, val) {
      data[key] = val
      sessionSettingsCache.set(phone, data)
      saveSessionSettings(phone)
      console.log(`[SETTINGS:${phone}] ✔ ${key} = ${JSON.stringify(val)}`)
    },
    delete(key) {
      delete data[key]
      sessionSettingsCache.set(phone, data)
      saveSessionSettings(phone)
    },
    getAll() { return { ...data } },
    reset()  {
      sessionSettingsCache.set(phone, {})
      saveSessionSettings(phone)
    },
    merge(obj) {
      Object.assign(data, obj)
      sessionSettingsCache.set(phone, data)
      saveSessionSettings(phone)
      console.log(`[SETTINGS:${phone}] ✔ merged ${Object.keys(obj).join(", ")}`)
    },
  }
}

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

// ── Memory guard ──────────────────────────────────────────────────────────────
setInterval(() => { if (global.gc) global.gc() }, 60_000)

let memoryShutdownInProgress = false
setInterval(async () => {
  const usedMB  = process.memoryUsage().rss / 1024 / 1024
  const limitMB = parseInt(process.env.MAX_RAM_MB || "450", 10)

  if (usedMB > limitMB && !memoryShutdownInProgress) {
    memoryShutdownInProgress = true
    console.log(`[MEMORY] ⚠ RAM too high (${usedMB.toFixed(0)}MB) — pushing backup then exiting for clean restart`)

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
//
// Baileys' sock.profilePictureUrl() has a documented intermittent bug
// (WhiskeySockets/Baileys #1979): it sometimes succeeds and sometimes
// throws "not-authorized" for the exact same JID, seemingly tied to
// WhatsApp-side rate limiting rather than anything wrong in the calling
// code. This is why the same command can work on one session and fail
// on another even with identical permissions. Retrying a couple of
// times with a short delay before giving up fixes the vast majority
// of these transient failures.
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
  box(title, lines = []) {
    const body = lines.map(l => `║  ${l}`).join("\n")
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n${body}\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
  },
  msToTime(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s` },
  sleep(ms)    { return new Promise(r => setTimeout(r, ms)) },
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────
const sessions = new Map()

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

async function handleStatus(state, sock, msg) {
  if (msg.key.fromMe) return
  const s = state.settings
  if (s.get("autoViewStatus")) { try { await sock.readMessages([msg.key]) } catch {} }
  if (s.get("autoReactStatus")) {
    const emoji = s.get("statusReactEmoji") || "🙃"
    try {
      await sock.sendMessage("status@broadcast", { react: { text: emoji, key: msg.key } }, {
        statusJidList: [msg.key.participant, sock.user?.id].filter(Boolean)
      })
    } catch (e) { console.error(`[${state.phone}] STATUS REACT ERR:`, e.message) }
  }
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
  try {
    return await downloadMediaMessage(msg, "buffer", {}, { logger: Pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage })
  } catch (e) {
    console.error("[ANTIDELETE] media download failed:", e.message)
    return null
  }
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
// ANTILINK — built inline (same pattern as ANTIDELETE above), no lib/ file
// needed. Per-session (phone) + per-group config at data/antilink/{phone}.json.
//
// Detection works in two layers, same philosophy as the antibadword system's
// leetspeak normalization:
//   1. Strip invisible/zero-width Unicode characters that get inserted to
//      slip text past keyword filters (U+200B/C/D, U+FEFF, U+200E/F, U+00AD,
//      and the wider zero-width range U+2060–U+206F).
//   2. Collapse common obfuscation: spaced-out letters ("g o o g l e"),
//      "(dot)"/"[dot]"/" dot " in place of ".", before running link regex.
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

// Zero-width / invisible formatting characters used to hide text from
// keyword filters — stripped before detection runs.
const ANTILINK_HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g

function antilinkNormalize(text) {
  if (!text) return ""
  let t = text.replace(ANTILINK_HIDDEN_CHARS, "")
  // "(dot)", "[dot]", " dot " → "." — common manual obfuscation
  t = t.replace(/\s*[\(\[]\s*dot\s*[\)\]]\s*/gi, ".")
       .replace(/\s+dot\s+/gi, ".")
  // Collapse spaced-out single chars INCLUDING dots, so obfuscation like
  // "g o o g l e . c o m" collapses in one pass instead of the dot
  // splitting it into two separate pieces that don't re-match as a link.
  t = t.replace(/(?:[a-zA-Z0-9.]\s+){2,}[a-zA-Z0-9.]/g, m => m.replace(/\s+/g, ""))
  return t
}

const ANTILINK_PATTERNS = [
  /(?:https?|ftp):\/\/[^\s<>"{}|\\^`[\]]{2,}/gi,
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/gi,
  /(?:t|telegram)\.me\/[^\s]{2,}/gi,
  /www\.[a-z0-9][-a-z0-9]{0,61}(?:\.[a-z]{2,})+(?:\/[^\s]*)?/gi,
  /\b[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?\.(?:com|net|org|io|co|xyz|top|info|biz|me|link|click|shop|store|online|site|app|dev|tv)\b(?:\/[^\s]*)?/gi,
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
    const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: Pino({ level: "silent" }) })
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
    if (!foundText) foundOcr = await antilinkScanImage(msg)
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
// CUSTOM COMMANDS — per-session private commands.
//
// This is the second layer on top of your normal commands/ folder:
//   1. Commands YOU add to commands/ (like .anime, .antilink) — these
//      load into the shared registry and work identically on every
//      session, since it's the same code loaded by every startBot().
//   2. Custom commands each session owner defines for THEMSELVES via
//      .addcmd — stored at data/customcmds/{phone}.json, checked only
//      after the shared registry has no match. Completely invisible to
//      every other session, even ones running the exact same bot code —
//      because each session's file only exists under that session's own
//      phone number.
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
// ANTITAG — deletes any message that mentions/tags a member (including
// simulated "@all"/"tag everyone", which WhatsApp doesn't natively support —
// bots fake it by populating contextInfo.mentionedJid with every participant
// while the visible text just reads "@all"). Confirmed via Baileys' own
// ContextInfo docs: mentionedJid is the field to check, regardless of how
// many people are tagged.
//
// Works for BOTH admins and normal members — only the session owner is
// exempt. Delete-only, no warn/kick tiers (matches the requested behavior).
// Per-session + per-group config at data/antitag/{phone}.json.
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

    // Only the session owner is exempt — admins and normal members both
    // get their tag messages deleted, exactly as requested.
    if (senderNorm === sessionPhone) return

    try {
      await sock.sendMessage(groupId, { delete: msg.key })
      console.log(`[ANTITAG:${phone}] 🗑️ Deleted tag/mention message from ${senderNorm} in ${groupId} (${mentions.length} mention(s))`)
    } catch (e) {
      console.error(`[ANTITAG:${phone}] delete failed (bot may not be admin):`, e.message)
    }
  } catch (err) {
    console.error("[ANTITAG]", err.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTISTATUS — actions taken when a NORMAL member (not admin, not owner)
// posts a personal WhatsApp status that mentions/tags a monitored group.
// Detected via contextInfo.groupMentions — a documented Baileys/WhatsApp
// field specifically for status posts that tag a group (confirmed via
// Baileys' ContextInfo class docs, alongside the related isGroupStatus flag).
//
// HONEST LIMITATION: WhatsApp does not allow deleting another person's
// actual personal Status post — that's enforced by WhatsApp's own protocol,
// not something Baileys can bypass. "delete" mode attempts it (works only
// in edge cases WhatsApp permits) and logs clearly if rejected. "warn" and
// "kick" are the actions that reliably work every time, since those operate
// on group membership, which the bot does control as admin.
//
// Only fires for normal members — admins and the session owner posting the
// same kind of status are completely ignored, though either can configure
// this feature via .antistatus on/off/mode.
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

// Called for every status@broadcast message. Checks it against every
// group this session has antistatus enabled for.
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

      // Owner posting their own status is always exempt.
      if (senderNorm === sessionPhone) continue

      let groupMeta
      try { groupMeta = await sock.groupMetadata(groupId) } catch (e) {
        console.error("[ANTISTATUS] metadata fetch failed:", e.message)
        continue
      }

      // Poster must actually be a member of this group for it to matter.
      const isMember = groupMeta.participants?.some(p => normalizeNum(p.id) === senderNorm)
      if (!isMember) continue

      // Admins are exempt — only normal members get actioned.
      const isSenderAdmin = groupMeta.participants?.some(p =>
        normalizeNum(p.id) === senderNorm && (p.admin === "admin" || p.admin === "superadmin"))
      if (isSenderAdmin) continue

      const botNorm = normalizeNum(sock.user?.id || "")
      const botIsAdmin = groupMeta.participants?.some(p =>
        normalizeNum(p.id) === botNorm && (p.admin === "admin" || p.admin === "superadmin"))

      const mode = antistatusGetMode(phone, groupId)
      const tag = senderNorm

      // Best-effort delete attempt — see the honest limitation noted above.
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
        // delete mode — the delete attempt above already ran; just notify.
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

async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true

  if (!fromMe && typeof global.__isBanned === 'function') {
    const sessionPhone = normalizeNum(sock.user?.id || '')
    const senderPhone  = normalizeNum(sender || from)
    try {
      const banned = await global.__isBanned(sessionPhone, senderPhone, from)
      if (banned) {
        console.log(`[BAN] 🚫 Blocked: ${senderPhone} on session ${sessionPhone}`)
        return
      }
    } catch {}
  }

  if (!fromMe && state.settings.get("autoRead")) {
    sock.readMessages([msg.key]).catch(() => {})
  }

  const prefix = state.settings.get("prefix") || BOT_PREFIX
  if (!body.startsWith(prefix)) {
    if (!fromMe) handleOrdinaryMessage(state, sock, msg, from).catch(() => {})
    return
  }

  const isOwner = checkIsOwner(state, sender, senderAlt, fromMe)
  const mode = state.settings.get("mode") || "public"
  if (mode === "private" && !isOwner && !fromMe) {
    console.log(`[${state.phone}] 🔒 Blocked (private mode): ${normalizeNum(sender || from)}`)
    return
  }

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
    // Not a shared/global command — check if THIS session's owner has
    // defined their own private custom command with this trigger.
    // Only exists for this specific phone's data file, so it can never
    // fire on any other session, even ones running identical code.
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
  })

  // Hard timeout — command dispatch itself is already O(1) (Map lookup,
  // not a scan) and commands/ only loads once at boot, so neither of
  // those add per-message delay. The actual risk to speed is a command
  // that hangs on a slow external call with no time limit. This makes
  // every command race against a clock: if it doesn't finish in time,
  // it fails fast with a clear timeout error instead of blocking this
  // session indefinitely.
  const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || "15000", 10)
  const runWithTimeout = () => Promise.race([
    runOnce(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${COMMAND_TIMEOUT_MS / 1000}s`)), COMMAND_TIMEOUT_MS)
    ),
  ])

  const startedAt = Date.now()

  try {
    await runWithTimeout()
    console.log(`[${state.phone}] ⚡ ${rawCmd} completed in ${Date.now() - startedAt}ms`)
  } catch (e) {
    // One of the most common causes of "works for one person, fails for
    // another" in group bots is stale cached group metadata (it only
    // auto-refreshes every 5 minutes — see checkGroupAdmin above). If a
    // command throws (including a timeout above), force a fresh metadata
    // fetch and retry exactly once before showing the error, so a
    // stale-cache hiccup self-heals instead of surfacing as an
    // inconsistent per-user failure.
    console.warn(`[${state.phone}] RUN ERR ${rawCmd} (attempt 1, ${Date.now() - startedAt}ms): ${e.message} — retrying with fresh group metadata`)
    try {
      if (isGroup) {
        const fresh = await sock.groupMetadata(from)
        state.groupCache[from] = { ...fresh, _cachedAt: Date.now() }
        ;({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner))
      }
      const retryStartedAt = Date.now()
      await runWithTimeout()
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

  // ─────────────────────────────────────────────────────────────────────────
  // GROUP WATCHDOG — logs joins/leaves/promotions/demotions to terminal,
  // AND forwards welcome/goodbye messages into the actual WhatsApp group
  // (real sendMessage to groupId — not log-only) when .welcome on /
  // .goodbye on has been set for that specific group.
  // ─────────────────────────────────────────────────────────────────────────
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
      // WhatsApp sometimes sends participants as plain JID strings, and
      // sometimes as objects like { id, phoneNumber, admin } (seen with
      // @lid identity-linked accounts). Normalize both shapes here so
      // .replace() never gets called on a non-string and crashes this
      // whole handler (which was silently killing detection downstream).
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

      // ── PROMOTE / DEMOTE ANNOUNCEMENTS ──────────────────────────────────
      // Controlled independently via .promotemsg on/off and .demotemsg
      // on/off (commands/promotemsg.js, commands/demotemsg.js). Reads
      // Baileys' own `author` field on the event — the JID of whoever
      // performed the action — officially documented in BaileysEventMap.
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


        const defaultMsg = type === "welcome"
          ? "Welcome to *{group}*, @{tag}! 🎉\nWe now have *{members}* members."
          : "Goodbye @{tag}! 👋\nWe'll miss you in *{group}*.\nWe now have *{members}* members."

        const template = settings.message || defaultMsg
        const text = template
          .replace(/{tag}/g,     memberPhone)
          .replace(/{group}/g,   groupName)
          .replace(/{members}/g, String(memberCount))

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

  // ── ANTICALL ──────────────────────────────────────────────────────────────
  const antiCallNotified = new Set()

  sock.ev.on("call", async (calls) => {
    try {
      if (!state.settings.get("anticall")) return
      for (const call of calls) {
        const callerJid = call.from || call.peerJid || call.chatId
        if (!callerJid) continue

        try {
          if (typeof sock.rejectCall === "function" && call.id) {
            await sock.rejectCall(call.id, callerJid)
          } else if (typeof sock.sendCallOfferAck === "function" && call.id) {
            await sock.sendCallOfferAck(call.id, callerJid, "reject")
          }
        } catch (e) {
          console.error(`[ANTICALL:${phone}] reject failed:`, e.message)
        }

        if (!antiCallNotified.has(callerJid)) {
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

  // ── PAIRING CODE ──────────────────────────────────────────────────────────
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
      } else {
        console.log(`[${phone}] 💾 No saved settings — using defaults`)
      }
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
    for (const m of messages) {
      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue
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
        handleAntilinkInline(sock, m, phone).catch(e => console.error(`[${phone}] ANTILINK ERR:`, e.message))
        handleAntitagInline(sock, m, phone).catch(e => console.error(`[${phone}] ANTITAG ERR:`, e.message))
        if (typeof lib.handleBadword  === "function") lib.handleBadword(sock, m, extractBody).catch(() => {})
        // FIX: pass `lib` as the 4th argument so commands/antibot.js can
        // read/write per-group antibot state via lib.userDb.getSection/
        // setSection. Previously this called handleAntibot(sock, m,
        // extractBody) with no way to reach lib.userDb at all, so the
        // handler had nothing to read group mode/exempt list from and
        // could never take any action.
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

  // Wire the ban check used in handleMessage(). Previously global.__isBanned
  // was called but never assigned anywhere, so the ban check silently
  // never fired — banned users could still use the bot. loadCommands()
  // already merges every command's named function exports onto `lib`
  // (see loadFile()), so commands/ban.js's `isBanned` export lands at
  // lib.isBanned automatically; this just exposes it globally where
  // handleMessage() expects to find it.
  if (typeof lib.isBanned === "function") {
    global.__isBanned = lib.isBanned
    console.log("[BAN] ✔ Ban check wired up (per-session)")
  } else {
    console.warn("[BAN] ⚠ commands/ban.js not found or isBanned not exported — ban system inactive")
  }

  // Antilink control functions — exposed globally so commands/antilink.js
  // can call them without needing a lib/antilink.js file, same pattern
  // as global.__isBanned above.
  global.__antilinkEnable        = antilinkEnable
  global.__antilinkDisable       = antilinkDisable
  global.__antilinkIsEnabled     = antilinkIsEnabled
  global.__antilinkGetAction     = antilinkGetAction
  global.__antilinkResetWarnings = antilinkResetWarnings
  global.__antilinkContainsLink  = antilinkContainsLink
  global.__antilinkOcrAvailable  = ANTILINK_OCR_AVAILABLE
  console.log(`[ANTILINK] ✔ Wired up inline (OCR ${ANTILINK_OCR_AVAILABLE ? "available" : "unavailable — npm install tesseract.js"})`)

  // Antitag control functions
  global.__antitagEnable    = antitagEnable
  global.__antitagDisable   = antitagDisable
  global.__antitagIsEnabled = antitagIsEnabled
  console.log("[ANTITAG] ✔ Wired up inline")

  // Antistatus control functions
  global.__antistatusEnable    = antistatusEnable
  global.__antistatusDisable   = antistatusDisable
  global.__antistatusIsEnabled = antistatusIsEnabled
  global.__antistatusGetMode   = antistatusGetMode
  console.log("[ANTISTATUS] ✔ Wired up inline")

  // Per-session custom command management — exposed globally so
  // commands/customcmd.js can call these without needing a lib/ file.
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
}
