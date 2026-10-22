// ULTRA-SPEED: the libuv thread pool defaults to 4 threads; fs / crypto / DNS
// work from many sessions queues up behind them. Must be set before first use.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(Math.min(32, Math.max(8, require("os").cpus().length * 2)))
}
require("dotenv").config()
const fs   = require("fs")
const autoVV = require('./commands/autovv')
const autoTag = require('./commands/autotag')
const path = require("path")
const Pino = require("pino")
const QRCode = require("qrcode")
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
const settingsBackup = require("./lib/settingsBackup")
const authStore = require("./lib/authStore")
const ultraExec = require("./core/ultraexec")
const sessionExecutor = require("./core/sessionexec")
const { attachResponseTextStyle, sendMessageUnstyled } = require("./core/responseTextStyle")
const charAi = require("./core/characterai")
const vmuteCore = require("./core/vmute")
const { createQuotedCommandSocket } = require("./lib/quotedCommandSocket")

// ─────────────────────────────────────────────────────────────────────────────
// LIVE RECOVERY — GRACEFUL PROCESS SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────

let shuttingDown = false

async function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[LIVE-RECOVERY] 🛑 ${signal} received — protecting sessions before exit`)

  try {
    await protectLiveSessions(signal)
  } catch (e) {
    console.error("[LIVE-RECOVERY] ✗ Shutdown protection failed:", e.message)
  }

  console.log("[LIVE-RECOVERY] ✔ Session protection checkpoint complete")

  try {
    await require("./lib/memory").flush()
  } catch (e) {
    console.error("[MEMORY] Shutdown flush failed:", e.message)
  }
}

process.once("SIGTERM", () => {
  gracefulShutdown("SIGTERM").finally(() => process.exit(0))
})

process.once("SIGINT", () => {
  gracefulShutdown("SIGINT").finally(() => process.exit(0))
})

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
const PAIRING_MODE_FILE = path.join(SESS_ROOT, "_pairing_modes.json")
const BOT_PREFIX = process.env.BOT_PREFIX || "."
const MEDIA_COMMAND_TIMEOUT_MS = (() => {
  const value = Number(process.env.MEDIA_COMMAND_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : 300000
})()
// Future media commands should use a media/download category or declare media: true.
const MEDIA_COMMAND_CATEGORIES = new Set(['media', 'download', 'sticker', 'soundeffect', 'ai', 'image', 'audio', 'video'])

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
const SLOT_COUNT    = parseInt(process.env.SLOT_COUNT    || "50", 10)
const SLOT_CAPACITY = parseInt(process.env.SLOT_CAPACITY || "1000", 10)
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
// DISABLED MODULES — files the loaders skip completely (names without .js).
// Default: "meta"  → meta.js is never loaded from lib/ utils/ api/ config/ or
// commands/, so it can no longer sit in front of command execution.
//   .env:  DISABLED_MODULES=meta,other   → skip more
//   .env:  DISABLED_MODULES=             → (empty) load everything again
// The file itself is never deleted, so this is fully reversible.
// ─────────────────────────────────────────────────────────────────────────────
const DISABLED_MODULES = new Set(
  (process.env.DISABLED_MODULES !== undefined ? process.env.DISABLED_MODULES : "meta")
    .split(",").map(s => s.trim().toLowerCase().replace(/\.js$/, "")).filter(Boolean)
)
const isDisabledModule = (file) => DISABLED_MODULES.has(String(file).toLowerCase().replace(/\.js$/, ""))

// ─────────────────────────────────────────────────────────────────────────────
// AUTO LOADER — lib / utils / api / config
// Fully active + detectable. Every .js file is required, cached by name,
// and any exported object is also flattened onto the bucket so commands can
// do lib.foo() or api.bar() without extra paths.
// ─────────────────────────────────────────────────────────────────────────────
const lib    = {}
const api    = {}
const config = {}

// Track what was loaded so anything can inspect it at runtime
const loadedModules = {
  lib:    [],
  utils:  [],
  api:    [],
  config: [],
}

function loadDir(dir, bucket, label, trackKey) {
  if (!fs.existsSync(dir)) {
    console.log(`[${label}] ℹ folder missing — creating: ${dir}`)
    try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    return 0
  }

  let ok = 0, fail = 0
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()

  for (const file of files) {
    if (isDisabledModule(file)) {
      console.log(`[${label}] ⛔ ${file} skipped (disabled — see DISABLED_MODULES)`)
      continue
    }
    try {
      const full = path.join(dir, file)
      // Clear cache so hot-reload always picks up the latest version
      try { delete require.cache[require.resolve(full)] } catch {}
      const exp = require(full)
      const name = path.basename(file, ".js")

      // Always store under the filename
      bucket[name] = exp

      // Flatten object exports so lib.handleAntibot, api.fetch, etc. work directly
      if (exp && typeof exp === "object" && !Array.isArray(exp)) {
        for (const [k, v] of Object.entries(exp)) {
          if (k === "default") continue
          bucket[k] = v
        }
      }

      // Also attach common default export patterns
      if (exp && typeof exp === "function") {
        bucket[name] = exp
      }

      loadedModules[trackKey] = loadedModules[trackKey] || []
      if (!loadedModules[trackKey].includes(name)) loadedModules[trackKey].push(name)

      console.log(`[${label}] ✔ ${file}`)
      ok++
    } catch (e) {
      console.error(`[${label}] ✗ ${file}: ${e.message}`)
      fail++
    }
  }

  return ok
}

function loadAllSupportDirs() {
  // Reset tracking lists on full reload
  loadedModules.lib    = []
  loadedModules.utils  = []
  loadedModules.api    = []
  loadedModules.config = []

  const libCount    = loadDir(LIB_DIR,    lib,    "LIB",    "lib")
  const utilsCount  = loadDir(UTILS_DIR,  lib,    "UTILS",  "utils")   // utils also land on lib
  const apiCount    = loadDir(API_DIR,    api,    "API",    "api")
  const configCount = loadDir(CONFIG_DIR, config, "CONFIG", "config")

  console.log(
    `[AUTO-LOAD] ✔ Active → LIB:${libCount}  UTILS:${utilsCount}  API:${apiCount}  CONFIG:${configCount}`
  )
  console.log(
    `[AUTO-LOAD] Detectable modules → lib:[${loadedModules.lib.join(", ") || "none"}] ` +
    `utils:[${loadedModules.utils.join(", ") || "none"}] ` +
    `api:[${loadedModules.api.join(", ") || "none"}] ` +
    `config:[${loadedModules.config.join(", ") || "none"}]`
  )
}

// Make the loaded lists and buckets globally detectable
global.__lib     = lib
global.__api     = api
global.__config  = config
global.__loaded  = loadedModules

loadAllSupportDirs()

let supportWatchStarted = false
function watchSupportDirs() {
  if (supportWatchStarted) return
  supportWatchStarted = true
  let debounce = null

  for (const [dir, label] of [
    [LIB_DIR,    "LIB"],
    [UTILS_DIR,  "UTILS"],
    [API_DIR,    "API"],
    [CONFIG_DIR, "CONFIG"],
  ]) {
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    }
    try {
      fs.watch(dir, { persistent: false }, (_, f) => {
        if (!f?.endsWith(".js")) return
        clearTimeout(debounce)
        debounce = setTimeout(() => {
          loadAllSupportDirs()
          console.log(`[${label}] ↺ hot-reloaded (${f} changed)`)
        }, 150)
      })
      console.log(`[WATCH] 👀 Watching ${label} folder for changes`)
    } catch (e) {
      console.warn(`[WATCH] could not watch ${label}:`, e.message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMP FILE CLEANUP — safe, age-based cleanup of disposable files only
// ─────────────────────────────────────────────────────────────────────────────
const { startTempCleanup } = require("./lib/tempCleanup")
startTempCleanup(TEMP_DIR) // startup + hourly; files older than 3 hours only

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
  `Restart threshold: ${MAX_RAM_MB}MB ${process.env.MAX_RAM_MB ? "(manual override via .env)" : "(auto-calculated)"}`
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
// EVENT-LOOP LAG MONITOR — Node.js runs all sessions on ONE thread (one CPU core).
// If this number is high, commands are slow because that single thread is
// saturated — not because of any one command. Visible via .execstats and logged
// as a warning (at most once a minute) when p99 lag goes above LOOP_WARN_MS.
// ─────────────────────────────────────────────────────────────────────────────
const LOOP_WARN_MS = parseInt(process.env.LOOP_WARN_MS || "120", 10)
let _loopHist = null
let _loopLast = null
let _loopLastWarn = 0
try {
  const { monitorEventLoopDelay } = require("perf_hooks")
  _loopHist = monitorEventLoopDelay({ resolution: 20 })
  _loopHist.enable()
} catch {}

const _loopTimer = setInterval(() => {
  if (!_loopHist) return
  // the histogram includes the 20ms sampling interval itself — subtract it so 0 = no lag
  const toMs = n => Math.max(0, Math.round((n / 1e6 - 20) * 10) / 10)
  _loopLast = {
    p50: toMs(_loopHist.percentile(50)),
    p99: toMs(_loopHist.percentile(99)),
    max: toMs(_loopHist.max),
    at:  Date.now(),
  }
  _loopHist.reset()
  if (_loopLast.p99 > LOOP_WARN_MS && Date.now() - _loopLastWarn > 60_000) {
    _loopLastWarn = Date.now()
    console.warn(`[LOOP] ⚠ event-loop lag p99=${_loopLast.p99}ms max=${_loopLast.max}ms — the single Node.js thread is saturated; heavy sessions should be spread over more processes`)
  }
}, 10_000)
if (_loopTimer.unref) _loopTimer.unref()

global.__loopStats = () => _loopLast

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
const REMOVED_COMMAND_FILES = new Set(["update.js", "channelid.js"])

function loadFile(file) {
  if (REMOVED_COMMAND_FILES.has(String(file).toLowerCase())) {
    console.log(`[CMD] ⛔ ${file} skipped (command removed)`)
    return false
  }
  if (isDisabledModule(file)) {
    console.log(`[CMD] ⛔ ${file} skipped (disabled — see DISABLED_MODULES)`)
    return false
  }
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
  console.log("║         ⚡ ZENX — COMMAND REGISTRY        ║")
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
// JID NORMALIZER — "2349011111111:5@s.whatsapp.net" / "123@lid" → digits only
// ─────────────────────────────────────────────────────────────────────────────
function normalizeNum(raw = "") {
  return String(raw || "").replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
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

async function checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner, fromMe = false, verifyOwnerRole = false) {
  const candidates = [sender, senderAlt]
  // For an outgoing command, the group message may omit its participant JID.
  // In that case use the connected account's own WhatsApp identities.
  if (fromMe) candidates.push(sock?.user?.id, sock?.user?.lid)
  const candidateNums = candidates.filter(Boolean).map(normalizeNum).filter(Boolean)

  let meta = null
  if (isOwner && verifyOwnerRole) {
    // This is the one path that needs a current WhatsApp role before deciding
    // whether to show the owner-specific notice.
    try { meta = await getGroupMetaForCommand(sock, state.phone, from) } catch {}
  } else {
    // Keep ordinary admin checks fast: use the existing cache and refresh stale
    // data in the background. A cold cache still gets one awaited lookup.
    meta = state.groupCache[from]
    if (!meta || !Array.isArray(meta.participants)) {
      try { meta = await refreshGroupMeta(state, sock, from) } catch {}
    } else if (Date.now() - (meta._cachedAt || 0) > 5 * 60 * 1000) {
      refreshGroupMeta(state, sock, from).catch(() => {})
    }
  }
  const hasParticipants = Array.isArray(meta?.participants) && meta.participants.length > 0
  let isActualGroupAdmin = null
  if (hasParticipants) {
    const actualAdminSet = new Set(
      meta.participants
        .filter(p => p.admin === "admin" || p.admin === "superadmin")
        .flatMap(p => [p.id, p.lid, p.phoneNumber, p.jid])
        .filter(Boolean)
        .map(normalizeNum)
        .filter(Boolean)
    )
    isActualGroupAdmin = candidateNums.some(n => actualAdminSet.has(n))
  }

  // Bot-owner authorization does not grant the connected WhatsApp account
  // admin rights. Keep the owner override for sender authorization, while
  // always reporting the bot account's actual role for API operations.
  const adminCache = meta?.participants
    ? { ...state.groupCache, [from]: meta }
    : state.groupCache
  let isBotAdmin = false
  try { isBotAdmin = isAdminLib.isBotAdmin(adminCache, from, sock) } catch {}
  if (isOwner) return { isAdmin: true, isBotAdmin, isActualGroupAdmin }
  if (!Array.isArray(meta?.participants) || !meta.participants.length) {
    return { isAdmin: false, isBotAdmin: false, isActualGroupAdmin }
  }

  if (SUDO_NUMBERS.length && candidateNums.some(n => SUDO_NUMBERS.includes(n)))
    return { isAdmin: true, isBotAdmin, isActualGroupAdmin }
  let isAdmin = false
  try { isAdmin = isAdminLib.isAdmin(state.groupCache, from, sender, sock, null, senderAlt) } catch {}
  if (!isAdmin && meta?.participants) {
    const adminSet = new Set(
      meta.participants.filter(p => p.admin === "admin" || p.admin === "superadmin").map(p => normalizeNum(p.id))
    )
    isAdmin = candidateNums.some(n => adminSet.has(n))
  }
  return { isAdmin, isBotAdmin, isActualGroupAdmin }
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
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n ${body}\n╚══════════════════════════╝\n\n© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
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

let pairingModes = {}
try {
  if (fs.existsSync(PAIRING_MODE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(PAIRING_MODE_FILE, "utf8"))
    if (saved && typeof saved === "object" && !Array.isArray(saved)) pairingModes = saved
  }
} catch (e) {
  console.error("[PAIRING] mode restore failed:", e.message)
}

function savePairingModes() {
  try {
    fs.mkdirSync(SESS_ROOT, { recursive: true })
    fs.writeFileSync(PAIRING_MODE_FILE, JSON.stringify(pairingModes, null, 2))
  } catch (e) {
    console.error("[PAIRING] mode save failed:", e.message)
  }
}

function setPairingMode(phone, mode) {
  const nextMode = mode === "qr" ? "qr" : "pair"
  const changed = nextMode === "qr" ? pairingModes[phone] !== "qr" : !!pairingModes[phone]
  if (nextMode === "qr") pairingModes[phone] = "qr"
  else delete pairingModes[phone]
  if (changed) savePairingModes()
  const state = sessions.get(phone)
  if (state) state.pairingMode = nextMode
}

// ─────────────────────────────────────────────────────────────────────────────
// ULTRA SPEED — group metadata served from each session's own cache.
// Stale-while-revalidate: a cached group answers instantly and is refreshed
// in the background; only a COLD cache waits for the network. Admin changes
// still arrive through "group-participants.update", which refreshes the cache.
// ─────────────────────────────────────────────────────────────────────────────
const _gmInflight = new Map()
// The socket is created with defaultQueryTimeoutMs: undefined (no query timeout), so a
// stuck groupMetadata request would freeze whatever command is waiting on it forever.
// This caps the wait; the command then carries on without fresh metadata.
const GROUP_META_TIMEOUT_MS = parseInt(process.env.GROUP_META_TIMEOUT_MS || "8000", 10)

function refreshGroupMeta(state, sock, jid) {
  const key = state.phone + ":" + jid
  if (_gmInflight.has(key)) return _gmInflight.get(key)

  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("groupMetadata timed out")), GROUP_META_TIMEOUT_MS)
  })

  const p = Promise.race([Promise.resolve(sock.groupMetadata(jid)), timeout])
    .then(meta => {
      state.groupCache[jid] = { ...meta, _cachedAt: Date.now() }
      return state.groupCache[jid]
    })
    .finally(() => { clearTimeout(timer); _gmInflight.delete(key) })

  _gmInflight.set(key, p)
  return p
}

async function getGroupMetaCached(sock, phone, jid) {
  const state = sessions.get(phone)
  const hit = state && state.groupCache ? state.groupCache[jid] : null
  if (hit && Array.isArray(hit.participants) && hit.participants.length) {
    if (Date.now() - (hit._cachedAt || 0) > 60000) refreshGroupMeta(state, sock, jid).catch(() => {})
    return hit
  }
  if (state) return refreshGroupMeta(state, sock, jid)
  return sock.groupMetadata(jid)
}

// Command metadata requests share the session cache and one in-flight fetch.
// A recently refreshed group answers immediately; missing or stale metadata
// must load successfully before a metadata-dependent command can continue.
async function getGroupMetaForCommand(sock, phone, jid) {
  const state = sessions.get(phone)
  const hit = state?.groupCache?.[jid]
  const cachedAt = Number(hit?._cachedAt) || 0
  if (
    hit && Array.isArray(hit.participants) && hit.participants.length &&
    cachedAt > 0 && Date.now() - cachedAt <= 60_000
  ) return hit
  if (state) return refreshGroupMeta(state, sock, jid)
  return sock.groupMetadata(jid)
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE SESSION RECOVERY PROTECTION
// ─────────────────────────────────────────────────────────────────────────────
// This is an additive safety layer on top of the existing VPS SQLite auth.
//
// Rules:
//   OPEN / connected       -> mark LIVE
//   reconnecting / close  -> keep LIVE marker
//   server restart        -> preserve LIVE sessions
//   explicit loggedOut    -> remove LIVE marker
//
// A temporary disconnect, slow reconnect, timeout, or server restart must
// NEVER erase a session. Only WhatsApp's explicit DisconnectReason.loggedOut
// is allowed to permanently remove it.

const LIVE_SESSIONS_FILE = path.join(__dirname, "data", "live-sessions.json")

function readLiveSessions() {
  try {
    if (!fs.existsSync(LIVE_SESSIONS_FILE)) return {}
    const data = JSON.parse(fs.readFileSync(LIVE_SESSIONS_FILE, "utf8"))
    return data && typeof data === "object" ? data : {}
  } catch (e) {
    console.error("[LIVE-RECOVERY] ✗ Failed to read live-session manifest:", e.message)
    return {}
  }
}

function writeLiveSessions(data) {
  try {
    fs.mkdirSync(path.dirname(LIVE_SESSIONS_FILE), { recursive: true })
    const tmp = `${LIVE_SESSIONS_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, LIVE_SESSIONS_FILE)
  } catch (e) {
    console.error("[LIVE-RECOVERY] ✗ Failed to write live-session manifest:", e.message)
  }
}

