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

setInterval(() => {
  const usedMB = process.memoryUsage().rss / 1024 / 1024
  if (usedMB > (parseInt(process.env.MAX_RAM_MB || "450", 10))) {
    console.log(`[MEMORY] ⚠ RAM too high (${usedMB.toFixed(0)}MB) — exiting for clean restart`)
    process.exit(1)
  }
}, 30_000)

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
const registry = { map: new Map(), list: [], details: [], aliases: new Map() }
const isValidCmd = m => m && typeof m.pattern === "string" && typeof m.run === "function"
const toKey      = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

const CMD_RESERVED_KEYS = new Set(["run", "pattern", "alias", "desc", "usage", "category"])

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
    const key = toKey(mod.pattern)
    registry.map.set(key, mod)
    if (Array.isArray(mod.alias))
      for (const a of mod.alias) registry.aliases.set(toKey(a), key)
    return true
  } catch (e) { console.error(`[CMD] ✗ ${file}: ${e.message}`); return false }
}

function rebuildLists() {
  const mods = [...registry.map.values()]
  registry.list    = mods.map(c => c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`).sort()
  registry.details = mods.map(c => ({
    pattern:  c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`,
    desc:     c.desc || "", usage: c.usage || "",
    category: c.category || "general", alias: c.alias || [],
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

function logCommandTable() {
  const cmds = [...registry.map.values()]
  if (!cmds.length) return
  const groups = {}
  for (const c of cmds) {
    const cat = (c.category || "GENERAL").toUpperCase()
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`)
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
  registry.map.clear(); registry.aliases.clear()
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()
  let ok = 0, fail = 0
  for (const f of files) { if (loadFile(f)) ok++; else fail++ }
  rebuildLists()
  global.__commandCount = ok
  console.log(`[CMD] ⚡ ${ok} loaded | ${fail} skipped`)
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
    sock:          null,
    connected:     false,
    pairingCode:   null,
    presenceTimer: null,
  }
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

// ─── Ordinary (non-command) message side effects ──────────────────────────────
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
    const emoji = s.get("statusReactEmoji") || "🔥"
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
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true

  // ── GLOBAL BAN CHECK — blocks banned users from ALL commands ──
  if (!fromMe && typeof global.__isBanned === 'function') {
    const sessionPhone = normalizeNum(sock.user?.id || '')
    const senderPhone  = normalizeNum(sender || from)
    try {
      const banned = await global.__isBanned(sessionPhone, senderPhone)
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
  if (mode === "private" && !isOwner && !fromMe) return

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
  if (!command) return

  let isAdmin = false, isBotAdmin = false
  if (isGroup) { ({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner)) }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} botAdmin:${isBotAdmin}`)

  try {
    await command.run({
      sock, from, msg, sender, args,
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
  } catch (e) {
    console.error(`[${state.phone}] RUN ERR ${rawCmd}: ${e.message}`)
    try { await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e.message}` }, { quoted: msg }) } catch {}
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
    // ── FIX: explicit browser identifier required for pairing-code flow ──
    // Multiple independently-reported Baileys bugs (issues #2306, #2197,
    // and a maintainer-patched case requiring an exact browser string)
    // confirm that without a well-formed `browser` field, WhatsApp can
    // issue a pairing code that DISPLAYS fine but whose underlying device
    // registration handshake silently fails — producing exactly this
    // symptom: code shows up, phone says "couldn't link device." This
    // was previously unset entirely in this config.
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
    try {
      state.groupCache[update.id] = { ...(await sock.groupMetadata(update.id)), _cachedAt: Date.now() }
    } catch {}

    if (typeof lib.handleGroupUpdate === "function") {
      lib.handleGroupUpdate(sock, update).catch(e =>
        console.error(`[${phone}] handleGroupUpdate ERR:`, e.message)
      )
    }

    // ── WELCOME/GOODBYE LISTENER ──
    try {
      const { id: groupId, participants, action } = update
      if (!groupId?.endsWith("@g.us")) return
      if (!["add", "remove"].includes(action)) return

      let meta
      try { meta = await sock.groupMetadata(groupId) } catch { return }

      const groupName   = meta.subject || "the group"
      const memberCount = (meta.participants || []).length
      const welcomeCmd  = require('./commands/welcome.js')
      const goodbyeCmd  = require('./commands/goodbye.js')

      for (const participantJid of participants) {
        const memberPhone = participantJid.replace("@s.whatsapp.net", "").replace(/:\d+$/, "")
        let pushName = ""
        try {
          const contact = meta.participants?.find(p => p.id === participantJid || p.id?.startsWith(memberPhone))
          pushName = contact?.notify || contact?.name || ""
        } catch {}

        const displayName = pushName || memberPhone
        const type        = action === "add" ? "welcome" : "goodbye"

        const greetData = welcomeCmd.loadGreet(phone, groupId)
        const settings  = type === "welcome" ? greetData.welcome : greetData.goodbye
        if (!settings?.enabled) {
          console.log(`[GREET:${phone}] 🔇 ${type} ${action === "add" ? "👋 JOIN" : "👣 LEAVE"} ${memberPhone} — disabled`)
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

        let ppUrl = null
        try { ppUrl = await sock.profilePictureUrl(participantJid, "image") } catch {}

        try {
          if (ppUrl) {
            await sock.sendMessage(groupId, {
              image:    { url: ppUrl },
              caption:  text,
              mentions: [participantJid],
            })
          } else {
            await sock.sendMessage(groupId, {
              text,
              mentions: [participantJid],
            })
          }
          console.log(`[GREET:${phone}] ${type === "welcome" ? "👋 WELCOME" : "👣 GOODBYE"} ${memberPhone} in ${groupName}`)
        } catch (e) {
          console.error(`[GREET:${phone}] send error:`, e.message)
        }
      }
    } catch (e) {
      console.error(`[GREET:${phone}] error:`, e.message)
    }
  })

  // ── FIX: pairing code now requested on the actual connecting/qr event,
  // not a fixed 3-second timeout. Baileys' own docs are explicit that you
  // should wait for this event before calling requestPairingCode — a
  // flat delay is a guess about readiness that can easily be wrong on a
  // cold-starting Render free-tier instance, which is exactly why NEW
  // pairings (which hit this code path) failed while already-registered
  // numbers (which skip this block entirely) kept working fine.
  let pairingCodeRequested = false
  if (!authState.creds.registered) {
    sock.ev.on("connection.update", async (update) => {
      const { connection, qr } = update
      if (pairingCodeRequested) return
      if (connection === "connecting" || !!qr) {
        pairingCodeRequested = true
        const number = phone.replace(/\D/g, "")
        try {
          const code = await sock.requestPairingCode(number)
          console.log(`[${phone}] 📱 PAIRING CODE: ${code}`)
          state.pairingCode = code
        } catch (e) {
          console.error(`[${phone}] PAIR ERR:`, e.message)
          pairingCodeRequested = false   // allow a retry on the next connecting/qr event
        }
      }
    })
  }

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
        continue
      }
      storeMessage(sock, m).catch(e => console.error(`[${phone}] storeMessage ERR:`, e.message))
      handleMessageRevocation(sock, phone, m, "upsert").catch(e =>
        console.error(`[${phone}] antideleteUpsert ERR:`, e.message)
      )
      if (!m.key.fromMe) {
        if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleBadword  === "function") lib.handleBadword(sock, m, extractBody).catch(() => {})
      }
      handleMessage(state, sock, m).catch(e => console.error(`[${phone}] MSG ERR:`, e.message))
    }
  })

  sock.ev.on("messages.update", async (updates) => {
    handleMessageRevocation(sock, phone, updates, "update").catch(e =>
      console.error(`[${phone}] antideleteUpdate ERR:`, e.message)
    )
  })

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      state.connected   = true
      state.retries     = 0
      state.pairingCode = null
      console.log(`[${phone}] ⚡ Connected — ${sock.user?.id || "unknown"}`)
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

      if (slotAssignments[phone]) {
        delete slotAssignments[phone]
      }

    } catch (e) {
      console.error(`[SESSION-GUARD] ✗ Error cleaning up ${phone}:`, e.message)
    }
  }

  saveMeta()
  saveSlotAssignments()

  const remaining = sessions.size
  console.log(`[SESSION-GUARD] ✅ Cleanup done — removed ${dead.length} dead session(s). Active sessions: ${remaining}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  await loadCommands()
  watchCommands()
  watchSupportDirs()

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
  for (let i = 0; i < 15 && !state.pairingCode && !state.connected; i++) {
    await new Promise(r => setTimeout(r, 1000))
  }
  return { phone: clean, pairingCode: state.pairingCode, connected: state.connected, slot }
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
    pairingCode:   state.pairingCode,
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