function markSessionLive(phone, extra = {}) {
  const clean = String(phone || "").replace(/\D/g, "")
  if (!clean) return

  const live = readLiveSessions()

  live[clean] = {
    phone: clean,
    live: true,
    lastConfirmedOpenAt: Date.now(),
    lastConfirmedOpenWAT: nowWAT(),
    ...extra,
  }

  writeLiveSessions(live)
  console.log(`[LIVE-RECOVERY] 🟢 ${clean} marked LIVE`)
}

function keepSessionProtected(phone, reason = "temporary disconnect") {
  const clean = String(phone || "").replace(/\D/g, "")
  if (!clean) return

  const live = readLiveSessions()

  // IMPORTANT:
  // Do not create a LIVE record for a session that has never successfully
  // opened. Existing protection is retained only for sessions already
  // confirmed by WhatsApp.
  if (!live[clean]) return

  live[clean].live = true
  live[clean].lastProtectedAt = Date.now()
  live[clean].lastProtectedReason = reason

  writeLiveSessions(live)
  console.log(`[LIVE-RECOVERY] 🛡 ${clean} protected — ${reason}`)
}

function removeSessionFromLiveProtection(phone) {
  const clean = String(phone || "").replace(/\D/g, "")
  if (!clean) return

  const live = readLiveSessions()

  if (live[clean]) {
    delete live[clean]
    writeLiveSessions(live)
    console.log(`[LIVE-RECOVERY] 🔴 ${clean} removed — WhatsApp confirmed loggedOut`)
  }
}

function getProtectedLivePhones() {
  return Object.keys(readLiveSessions())
    .map(p => String(p).replace(/\D/g, ""))
    .filter(Boolean)
}

async function protectLiveSessions(reason = "server restart") {
  const live = readLiveSessions()
  const protectedPhones = []

  // IMPORTANT FIRST-BOOT SAFETY:
  // Some sessions may already be OPEN before this protection layer was
  // installed. Capture those live sockets now so the first restart cannot
  // accidentally leave them unprotected.
  for (const [phone, state] of sessions.entries()) {
    if (!state?.connected || !state?.sock) continue

    const existing = live[phone] || {}

    live[phone] = {
      ...existing,
      phone,
      live: true,
      lastConfirmedOpenAt: existing.lastConfirmedOpenAt || Date.now(),
      lastConfirmedOpenWAT: existing.lastConfirmedOpenWAT || nowWAT(),
      waId: state.sock.user?.id || existing.waId || null,
      connected: true,
      lastShutdownProtectedAt: Date.now(),
      lastShutdownReason: reason,
      lastShutdownWasConnected: true,
    }

    console.log(`[LIVE-RECOVERY] 🟢 ${phone} currently OPEN — captured before shutdown`)
  }

  for (const [phone, record] of Object.entries(live)) {
    const state = sessions.get(phone)

    // Only sessions that have previously been confirmed OPEN are eligible
    // for restart protection. Never erase a missing/slow session here.
    if (!record?.live) continue

    protectedPhones.push(phone)

    if (state?.connected && state?.sock) {
      record.lastShutdownProtectedAt = Date.now()
      record.lastShutdownReason = reason
      record.lastShutdownWasConnected = true

      // Force the current credentials through the existing SQLite auth path.
      try {
        const auth = await authStore.useAuthState(phone, state.sessDir)
        await auth.saveCreds()
        console.log(`[LIVE-RECOVERY] 💾 ${phone} durable auth checkpoint saved`)
      } catch (e) {
        console.error(`[LIVE-RECOVERY] ⚠ ${phone} auth checkpoint failed:`, e.message)
      }
    } else {
      // DO NOT remove it. A slow/reconnecting session remains protected.
      record.lastShutdownProtectedAt = Date.now()
      record.lastShutdownReason = `${reason} — session not currently open; preserved`
      record.lastShutdownWasConnected = false

      console.log(`[LIVE-RECOVERY] 🛡 ${phone} preserved while not currently open`)
    }
  }

  writeLiveSessions(live)

  console.log(
    `[LIVE-RECOVERY] 🛡 Protected ${protectedPhones.length} LIVE session(s): ` +
    `${protectedPhones.join(", ") || "(none)"}`
  )

  return protectedPhones
}

function getLiveRecoveryManifest() {
  return readLiveSessions()
}

function saveLiveRecoveryManifest() {
  writeLiveSessions(readLiveSessions())
}

function makeSessionSettings(phone) {
  return settingsLib.forUser(phone)
}

// Small TTL cache with Baileys' CacheStore shape (get / set / del / flushAll).
// Used for msgRetryCounterCache, which Baileys docs say should live OUTSIDE the
// socket — so retry counters survive reconnects instead of restarting retry loops.
function makeTtlCache(ttlMs = 60 * 60 * 1000, maxEntries = 5000) {
  const m = new Map()
  return {
    get(key) {
      const hit = m.get(key)
      if (!hit) return undefined
      if (Date.now() > hit.exp) { m.delete(key); return undefined }
      return hit.v
    },
    set(key, value) {
      if (m.size >= maxEntries) m.delete(m.keys().next().value)   // drop the oldest entry
      m.set(key, { v: value, exp: Date.now() + ttlMs })
    },
    del(key) { m.delete(key) },
    flushAll() { m.clear() },
  }
}

function makeSessionState(phone) {
  const sessDir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })
  return {
    phone, sessDir,
    pairingMode: pairingModes[phone] === "qr" ? "qr" : "pair",
    authRegistered: false,
    qrDataUrl: null,
    qrExpiresAt: null,
    qrVersion: 0,
    settings:      makeSessionSettings(phone),
    groupCache:    {},
    msgRetryCounterCache: makeTtlCache(),
    retries:       0,
    sock:                 null,
    connected:            false,
    startingUp:           false,
    pairingCode:          null,
    pairingCodeExpiresAt: null,
    lastPairingAttemptAt: null,
    presenceTimer:        null,
  }
}

function nowWAT() {
  return new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })
}

// Known-good WA web version to fall back on if fetchLatestBaileysVersion()
// ever returns something stale (it has, in the wild) — never let the socket
// go out with an older version than we've already seen work.
let LAST_GOOD_WA_VERSION = null
async function getSafeWaVersion() {
  try {
    const { version, isLatest } = await fetchLatestBaileysVersion()
    if (!LAST_GOOD_WA_VERSION || version[2] >= LAST_GOOD_WA_VERSION[2]) {
      LAST_GOOD_WA_VERSION = version
    }
    if (!isLatest) {
      console.log(`[WA-VERSION] ⚠ fetchLatestBaileysVersion reports non-latest (${version.join(".")}) — using it anyway, watching for drift`)
    }
    return LAST_GOOD_WA_VERSION
  } catch (e) {
    console.error("[WA-VERSION] fetch failed, reusing last known-good version:", e.message)
    return LAST_GOOD_WA_VERSION
  }
}

// Prevents the same status line from spamming the log on every reconnect tick —
// only prints when the message actually changed for that phone+key.
const _lastLog = new Map()
function logOnce(phone, key, msg, level = "log") {
  const id = `${phone}:${key}`
  if (_lastLog.get(id) === msg) return
  _lastLog.set(id, msg)
  console[level](msg)
}

const PAIRING_CODE_TTL_MS = 60 * 1000
const PAIRING_QR_TTL_MS = 19 * 1000
const PAIRING_WELCOME_IMAGE_URL = "https://img.magnific.com/premium-photo/blue-holographic-human-face-made-up-digital-pixels-surrounded-by-network-nodes_1279828-3025.jpg?w=2000"
const PAIRING_WELCOME_CAPTION =
  '╭──────「 CONNECTION SUCCESSFUL 」──────╮\n' +
  '│ ✅ Bot paired successfully\n' +
  '│ 🤖 Send .menu to view available commands\n' +
  '╰─────────────────────────────────────╯'
const PAIRING_WELCOME_PENDING_FILE = path.join(__dirname, "data", "pairing-welcome-pending.json")

function loadPairingWelcomePending() {
  try {
    const stored = JSON.parse(fs.readFileSync(PAIRING_WELCOME_PENDING_FILE, "utf8"))
    return new Set(Array.isArray(stored) ? stored.map(String) : [])
  } catch { return new Set() }
}

const pairingWelcomePending = loadPairingWelcomePending()
const pairingWelcomeSending = new Set()

function persistPairingWelcomePending() {
  const temporary = `${PAIRING_WELCOME_PENDING_FILE}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(PAIRING_WELCOME_PENDING_FILE), { recursive: true })
    fs.writeFileSync(temporary, JSON.stringify([...pairingWelcomePending], null, 2))
    fs.renameSync(temporary, PAIRING_WELCOME_PENDING_FILE)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    console.error(`[PAIR-WELCOME] pending state save failed: ${error.message}`)
  }
}

function setPairingWelcomePending(phone, pending) {
  const clean = String(phone || "").replace(/\D/g, "")
  if (!clean) return
  if (pending) pairingWelcomePending.add(clean)
  else pairingWelcomePending.delete(clean)
  persistPairingWelcomePending()
}

async function sendPairingWelcome(sock, phone) {
  if (!pairingWelcomePending.has(phone) || pairingWelcomeSending.has(phone)) return
  pairingWelcomeSending.add(phone)
  try {
    const recipient = `${phone}@s.whatsapp.net`
    await sock.sendMessage(recipient, {
      image: { url: PAIRING_WELCOME_IMAGE_URL },
      caption: PAIRING_WELCOME_CAPTION,
      mimetype: "image/jpeg",
    })
    setPairingWelcomePending(phone, false)
    console.log(`[${phone}] 📨 Pairing welcome image sent`)
  } catch (error) {
    console.error(`[${phone}] Pairing welcome send failed; will retry on reconnect: ${error.message}`)
  } finally {
    pairingWelcomeSending.delete(phone)
  }
}

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

function getValidPairingQr(state) {
  if (!state.qrDataUrl) return null
  if (!state.qrExpiresAt || Date.now() >= state.qrExpiresAt) {
    state.qrDataUrl = null
    state.qrExpiresAt = null
    return null
  }
  return state.qrDataUrl
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
// AUTO PRESENCE — typing (30s) / recording (30s), fired on ANY sign of
// activity in a chat: ordinary messages, commands, and reactions. Always
// fire-and-forget (never awaited by the caller) so it never delays a
// command's actual response.
//
// Two speed fixes applied here:
//   1. Dropped presenceSubscribe() — it's for RECEIVING the other party's
//      presence, not required to SEND your own. It was a pure extra
//      network round-trip on every single trigger for no benefit.
//   2. startAutoPresence() below defers the actual first network call via
//      setImmediate — on the command path this guarantees the command's
//      own reply gets enqueued on the socket first, so the presence
//      simulation can never end up ahead of it in the outgoing queue.
// ─────────────────────────────────────────────────────────────────────────────
async function triggerAutoPresence(state, sock, from) {
  const s = state.settings

  // Auto typing — 30 second WhatsApp presence window.
  if (s.get("autoTyping")) {
    try {
      await sock.sendPresenceUpdate("composing", from)
      await helper.sleep(30000)
      await sock.sendPresenceUpdate("paused", from)
    } catch {}
  }

  // Auto recording — 30 second presence window. Runs after typing when
  // both are on (back-to-back, not simultaneous — WhatsApp only shows
  // one presence indicator at a time anyway).
  if (s.get("autoRecording")) {
    try {
      await sock.sendPresenceUpdate("recording", from)
      await helper.sleep(30000)
      await sock.sendPresenceUpdate("paused", from)
    } catch {}
  }
}

// Use this at every fire-and-forget call site instead of calling
// triggerAutoPresence directly — setImmediate pushes the first network
// call to the next event-loop tick, after whatever synchronous dispatch
// work (command lookup, the start of the command's own reply) is already
// underway.
function startAutoPresence(state, sock, from) {
  setImmediate(() => {
    triggerAutoPresence(state, sock, from).catch(() => {})
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDINARY MESSAGE SIDE EFFECTS
// ─────────────────────────────────────────────────────────────────────────────
async function handleOrdinaryMessage(state, sock, msg, from) {
  const s = state.settings

  // ULTRA SPEED: fire-and-forget — the auto-reply no longer waits ~30s for the
  // typing / recording indicator to finish.
  startAutoPresence(state, sock, from)

  // Auto reply.
  if (s.get("autoReply")) {
    const prefix = s.get("prefix") || BOT_PREFIX
    const text = (s.get("autoReplyText") || "").replace(/\{prefix\}/g, prefix)

    if (text) {
      try {
        await sock.sendMessage(
          from,
          { text },
          { quoted: msg }
        )
      } catch {}
    }
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
  let type = "text", text = "", mediaBuffer = null, mimetype = null, caption = "", ptt = false, gifPlayback = false, fileName = null, seconds = null, isAnimatedSticker = false
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
    } else if (inner.documentMessage) {
      type = "document"; caption = inner.documentMessage.caption || ""
      mimetype = inner.documentMessage.mimetype || "application/octet-stream"
      fileName = inner.documentMessage.fileName || "file"
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else if (inner.stickerMessage) {
      type = "sticker"; mimetype = inner.stickerMessage.mimetype || "image/webp"
      isAnimatedSticker = !!inner.stickerMessage.isAnimated
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else if (inner.audioMessage) {
      ptt = !!inner.audioMessage.ptt; type = ptt ? "voice" : "audio"
      mimetype = inner.audioMessage.mimetype || "audio/ogg"
      seconds = inner.audioMessage.seconds || null
      mediaBuffer = await antideleteDownloadSafe(msg, sock)
    } else { type = "other" }
  } catch (e) { console.error("[ANTIDELETE] storeMessage error:", e.message) }
  antideleteCache.set(msg.key.id, {
    jid, sender, senderAlt, timestamp, type, text, caption,
    mediaBuffer, mimetype, ptt, gifPlayback, fileName, seconds, isAnimatedSticker, cachedAt: Date.now(),
  })
  antideleteOrder.push(msg.key.id)
  antideleteEvictIfNeeded()
}

function fmtDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return null
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
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

// ── ANTI-DELETE OUTPUT TEMPLATES — spacing matches the approved layout ──
const AD_TOP     = "╔════════════════════════════════╗\n║     🛡️ *ANTI-DELETE SYSTEM*     ║\n╚════════════════════════════════╝"
const AD_BOX_END = "└── ─────────────────────────────"
const AD_RULE_33 = "─────────────────────────────────"
const AD_RULE_30 = "──────────────────────────────"

// Field lines shared by every template. "Sender by" is the original Sender line.
function adFields(i) {
  return {
    where:     `│ 📍 *Where:* ${i.where}`,
    deletedBy: `│ 🗑️ *Deleted by:* ${i.deletedBy}`,
    senderBy:  `│ 👤 *Sender by:* ${i.senderBy}`,
  }
}

function adTextBox(i, text) {
  const f = adFields(i)
  return [
    AD_TOP, "",
    "┌── ⚠️ *EVENT DETECTED*",
    f.where, "", "",
    f.deletedBy, "", "",
    f.senderBy, "", "",
    "│ 📂 *Type:* Text Message", "", "",
    `│ 🕒 *Time:* ${i.when}`, "",
    "└── 📌 *Status:* Recovered Successfully", "",
    "┌── 📝 *DELETED MESSAGES*",
    "│",
    `│ ${text}`,
    "│",
    AD_BOX_END, "", "",
    AD_RULE_33,
  ].join("\n")
}

function adMediaBox(i, typeLabel, caption) {
  const f = adFields(i)
  return [
    AD_TOP, "",
    "┌── ⚠️ *EVENT DETECTED*",
    f.where, "",
    f.deletedBy, "",
    f.senderBy, "",
    `│ 📂 *Type:* ${typeLabel}`, "",
    `│ 🕒 *Time:* ${i.when}`, "", "",
    "└── 📌 *Status:* Media Recovered", "", "", "", "",
    "┌── 📝 *MEDIA CAPTION*",
    "│",
    `│ ${caption}`,
    "│",
    AD_BOX_END, "", "", "",
    AD_RULE_30,
  ].join("\n")
}

function adStickerBox(i, detail) {
  const f = adFields(i)
  return [
    AD_TOP, "",
    "┌── ⚠️ *EVENT DETECTED*",
    f.where, "", "",
    f.deletedBy, "", "",
    f.senderBy, "", "", "",
    "│ 📂 *Type:* Sticker 🎨", "", "",
    `│ 🕒 *Time:* ${i.when}`, "", "",
    "└── 📌 *Status:* Sticker Recovered", "",
    "┌── 🧩 *MEDIA DETAILS*",
    "│",
    `│ ${detail}`,
    "│",
    AD_BOX_END, "",
    "🔗 *Sticker below 👇🏻*", "", "",
    AD_RULE_33,
  ].join("\n")
}

function adAudioBox(i, typeLabel, detail) {
  const f = adFields(i)
  return [
    AD_TOP, "",
    "┌── ⚠️ *EVENT DETECTED*",
    f.where,
    f.deletedBy,
    f.senderBy,
    `│ 📂 *Type:* ${typeLabel}`,
    `│ 🕒 *Time:* ${i.when}`,
    "└── 📌 *Status:* Audio Recovered", "",
    "┌── 🎵 *AUDIO DETAILS*",
    "│",
    `│ ${detail}`,
    "│",
    AD_BOX_END, "",
    "🔗 *Audio below 👇🏻*", "", "",
    AD_RULE_33,
  ].join("\n")
}

async function antideleteReport(sock, phone, proto, deleterKey) {
  if (!antideleteGetEnabled(phone)) return
  const deletedId = proto.key?.id
  if (!deletedId) return
  const cached = antideleteCache.get(deletedId)
  if (!cached) return

  const chatJid    = deleterKey.remoteJid
  const isGroup    = (chatJid || "").endsWith("@g.us")
  const deleterJid = deleterKey.participant || chatJid
  const senderJid  = cached.sender
  const tag = (jid) => "@" + (jid || "").split("@")[0].split(":")[0]

  // Where: DM -> tag of the person you're chatting with; group -> full group name.
  let where
  if (isGroup) {
    try {
      const meta = await sock.groupMetadata(chatJid)
      where = meta.subject || chatJid
    } catch { where = chatJid }
  } else {
    where = tag(chatJid)
  }

  // Real WhatsApp mentions so every @tag above is a live tag.
  const mentions = [...new Set([senderJid, deleterJid, ...(isGroup ? [] : [chatJid])].filter(Boolean))]
  const info = {
    where,
    deletedBy: tag(deleterJid),
    senderBy:  tag(senderJid),
    when:      new Date(cached.timestamp * 1000).toLocaleString(),
  }
  const ownerJid = `${phone}@s.whatsapp.net`
  const sendRecovered = (jid, content, ...options) =>
    sendMessageUnstyled(sock, jid, content, ...options)

  try {
    if (cached.type === "text") {
      await sendRecovered(ownerJid, { text: adTextBox(info, cached.text || "(empty)"), mentions })

    } else if (cached.mediaBuffer && ["image", "video", "gif", "document"].includes(cached.type)) {
      const typeLabel =
        cached.type === "image"    ? "Photo" :
        cached.type === "video"    ? "Video" :
        cached.type === "gif"      ? "Video (GIF)" :
        `Document${cached.fileName ? ` (${cached.fileName})` : ""}`
      const box = adMediaBox(info, typeLabel, cached.caption || "No Caption")
      if (cached.type === "image") {
        await sendRecovered(ownerJid, { image: cached.mediaBuffer, caption: box, mentions })
      } else if (cached.type === "document") {
        await sendRecovered(ownerJid, { document: cached.mediaBuffer, mimetype: cached.mimetype, fileName: cached.fileName || "file", caption: box, mentions })
      } else {
        await sendRecovered(ownerJid, { video: cached.mediaBuffer, gifPlayback: cached.gifPlayback, caption: box, mentions })
      }

    } else if (cached.mediaBuffer && cached.type === "sticker") {
      const detail = cached.isAnimatedSticker ? "Animated Sticker" : "Sticker Content"
      await sendRecovered(ownerJid, { text: adStickerBox(info, detail), mentions })
      await sendRecovered(ownerJid, { sticker: cached.mediaBuffer })

    } else if (cached.mediaBuffer && (cached.type === "voice" || cached.type === "audio")) {
      const typeLabel = cached.type === "voice" ? "Voice Note 🎙️" : "Audio 🎵"
      const dur = fmtDuration(cached.seconds)
      const detail = dur ? `Duration: ${dur}` : (cached.type === "voice" ? "[Voice Note]" : "[Audio]")
      await sendRecovered(ownerJid, { text: adAudioBox(info, typeLabel, detail), mentions })
      await sendRecovered(ownerJid, { audio: cached.mediaBuffer, ptt: cached.ptt, mimetype: cached.mimetype || "audio/ogg" })

    } else {
      await sendRecovered(ownerJid, { text: `🛡️ *ANTI-DELETE* — ${cached.type} deleted but its content could not be recovered.\n📍 *Where:* ${info.where}\n🗑️ *Deleted by:* ${info.deletedBy}\n👤 *Sender by:* ${info.senderBy}`, mentions })
    }
  } catch (e) {
    console.error("[ANTIDELETE] failed to report deletion to owner:", e.message)
  }

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
// ULTRA SPEED — 2s in-memory cache for the per-session JSON stores
// (antilink / antitag / antistatus / custom commands). These used to read and
// parse a file from disk on EVERY message. Saves update the cache immediately.
// ─────────────────────────────────────────────────────────────────────────────
const FILE_CACHE_TTL_MS = 2000
const antilinkCache   = new Map()
const antitagCache    = new Map()
const antistatusCache = new Map()
const customCmdCache  = new Map()

function cacheGet(cache, phone) {
  const hit = cache.get(phone)
  return hit && Date.now() - hit.t < FILE_CACHE_TTL_MS ? hit.v : null
}
function cacheSet(cache, phone, v) {
  cache.set(phone, { v, t: Date.now() })
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
  const cached = cacheGet(antilinkCache, phone)
  if (cached) return cached
  const file = antilinkFilePath(phone)
  let data = null
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTILINK] load error for ${phone}:`, e.message)
  }
  if (!data) data = { groups: {}, warnings: {} }
  cacheSet(antilinkCache, phone, data)
  return data
}
function antilinkSave(phone, data) {
  try {
    fs.writeFileSync(antilinkFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTILINK] save error for ${phone}:`, e.message)
  }
  cacheSet(antilinkCache, phone, data)
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
    try { groupMeta = await getGroupMetaCached(sock, phone, groupId) } catch (e) {
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
        text: `╔════════════════════╗\n║  🔗 *LINK DETECTED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *BLOCKED* 〕─────\n│ 👤 *User:* @${tag}\n│ ❌ Links are *NOT* allowed here!${ocrNote}\n│ 🗑️ Message has been deleted.\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
        mentions: [sender]
      })
    } else if (action === "kick") {
      await sock.sendMessage(groupId, {
        text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *INSTANT KICK* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 *Reason:* Posted a link${ocrNote}\n│ ⚡ *Mode:* Strict — no warnings given\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
        mentions: [sender]
      })
      try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
      catch (e) { console.error("[ANTILINK] kick failed:", e.message) }
    } else if (action === "warn") {
      const warns = antilinkAddWarning(phone, groupId, sender)
      const maxWarns = 3
      if (warns >= maxWarns) {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ACTION TAKEN* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🔗 *Reason:* Sending links repeatedly${ocrNote}\n│ 👢 *Status:* Removed from group\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
          mentions: [sender]
        })
        try { await sock.groupParticipantsUpdate(groupId, [sender], "remove") }
        catch (e) { console.error("[ANTILINK] warn-kick failed:", e.message) }
      } else {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  ⚠️ *LINK WARNING!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *WARNING* 〕─────\n│ 👤 *User:* @${tag}\n│ 🔗 Links are *NOT* allowed here!${ocrNote}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 🗑️ Message deleted\n│ ⚡ *${maxWarns - warns} more = KICK!*\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
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
  const cached = cacheGet(customCmdCache, phone)
  if (cached) return cached
  const file = customCmdFilePath(phone)
  let data = null
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[CUSTOMCMD] load error for ${phone}:`, e.message)
  }
  if (!data) data = {}
  cacheSet(customCmdCache, phone, data)
  return data
}
function customCmdSave(phone, data) {
  try {
    fs.writeFileSync(customCmdFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[CUSTOMCMD] save error for ${phone}:`, e.message)
  }
  cacheSet(customCmdCache, phone, data)
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
  const cached = cacheGet(antitagCache, phone)
  if (cached) return cached
  const file = antitagFilePath(phone)
  let data = null
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTITAG] load error for ${phone}:`, e.message)
  }
  if (!data) data = { groups: {} }
  cacheSet(antitagCache, phone, data)
  return data
}
function antitagSave(phone, data) {
  try {
    fs.writeFileSync(antitagFilePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[ANTITAG] save error for ${phone}:`, e.message)
  }
  cacheSet(antitagCache, phone, data)
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
      const groupMeta = await getGroupMetaCached(sock, phone, groupId)
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
  const cached = cacheGet(antistatusCache, phone)
  if (cached) return cached
  const file = antistatusFilePath(phone)
  let data = null
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[ANTISTATUS] load error for ${phone}:`, e.message)
  }
  data = {
    groups: {},
    warnings: {},
    ...(data && typeof data === "object" ? data : {}),
  }
  if (!data.groups || typeof data.groups !== "object" || Array.isArray(data.groups)) data.groups = {}
  if (!data.warnings || typeof data.warnings !== "object" || Array.isArray(data.warnings)) data.warnings = {}
  cacheSet(antistatusCache, phone, data)
  return data
}
function antistatusSave(phone, data) {
  const file = antistatusFilePath(phone)
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    fs.mkdirSync(ANTISTATUS_DIR, { recursive: true })
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(temp, file)
    cacheSet(antistatusCache, phone, data)
    return true
  } catch (e) {
    console.error(`[ANTISTATUS] save error for ${phone}:`, e.message)
    try { fs.rmSync(temp, { force: true }) } catch {}
    return false
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
  if (!data.warnings[groupId] || typeof data.warnings[groupId] !== "object" || Array.isArray(data.warnings[groupId])) {
    data.warnings[groupId] = {}
  }
  const raw = String(sender || '').replace(/:\d+(?=@)/, '')
  const key = raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`
  const warnings = data.warnings[groupId]
  const stable = id => {
    const value = String(id || '').replace(/:\d+(?=@)/, '')
    return value.includes('@') ? value : `${value.replace(/\D/g, '')}@s.whatsapp.net`
  }
  const stored = Object.keys(warnings).find(id => stable(id) === key) || key
  const previous = Number(warnings[stored]) || 0
  warnings[stored] = previous + 1
  if (!antistatusSave(phone, data)) {
    if (previous) warnings[stored] = previous
    else delete warnings[stored]
    throw new Error('anti-status warning could not be saved to local storage')
  }
  return warnings[stored]
}
function antistatusResetWarnings(phone, groupId, sender) {
  const data = antistatusLoad(phone)
  const warnings = data.warnings[groupId]
  const normalize = value => {
    const raw = String(value || '').replace(/:\d+(?=@)/, '')
    return raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`
  }
  const key = normalize(sender)
  if (warnings) {
    for (const stored of Object.keys(warnings)) {
      if (normalize(stored) === key) delete warnings[stored]
    }
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
      try { groupMeta = await getGroupMetaCached(sock, phone, groupId) } catch (e) {
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
            text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 📱 *Reason:* Tagged this group in their status\n│ ⚡ *Mode:* Instant kick\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
            mentions: [sender]
          })
        } catch (e) {
          console.error("[ANTISTATUS] kick failed:", e.message)
        }
      } else if (mode === "warn") {
        const warns = antistatusAddWarning(phone, groupId, sender)
        const maxWarns = 3
        if (warns >= maxWarns) {
          try {
            await sock.groupParticipantsUpdate(groupId, [sender], "remove")
            await sock.sendMessage(groupId, {
              text: `╔════════════════════╗\n║  👢 *USER KICKED!*  ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ 📱 *Reason:* Repeatedly tagged this group in status\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
              mentions: [sender]
            })
          } catch (e) {
            console.error("[ANTISTATUS] warn-kick failed:", e.message)
          }
        } else {
          await sock.sendMessage(groupId, {
            text: `╔════════════════════╗\n║  ⚠️ *STATUS WARNING* ║\n╚════════════════════╝\n\n┌─────〔 📱 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 🚫 Don't tag this group in your status!\n│ ⚠️ *Warnings:* ${warns}/${maxWarns}\n│ ⚡ *${maxWarns - warns} more = KICK!*\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
            mentions: [sender]
          }).catch(() => {})
        }
      } else {
        await sock.sendMessage(groupId, {
          text: `╔════════════════════╗\n║  📱 *STATUS ACTION* ║\n╚════════════════════╝\n\n┌─────〔 🚫 *ANTISTATUS* 〕─────\n│ 👤 *User:* @${tag}\n│ 🚫 Tagged this group in their status — action taken\n└──────────────────────────\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`,
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

// Commands that consume the group admin flags prepared by checkGroupAdmin.
// Keep this list conservative: only these and commands declaring permission
// metadata need a synchronous metadata lookup before execution.
const COMMANDS_NEEDING_GROUP_ADMIN_CONTEXT = new Set([
  "add", "antibadword", "antibot", "antilink", "antistatus", "antisticker", "resetwarn",
  "del", "demote", "hidetag", "mute", "promote", "tagadmin", "tagall", "unban",
  "unmute", "vmute", "vunmute", "warn",
])

// These commands require the person invoking them to be a group admin.
// Bot ownership alone does not grant that WhatsApp group role.
const COMMANDS_REQUIRING_SENDER_GROUP_ADMIN = new Set([
  "add", "antibadword", "antibot", "antilink", "antistatus", "antisticker",
  "demote", "hidetag", "kick", "mute", "promote", "unban",
  "unmute", "vmute", "vunmute", "warn",
])

const GROUP_ADMIN_REQUIRED_NOTICE =
  '╭───「 GROUP ADMIN REQUIRED 」───╮\n' +
  '│ ⚠️ Bot owner is not a group admin here.\n' +
  '│ This command needs group-admin permission.\n' +
  '│ Ask a group admin to promote you, then retry.\n' +
  '╰───────────────────────────────────╯\n\n' +
  '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true

  const prefix = state.settings.get("prefix") || BOT_PREFIX
  const isOwnerEarly = checkIsOwner(state, sender, senderAlt, fromMe)
  if (isBlockedByPrivateMode(state, isOwnerEarly, fromMe, sender, senderAlt)) {
    // Keep private-mode behavior, but avoid synchronous log I/O and ban lookups
    // for ordinary chat messages that are already being ignored.
    if (body.startsWith(prefix)) {
      console.log(`[${state.phone}] 🔒 Private-mode lockdown: ignoring ${normalizeNum(sender || from)} in ${from}`)
    }
    return
  }

  if (!fromMe) {
    const sessionPhone = normalizeNum(sock.user?.id || "")
    const senderPhone  = normalizeNum(sender || from)
    if (await isBannedFast(sessionPhone, senderPhone, from)) {
      console.log(`[BAN] 🚫 Blocked message from ${senderPhone} on session ${sessionPhone}`)
      return
    }
  }

  if (!fromMe && state.settings.get("autoRead")) {
    sock.readMessages([msg.key]).catch(() => {})
  }

  if (!body.startsWith(prefix)) {
    handleOrdinaryMessage(state, sock, msg, from).catch(() => {})
    return
  }

  // Command path: fire typing/recording in parallel — the command still
  // runs and replies instantly, this just runs alongside it, never awaited,
  // and deferred a tick so it can never queue ahead of the command's reply.
  ultraExec.firePresence(state, from, () => {
    startAutoPresence(state, sock, from)
  })

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

  const category = String(command.category || '').toLowerCase()
  const declaredTimeout = Number(command.timeoutMs)
  const independentCommand = command.independent === true
  const isMediaCommand = command.media === true ||
    MEDIA_COMMAND_CATEGORIES.has(category) ||
    command.heavy === true || command.resourceIntensive === true ||
    sessionExecutor.HEAVY?.has(canonical)
  const commandTimeoutMs = independentCommand
    ? 0
    : Number.isFinite(declaredTimeout) && declaredTimeout > 0
    ? declaredTimeout
    : isMediaCommand ? MEDIA_COMMAND_TIMEOUT_MS : undefined

  let isAdmin = false, isBotAdmin = false, isActualGroupAdmin = null
  const needsGroupAdminContext =
    command.adminOnly === true || command.botAdmin === true ||
    command.requiresAdmin === true || command.requiresGroupAdmin === true ||
    COMMANDS_NEEDING_GROUP_ADMIN_CONTEXT.has(canonical) ||
    COMMANDS_REQUIRING_SENDER_GROUP_ADMIN.has(canonical)
  if (isGroup && needsGroupAdminContext) {
    ;({ isAdmin, isBotAdmin, isActualGroupAdmin } = await checkGroupAdmin(
      state, sock, from, sender, senderAlt, isOwner, fromMe,
      isOwner && COMMANDS_REQUIRING_SENDER_GROUP_ADMIN.has(canonical)
    ))
  }

  if (
    isGroup && isOwner && isActualGroupAdmin === false &&
    COMMANDS_REQUIRING_SENDER_GROUP_ADMIN.has(canonical)
  ) {
    await sock.sendMessage(from, { text: GROUP_ADMIN_REQUIRED_NOTICE }, { quoted: msg }).catch(() => {})
    return
  }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner: ${isOwner} admin:${isAdmin} botAdmin: ${isBotAdmin}`)

  const commandSock = createQuotedCommandSocket(
    sock, msg, from,
    jid => getGroupMetaForCommand(sock, state.phone, jid)
  )
  const runOnce = () => command.run({
    sock: commandSock, from, msg, message: msg, sender, args,
    text: rest, full: body,
    commands: registry.map, cmdList: registry.list, cmdDetails: registry.details,
    settings: state.settings, lib, api, config, helper,
    isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
    extractBody, groupCache: state.groupCache,
    checkIsOwner: (s, a) => checkIsOwner(state, s, a, false),
    checkGroupAdmin: (f, s, a) => checkGroupAdmin(
      state, sock, f, s, a, isOwner, fromMe,
      isOwner && COMMANDS_REQUIRING_SENDER_GROUP_ADMIN.has(canonical)
    ),
    antideleteGetEnabled: () => antideleteGetEnabled(state.phone),
    antideleteSetEnabled: (enabled) => antideleteSetEnabled(state.phone, enabled),
    banCacheInvalidate: (targetPhone) => banCacheInvalidate(normalizeNum(sock.user?.id || ""), normalizeNum(targetPhone)),
  })

  // ULTRA EXECUTOR — this session's OWN executor (own queue, timeout);
  // nothing is shared with any other session. Works with both the lane-based
  // executor (timeouts resolve + onDrop) and the throwing variant (timeouts reject).
  //
  // ZERO DELAY: the per-sender cooldown is ALWAYS skipped, so no command is ever
  // held back or dropped just because the same person sent another one a moment ago.
  const ZERO_DELAY = true
  const runGuarded = (_isRetry = false) =>
    sessionExecutor.forState(state).submit({
      name:         rawCmd,
      heavy:        command.heavy === true || command.resourceIntensive === true,
      timeoutMs:    commandTimeoutMs ? commandTimeoutMs + 5000 : undefined,
      chat:         from,
      sender:       normalizeNum(sender || from),
      isOwner:      !!(isOwner || fromMe),
      skipCooldown: ZERO_DELAY,
      fn:           () => ultraExec.guardCommand(state, sock, from, msg, rawCmd, runOnce, commandTimeoutMs),
      onDrop: (reason) => {
        console.warn(`[${state.phone}] command ${rawCmd} dropped: ${reason}`)
        let note = null
        if (reason === "queue_full") note = "⏳ Server is busy right now — please try again in a moment."
        if (reason === "timeout")    note = `⌛ *${rawCmd}* took too long and was cancelled.`
        if (note) sock.sendMessage(from, { text: note }, { quoted: msg }).catch(() => {})
      },
    })

  const startedAt = Date.now()

  try {
    // Independent commands run outside the shared executor and watchdog. Their
    // async work can continue as long as needed without occupying command lanes.
    if (independentCommand) await runOnce()
    else await runGuarded(false)
    console.log(`[${state.phone}] ⚡ ${rawCmd} completed in ${Date.now() - startedAt}ms`)
  } catch (e) {
    if (e.message?.includes("underlying work may continue")) {
      console.error(`[${state.phone}] ${rawCmd} timed out; not retrying because it may still be running`)
      try { await sock.sendMessage(from, { text: `⚠️ *${rawCmd}* timed out. It may still be running, so it was not retried.` }, { quoted: msg }) } catch {}
      return
    }
    console.error(`[${state.phone}] RUN ERR ${rawCmd} (${Date.now() - startedAt}ms): ${e.message}`)
    try { await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e.message}` }, { quoted: msg }) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT START
// ─────────────────────────────────────────────────────────────────────────────
async function startBot(phone) {
  let state = sessions.get(phone)
  if (!state) { state = makeSessionState(phone); sessions.set(phone, state) }

  // Refuse to open a second live socket for a phone that's already
  // connected or mid-connect — this is what causes the 440 "replaced"
  // conflict loop when addSession/reconnect timers race each other.
  if (state.connected) {
    console.log(`[${phone}] ℹ startBot called but already connected — ignoring duplicate start`)
    return state
  }
  if (state.sock && state.startingUp) {
    console.log(`[${phone}] ℹ startBot called but a connection attempt is already in progress — ignoring duplicate start`)
    return state
  }
  state.startingUp = true

  // Production durable auth (Redis + local mirror). Falls back to disk
  // if Redis is offline or not configured.
  const { state: authState, saveCreds } = await authStore.useAuthState(phone, state.sessDir)
  state.authRegistered = !!authState.creds.registered
  const version = await getSafeWaVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys:  makeCacheableSignalKeyStore(authState.keys, Pino({ level: "silent" })),
    },
    browser:             ['Mac OS', 'Chrome', '14.4.1'],
    logger:              Pino({ level: "silent" }),
    printQRInTerminal:   false,
    markOnlineOnConnect: false,
    syncFullHistory:     false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs:    60000,
    defaultQueryTimeoutMs: undefined,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount:    5,
    shouldSyncHistoryMessage: m => m.syncType === 0,
    cachedGroupMetadata:  async jid => state.groupCache[jid],
    msgRetryCounterCache: state.msgRetryCounterCache,   // lives on the session, not the socket
  })

  attachResponseTextStyle(sock)
  state.sock = sock

  // ULTRA EXECUTOR — attach metrics/watchdog hooks to this live socket.
  ultraExec.attachSession(state, sock)

  autoTag.autoTagAttach(state, sock)
  charAi.attach(state, sock)
  vmuteCore.attach(state, sock)

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
      meta = await refreshGroupMeta(state, sock, update.id)
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
              `║   ${boxTitle} ${" ".repeat(Math.max(0, 21 - boxTitle.length))}║\n` +
              `╚═══════════════════════════╝\n\n` +
              `👤 @${memberPhone} has been ${verb} *Admin*\n` +
              `🛡️ ${action === "promote" ? "Promoted" : "Demoted"} by: ${actorJid ? "@" + actorPhone : "Unknown"}\n` +
              `📊 Total Admins: ${adminCount}\n\n` +
              `> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

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
          logOnce(phone, `${type}-disabled:${groupId}`, `[WATCHDOG:${phone}] ⚠️ ${type} is DISABLED for "${groupName}" — nothing sent. Run .${type} on to enable.`)
          continue
        }

        let text
        if (type === "welcome") {
          text = await welcomeCmd.buildRichWelcomeText(sock, {
            groupId, participantJid, pushName, groupName, memberCount, meta,
          })
        } else {
          text = goodbyeCmd.buildRandomGoodbyeText(pushName, participantJid)
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

  // ═══════════════════════════════════════════════════════════════════════
  // ANTI-CALL — strong reject (retries, JID variants, re-reject while ringing)
  // + a notice to the CALLER's DM once the call was really rejected.
  // ═══════════════════════════════════════════════════════════════════════
  const antiCallNotified = new Set()
  const antiCallSeen = new Map()          // call id -> reject attempts so far
  const ANTICALL_MAX_ATTEMPTS = 6         // per call id (covers "still ringing" re-rejects)

  const antiCallSleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const antiCallClean = (jid) => String(jid || "").replace(/:\d+(?=@)/, "")

  // Other JID forms for the same caller (phone-number form for @lid users)
  const antiCallVariants = async (call, callerJid) => {
    const list = [callerJid, antiCallClean(callerJid), call.chatId, call.peerJid, call.from]
    try {
      const clean = antiCallClean(callerJid)
      if (clean.endsWith("@lid")) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(clean)
        if (pn) list.push(String(pn).includes("@") ? antiCallClean(pn) : `${pn}@s.whatsapp.net`)
      }
    } catch {}
    return [...new Set(list.filter(Boolean))]
  }

  // Strong reject: instant first try, then variants + retries + second method
  const antiCallReject = async (call, callerJid) => {
    const attempt = async (jid) => {
      if (typeof sock.rejectCall === "function") {
        try {
          await sock.rejectCall(call.id, jid)
          return
        } catch (e1) {
          if (typeof sock.sendCallOfferAck !== "function") throw e1
        }
      }
      if (typeof sock.sendCallOfferAck === "function") {
        await sock.sendCallOfferAck(call.id, jid, "reject")
        return
      }
      throw new Error("no reject method available")
    }

    let lastErr = ""

    // Fast path: nothing awaited before the first reject
    try {
      await attempt(callerJid)
      return true
    } catch (e) {
      lastErr = e.message
    }

    // Slow path: other JID forms, up to 3 rounds
    const variants = await antiCallVariants(call, callerJid)
    for (let round = 1; round <= 3; round++) {
      for (const jid of variants) {
        try {
          await attempt(jid)
          return true
        } catch (e) {
          lastErr = e.message
        }
      }
      await antiCallSleep(300 * round)
    }

    console.error(`[ANTICALL:${phone}] reject failed after retries:`, lastErr)
    return false
  }

  // Anti-call notice — sent to the CALLER's DM (only when the call was really rejected)
  const antiCallNotify = async (callerJid, ok) => {
    try {
      if (!ok) return   // never claim "rejected" if the reject actually failed

      // Banned users never get replies from the bot
      const sessionPhone = normalizeNum(sock.user?.id || "")
      if (await isBannedFast(sessionPhone, normalizeNum(callerJid), callerJid)) return

      const chatJid = antiCallClean(callerJid)
      let shownJid  = chatJid

      // @lid callers: show their real phone-number tag when Baileys knows it
      if (shownJid.endsWith("@lid")) {
        try {
          const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(shownJid)
          if (pn) shownJid = String(pn).includes("@") ? antiCallClean(pn) : pn + "@s.whatsapp.net"
        } catch {}
      }

      const tag = "@" + shownJid.split("@")[0]
      const text =
        "╭━━━〔 📵 ANTI-CALL ALERT 〕━━━╮\n" +
        "┃\n" +
        "┃ ⚠️ Incoming Call Detected\n" +
        "┃\n" +
        "┃ 👤 Caller: " + tag + "\n" +
        "┃ 📞 Action: Call rejected automatically\n" +
        "┃ 🛡️ Protection: Anti-Call is enabled\n" +
        "┃\n" +
        "┃ Sorry, calls are not accepted on this bot.\n" +
        "┃ Please send a text message instead.\n" +
        "┃\n" +
        "╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n" +
        "> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦"

      // Try the caller's own chat first, then the phone-number chat as a fallback
      const targets = [...new Set([chatJid, shownJid])]
      let sent = false
      for (const t of targets) {
        try {
          await sock.sendMessage(t, { text, mentions: [shownJid] })
          sent = true
          break
        } catch (e) {
          console.error("[ANTICALL:" + phone + "] notice to " + t + " failed:", e.message)
        }
      }
      if (!sent) console.error("[ANTICALL:" + phone + "] caller notice could not be delivered")
    } catch (e) {
      console.error("[ANTICALL:" + phone + "] notify failed:", e.message)
    }
  }

  sock.ev.on("call", async (calls) => {
    try {
      if (!state.settings.get("anticall")) return

      for (const call of calls) {
        // Only live ringing calls — ignore timeout / terminate / accept / reject
        if (call.status && call.status !== "offer" && call.status !== "ringing") continue

        const callerJid = call.from || call.peerJid || call.chatId
        if (!callerJid || !call.id) continue

        const tries = antiCallSeen.get(call.id) || 0
        if (tries >= ANTICALL_MAX_ATTEMPTS) continue
        antiCallSeen.set(call.id, tries + 1)
        if (tries === 0) setTimeout(() => antiCallSeen.delete(call.id), 120000)

        const ok = await antiCallReject(call, callerJid)

        // Notify once per call, and once per caller per minute
        if (tries === 0 && !antiCallNotified.has(callerJid)) {
          antiCallNotified.add(callerJid)
          setTimeout(() => antiCallNotified.delete(callerJid), 60000)
          antiCallNotify(callerJid, ok)   // fire-and-forget: never delays the next reject
        }
      }
    } catch (e) {
      console.error(`[ANTICALL:${phone}] handler error:`, e.message)
    }
  })

  let pairingCodeRequested = false
  const PAIRING_MIN_GAP_MS = 20000 // never re-request a pairing code faster than this, even across reconnects

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (!authState.creds.registered && state.pairingMode === "qr" && qr) {
      const qrVersion = ++state.qrVersion
      try {
        const dataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: "M", margin: 2, width: 320 })
        if (state.pairingMode === "qr" && state.sock === sock && state.qrVersion === qrVersion) {
          state.qrDataUrl = dataUrl
          state.qrExpiresAt = Date.now() + PAIRING_QR_TTL_MS
        }
      } catch (e) {
        console.error(`[${phone}] QR render failed:`, e.message)
      }
    }

    if (
      !authState.creds.registered &&
      state.pairingMode !== "qr" &&
      !pairingCodeRequested &&
      connection === "connecting" &&
      !qr
    ) {
      const sinceLast = state.lastPairingAttemptAt ? Date.now() - state.lastPairingAttemptAt : Infinity
      if (sinceLast < PAIRING_MIN_GAP_MS) {
        logOnce(phone, "pair-cooldown", `[${phone}] ⏳ Skipping pairing request — last one was ${Math.round(sinceLast / 1000)}s ago, waiting for ${PAIRING_MIN_GAP_MS / 1000}s cooldown`)
      } else {
        pairingCodeRequested = true
        state.lastPairingAttemptAt = Date.now()
        const number = phone.replace(/\D/g, "")
        try {
          await new Promise(r => setTimeout(r, 3000))
          const code = await sock.requestPairingCode(number)
          state.pairingCode          = code
          state.pairingCodeExpiresAt = Date.now() + PAIRING_CODE_TTL_MS
          logOnce(phone, "pair-code", `[${phone}] 📱 PAIRING CODE: ${code} (generated ${nowWAT()} WAT — expires in 60s)`)
        } catch (e) {
          console.error(`[${phone}] PAIR ERR:`, e.message)
          pairingCodeRequested = false
          state.pairingCode          = null
          state.pairingCodeExpiresAt = null
        }
      }
    }

    if (connection === "open") {
      state.connected            = true
      state.startingUp           = false
      state.retries              = 0
      state.pairingCode          = null
      state.pairingCodeExpiresAt = null
      state.qrDataUrl            = null
      state.qrExpiresAt          = null
      if (pairingModes[phone] === "qr") setPairingMode(phone, "pair")
      console.log(`[${phone}] ⚡ Connected — ${sock.user?.id || "unknown"} at ${nowWAT()} WAT`)
      // Website and Telegram pairing both converge here. Keep media delivery
      // off the connection-update path so it cannot delay normal bot startup.
      setImmediate(() => {
        if (sessions.get(phone)?.sock === sock) {
          sendPairingWelcome(sock, phone).catch(error =>
            console.error(`[${phone}] Pairing welcome error: ${error.message}`)
          )
        }
      })
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

      // ─────────────────────────────────────────────────────────────────────
      // LIVE RECOVERY: WhatsApp has explicitly confirmed this socket is OPEN.
      // This is the only point where a session becomes restart-protected.
      // ─────────────────────────────────────────────────────────────────────
      markSessionLive(phone, {
        waId: sock.user?.id || null,
        connected: true,
      })

      // Existing backup remains active.
      // SQLite authStore is the durable source of truth.
      sessionBackup.pushImmediate(phone).catch(e =>
        console.error(`[${phone}] BACKUP PUSH ERR:`, e.message)
      )
    }

    if (connection === "close") {
      state.connected  = false
      state.startingUp = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut  = statusCode === DisconnectReason.loggedOut

      if (loggedOut) {
        // ONLY an explicit WhatsApp loggedOut is allowed to destroy the
        // restart-protection record.
        removeSessionFromLiveProtection(phone)

        console.log(`[${phone}] ✗ Logged out — removing session`)
        await removeSession(phone)
        await sessionBackup.deleteSession(phone).catch(() => {})
        await settingsBackup.deleteSettings(phone).catch(() => {})
        if (slotAssignments[phone]) { delete slotAssignments[phone]; saveSlotAssignments() }
        return
      }

      // Temporary disconnect / reconnect / timeout / slow WhatsApp reload:
      // NEVER delete the session and NEVER clear its live protection record.
      keepSessionProtected(phone, `connection closed (code ${statusCode ?? "unknown"})`)

      // During an intentional PM2/server shutdown, preserve the session but
      // do NOT create a new reconnect timer. The next process will restore it.
      if (shuttingDown) {
        console.log(`[${phone}] 🛡 Shutdown in progress — session preserved, reconnect skipped`)
        return
      }

      state.retries++
      const delay = Math.min(1000 * Math.pow(2, state.retries), 30000)
      logOnce(phone, "reconnect", `[${phone}] ↻ Reconnecting in ${delay}ms (code ${statusCode}) — attempt #${state.retries}`)
      setTimeout(() => startBot(phone).catch(e => console.error(`[${phone}] RESTART ERR:`, e.message)), delay)
    }
  })

  if (typeof lib.setSocket      === "function") lib.setSocket(sock)
  if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)
  try { lib.groupParticipants?.setStore?.({ groupMetadata: state.groupCache }) } catch {}

  // ═══════════════════════════════════════════════════════════════════════
  // ULTRA LISTENER — fast lane for commands
  //   1. A command message is dispatched the moment it arrives (only cheap
  //      synchronous checks happen first).
  //   2. All passive work (antilink, antitag, antidelete, memory, badword,
  //      antibot, auto-VV, ordinary-message effects) runs AFTER, on the next
  //      tick, so it can never delay a command.
  //   3. antidelete only records messages while this session has it ON
  //      (before this, every media message in every chat was downloaded).
  // ═══════════════════════════════════════════════════════════════════════
  const adEnabledCache = { value: false, at: 0 }
  const antideleteEnabledCached = () => {
    const now = Date.now()
    if (now - adEnabledCache.at > 5000) {
      adEnabledCache.value = !!antideleteGetEnabled(phone)
      adEnabledCache.at = now
    }
    return adEnabledCache.value
  }

  const processPassive = async (m, handledAsCommand) => {
    const jid = m.key.remoteJid
    const sessionPhone = normalizeNum(sock.user?.id || "")

    if (!m.key.fromMe) {
      const senderPhone = normalizeNum(m.key.participant || jid)
      if (await isBannedFast(sessionPhone, senderPhone, jid)) return
    }

    if (antideleteEnabledCached()) {
      storeMessage(sock, m).catch(e => console.error("[" + phone + "] storeMessage ERR:", e.message))
    }
    handleMessageRevocation(sock, phone, m, "upsert").catch(e =>
      console.error("[" + phone + "] antideleteUpsert ERR:", e.message)
    )

    if (!m.key.fromMe) {
      if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
      ;(lib.handleAntilinkInline || handleAntilinkInline)(sock, m, phone).catch(e => console.error("[" + phone + "] ANTILINK ERR:", e.message))
      handleAntitagInline(sock, m, phone).catch(e => console.error("[" + phone + "] ANTITAG ERR:", e.message))
      if (typeof lib.handleAntistatusGroup === "function") lib.handleAntistatusGroup(sock, m, phone).catch(e => console.error("[" + phone + "] ANTISTATUS-GC ERR:", e.message))
      try {
        const badwordCommand = require(path.join(CMD_DIR, "antibadword.js"))
        if (typeof badwordCommand.handleBadword === "function") {
          badwordCommand.handleBadword(sock, m, extractBody).catch(e => console.error("[" + phone + "] ANTIBADWORD ERR:", e.message))
        }
      } catch (e) {
        console.error("[" + phone + "] ANTIBADWORD LOAD ERR:", e.message)
      }
      if (typeof lib.handleAntistickerInline === "function") lib.handleAntistickerInline(sock, m, phone).catch(e => console.error("[" + phone + "] ANTISTICKER ERR:", e.message))
      if (typeof lib.handleAntibot  === "function") lib.handleAntibot(sock, m, extractBody, lib).catch(() => {})
      if (typeof lib.handleAntispam === "function") lib.handleAntispam(sock, m, extractBody, state).catch(e => console.error("[" + phone + "] ANTISPAM ERR:", e.message))
    }

    // AUTO-VV: authorized chats first — media-only View Once messages may have no text body.
    if (typeof autoVV?.handleAutoVV === "function") {
      autoVV.handleAutoVV({ state, sock, msg: m, from: jid }).catch(e =>
        console.error("[" + phone + "] AUTO-VV ERR:", e.message)
      )
    }

    // Non-command messages still need the ordinary-message effects (autoRead / autoReply / presence)
    if (!handledAsCommand) {
      handleMessage(state, sock, m).catch(e => console.error("[" + phone + "] MSG ERR:", e.message))
    }
  }

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return
    const prefix = state.settings.get("prefix") || BOT_PREFIX

    for (const m of messages) {
      if (!m || !m.key) continue

      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue

      if (m.key.remoteJid === "status@broadcast") {
        handleStatus(state, sock, m).catch(e => console.error("[" + phone + "] STATUS ERR:", e.message))
        // handleAntistatusInline(sock, m, phone).catch(e => console.error("[" + phone + "] ANTISTATUS ERR:", e.message))  // replaced by lib/antistatusgc.js
        continue
      }

      // FAST LANE — commands are dispatched immediately
      let isCmd = false
      try {
        const body = extractBody(m)
        isCmd = !!body && body.startsWith(prefix)
      } catch {}

      if (isCmd) {
        handleMessage(state, sock, m).catch(e => console.error("[" + phone + "] MSG ERR:", e.message))
      }

      // Everything else runs after, on the next tick
      setImmediate(() => {
        processPassive(m, isCmd).catch(e => console.error("[" + phone + "] PASSIVE ERR:", e.message))
      })
    }
  })

  sock.ev.on("messages.update", async (updates) => {
    handleMessageRevocation(sock, phone, updates, "update").catch(e =>
      console.error(`[${phone}] antideleteUpdate ERR:`, e.message)
    )
  })

  // Any reaction in a group or DM counts as activity too.
  sock.ev.on("messages.reaction", async (reactions) => {
    for (const r of reactions) {
      const from = r.key?.remoteJid
      if (!from || from === "status@broadcast") continue
      startAutoPresence(state, sock, from)
    }
  })

  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION REMOVAL
// ─────────────────────────────────────────────────────────────────────────────
// Sessions are removed only when WhatsApp explicitly reports
// DisconnectReason.loggedOut in the connection.update close handler.
// A slow reconnect, VPS restart, temporary network failure, or timeout
// must NOT delete valid authentication credentials.

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  await loadCommands()

  // ULTRA WATCHDOG — monitor/revive live sessions without replacing
  // the existing LIVE-RECOVERY/session-protection system.
  ultraExec.startWatchdog({
    sessions,
    startBot,
  })

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
  global.__antistatusAddWarning    = antistatusAddWarning
  global.__antistatusResetWarnings = antistatusResetWarnings
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

  // Durable auth: pull full AuthenticationState (creds + all Signal keys)
  // for every phone from Redis → local disk mirror, before any session
  // starts. The existing disk/meta/slot discovery loop below will then
  // find valid creds.json for each of them, so startBot() reconnects
  // without a new pairing code for anyone WhatsApp hasn't actually
  // logged out.
  try {
    const n = await authStore.restoreAllSessions(SESS_ROOT)
    if (n > 0) console.log(`[INIT] ✔ Auth-store restored ${n} session folder(s)`)
  } catch (e) {
    console.error("[INIT] authStore.restoreAllSessions:", e.message)
  }

  try {
    const settingsUsersDir = path.join(__dirname, "data", "users")
    await settingsBackup.restoreAllSettings(settingsUsersDir)
    console.log("[SETTINGS] 🛡 Per-session settings are stored in local SQLite")
  } catch (e) {
    console.error("[SETTINGS] ✗ SQLite settings setup failed:", e.message)
  }

  console.log("[INIT] 🔄 Loading user/group settings from SQLite...")
  let dbRestoredCount = 0
  try {
    dbRestoredCount = lib.userDb?.restoreAll?.() || 0
  } catch (e) {
    console.error("[INIT] ✗ User DB load failed:", e.message)
  }
  if (dbRestoredCount > 0) console.log(`[INIT] ✔ Loaded ${dbRestoredCount} user record(s) from SQLite`)

  // ── Collect every known phone from ALL reliable sources ──────────────────
  // This is the auto-load path: on every restart we rebuild the full list of
  // sessions that should come back online (Session + their changes together).
  // Sources:
  //   1. sessions/<phone>/creds.json          (live auth on disk)
  //   2. sessions/_meta.json                  (last known list)
  //   3. data/slots.json                      (slot assignments)
  //   4. data/settings/*.json                 (per-session settings files)
  //   5. data/users/*.json                    (legacy settings mirror)
  //   6. database/zenx.db                     (SQLite settings and user data)
  // After restoreAll() above, any missing creds are already written back to disk.
  // We NEVER wipe a session here — only a real WhatsApp loggedOut does that.

  const onDisk = fs.existsSync(SESS_ROOT)
    ? fs.readdirSync(SESS_ROOT).filter(f => {
        const full = path.join(SESS_ROOT, f)
        return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "creds.json"))
      })
    : []

  const fromMeta = loadMetaPhones()

  const fromSlots = Object.keys(slotAssignments || {}).map(p => p.replace(/\D/g, "")).filter(Boolean)

  const fromSettingsFiles = (() => {
    const phones = []
    if (fs.existsSync(SETTINGS_ROOT)) {
      for (const f of fs.readdirSync(SETTINGS_ROOT).filter(x => x.endsWith(".json"))) {
        const p = f.replace(/\.json$/, "").replace(/\D/g, "")
        if (p) phones.push(p)
      }
    }
    return phones
  })()

  const fromUsersDir = (() => {
    const phones = []
    const usersDir = path.join(__dirname, "data", "users")
    if (fs.existsSync(usersDir)) {
      for (const f of fs.readdirSync(usersDir).filter(x => x.endsWith(".json"))) {
        const p = f.replace(/\.json$/, "").replace(/\D/g, "")
        if (p) phones.push(p)
      }
    }
    return phones
  })()

  const fromSettingsDb = settingsBackup.listSettingsUsers?.() || []

  let allPhones = [...new Set([
    ...onDisk,
    ...fromMeta,
    ...fromSlots,
    ...fromSettingsFiles,
    ...fromUsersDir,
    ...fromSettingsDb,
  ].map(p => String(p).replace(/\D/g, "")).filter(Boolean))]

  // ─────────────────────────────────────────────────────────────────────────
  // LIVE RECOVERY BOOT ORDER
  // ─────────────────────────────────────────────────────────────────────────
  // Previously confirmed LIVE sessions get first recovery priority.
  // Existing discovery remains intact for newly paired/known sessions.
  // Nothing is deleted because a session is slow or temporarily disconnected.

  const protectedLivePhones = getProtectedLivePhones()

  allPhones = [
    ...protectedLivePhones.filter(phone => allPhones.includes(phone)),
    ...allPhones.filter(phone => !protectedLivePhones.includes(phone)),
  ]

  console.log(
    `[LIVE-RECOVERY] 🛡 Protected LIVE sessions at boot: ` +
    `${protectedLivePhones.length ? protectedLivePhones.join(", ") : "(none)"}`
  )

  if (fs.existsSync(SETTINGS_ROOT)) {
    const settingFiles = fs.readdirSync(SETTINGS_ROOT).filter(f => f.endsWith(".json"))
    if (settingFiles.length > 0) {
      console.log(`[SETTINGS] 💾 Found ${settingFiles.length} saved session setting(s): ${settingFiles.map(f => f.replace(".json","")).join(", ")}`)
    }
  }

  console.log(`[INIT] 🔄 Auto-load sources → disk:${onDisk.length} meta:${fromMeta.length} slots:${fromSlots.length} settings:${fromSettingsFiles.length} users:${fromUsersDir.length}`)
  console.log(`[INIT] ▶ Starting ${allPhones.length} session(s) (Session + changes): ${allPhones.join(", ") || "(none)"}`)

  // Optional migration: push any pre-existing local-disk-only session
  // (from before authStore existed) up to Redis proactively, rather than
  // waiting for its next natural creds.update/keys.set. Safe to run every
  // boot — it just overwrites Redis with whatever's already correct on
  // disk, so it's a no-op once a session is already fully migrated.
  if (authStore.enabled) {
    for (const phone of onDisk) {
      await authStore.pushLocalSessionToRedis(phone, path.join(SESS_ROOT, phone)).catch(() => {})
    }
  }

  for (const phone of allPhones) {
    // Ensure the phone still has a slot assignment so capacity accounting stays correct
    if (!slotAssignments[phone]) {
      const assigned = assignToSlot(phone)
      if (assigned === null) {
        console.warn(`[INIT] ⚠ Slot full — cannot recover session ${phone} (capacity reached). Skipping.`)
        continue
      }
      console.log(`[INIT] 📌 Re-assigned ${phone} to slot ${assigned}`)
    }

    try {
      await startBot(phone)
      console.log(`[INIT] ✔ Session recovered & started: ${phone}`)
    } catch (e) {
      console.error(`[INIT] ✗ Failed to start ${phone}:`, e.message)
    }
  }

  saveMeta()
  // NOTE: sessions are NEVER wiped on a blind boot-time timer.
  // A session that just takes a while to reconnect after a restart is not
  // the same as a real logout. Removal now happens ONLY when WhatsApp
  // itself confirms a logout (DisconnectReason.loggedOut, in the
  // connection.update "close" handler) — that is the one signal that
  // means "this phone unlinked the bot". When that happens both the
  // session auth AND its settings/changes are cleaned up together.
}

function normalizePairingPhone(phone) {
  const formatted = String(phone || "").trim().replace(/[\s().-]/g, "")
  if (!/^(?:\+|00)?\d+$/.test(formatted)) return ""
  let digits = formatted.replace(/\D/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  return digits.length >= 7 && digits.length <= 15 ? digits : ""
}

async function addSession(phone, preferredSlot = null) {
  const clean = normalizePairingPhone(phone)
  if (!clean) throw new Error("Enter a valid international WhatsApp number with country code (7 to 15 digits).")

  // Already live? Don't spin up a second socket on the same WhatsApp
  // identity — that's what causes the endless 440 "replaced" conflict
  // loop (two live sockets fighting over one device registration).
  const existing = sessions.get(clean)
  if (existing?.connected) {
    console.log(`[${clean}] ℹ addSession called but already connected — returning existing state, not restarting`)
    return {
      phone:       clean,
      pairingCode: null,
      expiresInMs: 0,
      connected:   true,
      slot:        slotAssignments[clean] || null,
    }
  }

  if (existing?.startingUp && existing.pairingMode === "qr") {
    throw new Error("This number is already starting in QR mode. Finish or cancel that connection before requesting a pairing code.")
  }
  const slot = assignToSlot(clean, preferredSlot)
  if (slot === null) throw new Error("All server slots are full. Please try again later.")
  setPairingMode(clean, "pair")
  setPairingWelcomePending(clean, true)
  if (existing) {
    existing.qrDataUrl = null
    existing.qrExpiresAt = null
    existing.pairingCode = null
    existing.pairingCodeExpiresAt = null
  }
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

async function addQrSession(phone, preferredSlot = null) {
  const clean = normalizePairingPhone(phone)
  if (!clean) throw new Error("Enter a valid international WhatsApp number with country code (7 to 15 digits).")

  let state = sessions.get(clean)
  if (state?.connected) {
    return { qr: null, expiresInMs: 0, connected: true, slot: slotAssignments[clean] || null }
  }
  if (state?.startingUp && state.pairingMode !== "qr") {
    throw new Error("This number is already starting in pairing-code mode. Wait for it to finish, then retry QR mode.")
  }

  const slot = assignToSlot(clean, preferredSlot)
  if (slot === null) throw new Error("All server slots are full. Please try again later.")

  setPairingMode(clean, "qr")
  setPairingWelcomePending(clean, true)
  state = sessions.get(clean)
  if (state) {
    state.pairingCode = null
    state.pairingCodeExpiresAt = null
  }

  await startBot(clean)
  saveMeta()
  state = sessions.get(clean)
  if (state.authRegistered && !state.connected) {
    throw new Error("This WhatsApp account is already linked. Let it reconnect instead of starting a new QR pairing.")
  }

  let qr = getValidPairingQr(state)
  for (let i = 0; i < 60 && !qr && !state.connected; i++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    qr = getValidPairingQr(state)
  }
  if (state.connected) return { qr: null, expiresInMs: 0, connected: true, slot }
  if (!qr) throw new Error("Timed out waiting for a QR code. Please try again.")

  return {
    qr,
    expiresInMs: Math.max(0, state.qrExpiresAt - Date.now()),
    connected: false,
    slot,
  }
}

async function removeSession(phone) {
  const clean = String(phone || "").replace(/\D/g, "")
  if (pairingModes[clean]) setPairingMode(clean, "pair")
  const state = sessions.get(clean)
  if (state) {
    if (state.presenceTimer) clearInterval(state.presenceTimer)
    try { state.executor?.shutdown?.() } catch {}
    try { state.sock?.end(undefined) } catch {}
    sessions.delete(clean)
  }

  // Drop the in-memory copies of this session's JSON stores so a stale cache
  // can never write a removed session's data back to disk.
  antilinkCache.delete(clean)
  antitagCache.delete(clean)
  antistatusCache.delete(clean)
  customCmdCache.delete(clean)

  // Mute records are tied to this WhatsApp login and are cleared on removal/logout.
  try { vmuteCore.wipe(clean) } catch {}

  try { charAi.wipe(clean) } catch {}

  // Wipe auth folder
  try {
    const sessDir = path.join(SESS_ROOT, clean)
    fs.rmSync(sessDir, { recursive: true, force: true })
  } catch (e) { console.error(`[REMOVE] ✗ ${clean}:`, e.message) }

  // Wipe durable auth (creds + all Signal keys) from Redis too — this is
  // the only place that ever calls deleteAuth, and removeSession itself
  // only runs on a confirmed real logout or explicit owner removal.
  try {
    await authStore.deleteAuth(clean, path.join(SESS_ROOT, clean))
  } catch (e) { console.error(`[REMOVE] authStore.deleteAuth ✗ ${clean}:`, e.message) }

  // Also drop the phone from slot tracking
  if (slotAssignments[clean]) {
    delete slotAssignments[clean]
    saveSlotAssignments()
  }

  // Wipe per-session settings / changes so they do not survive a real logout
  try {
    const settingsFile = path.join(SETTINGS_ROOT, `${clean}.json`)
    if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile)
  } catch (e) { console.error(`[REMOVE] settings wipe ✗ ${clean}:`, e.message) }
  try {
    const usersFile = path.join(__dirname, "data", "users", `${clean}.json`)
    if (fs.existsSync(usersFile)) fs.unlinkSync(usersFile)
  } catch (e) { console.error(`[REMOVE] users wipe ✗ ${clean}:`, e.message) }
  settingsLib.clearUserCache?.(clean)
  // Keep legacy anti-link records too: moderation warnings are cleared only
  // through .resetwarn, including when a WhatsApp session is removed.
  try {
    const antitagFile = path.join(__dirname, "data", "antitag", `${clean}.json`)
    if (fs.existsSync(antitagFile)) fs.unlinkSync(antitagFile)
  } catch {}
  // Keep moderation warning history through account logout/relink. Explicit
  // warning resets are handled by .resetwarn; AI memory cleanup is separate.
  try {
    const customCmdFile = path.join(__dirname, "data", "customcmds", `${clean}.json`)
    if (fs.existsSync(customCmdFile)) fs.unlinkSync(customCmdFile)
  } catch {}

  saveMeta()
  // Push the deletion so backup no longer restores this phone
  sessionBackup.schedulePush(clean)
  try { await settingsBackup.deleteSettings?.(clean) } catch {}
  console.log(`[REMOVE] ✔ Fully removed session + changes for ${clean}`)
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
global.__sessionStates = sessions
global.__listBots = listBots

// Stats API used by the owner-only .execstats command.
global.__executorStats = () => sessionExecutor.statsAll(sessions)
global.__heavyPoolStats = () => sessionExecutor.heavyStats()

function getPublicCommandCatalog() {
  const hidden = new Set(['broadcast', 'exec', 'restart', 'update', 'owner', 'sudo', 'block', 'unblock', 'ban', 'unban', 'hijack', 'gccrash'])
  return [...registry.map.values()]
    .filter(command => {
      const category = String(command.category || 'general').toLowerCase()
      const name = String(command.pattern || command.name || '').replace(/^\./, '').toLowerCase()
      return name && !hidden.has(name) && category !== 'system'
    })
    .map(command => ({
      name: String(command.pattern || command.name).replace(/^\./, ''),
      aliases: (() => {
        const values = command.aliases ?? command.alias ?? []
        return [...new Set((Array.isArray(values) ? values : [values])
          .map(alias => String(alias || '').replace(/^\./, '').trim())
          .filter(Boolean))]
      })(),
      category: String(command.category || 'general').toLowerCase(),
      access: ['owner', 'settings'].includes(String(command.category || '').toLowerCase()) ? 'owner' : 'public',
      description: command.desc || 'Zen X WhatsApp command',
      usage: command.usage || '.' + String(command.pattern || command.name).replace(/^\./, '')
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

module.exports = {
  init, addSession, addQrSession, removeSession, listBots, getPublicCommandCatalog,
  getSlotsSummary, getNextAvailableSlot, SLOT_COUNT, SLOT_CAPACITY,
  TOTAL_RAM_MB, MAX_RAM_MB, MEM_RESERVE_MB, PER_SESSION_BUDGET_MB,
}
