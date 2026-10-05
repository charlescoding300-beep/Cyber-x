// ══════════════════════════════════════════════════════════════════════
//  lib/persistence.js  —  CYBER X  |  💾 Data Persistence Engine
//
//  Automatically saves and restores:
//    • Slot coin balances      (data/coins.json)
//    • Daily claim timestamps  (data/daily.json)
//    • Hero card collections   (data/cards.json)
//    • Hero API cache          (data/herocache.json)
//
//  Auto-saves every 60 seconds AND on process exit/crash.
//  Drop this file in /lib — it loads automatically before any commands.
// ══════════════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_DIR   = path.join(__dirname, "..", "data")
const SAVE_MS    = 60_000  // auto-save interval: 60 seconds
const COIN_FILE  = path.join(DATA_DIR, "coins.json")
const DAILY_FILE = path.join(DATA_DIR, "daily.json")
const CARDS_FILE = path.join(DATA_DIR, "cards.json")
const CACHE_FILE = path.join(DATA_DIR, "herocache.json")
const META_FILE  = path.join(DATA_DIR, "meta.json")

// ── Ensure data directory exists ──────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log("[PERSIST] 📁 Created data/ directory")
}

// ── Safe JSON read ─────────────────────────────────────────────────────
function readJSON(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.warn(`[PERSIST] ⚠️  Could not read ${path.basename(file)}: ${e.message}`)
    return fallback
  }
}

// ── Safe JSON write ────────────────────────────────────────────────────
function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8")
  } catch (e) {
    console.warn(`[PERSIST] ⚠️  Could not write ${path.basename(file)}: ${e.message}`)
  }
}

// ── Serialise Map → plain object ───────────────────────────────────────
function mapToObj(map) {
  const obj = {}
  for (const [k, v] of map) obj[k] = v
  return obj
}

// ── Serialise Map<string, Set<string>> → { key: [...values] } ─────────
function mapOfSetsToObj(map) {
  const obj = {}
  for (const [k, v] of map) obj[k] = [...v]
  return obj
}

// ── Restore Map from plain object ─────────────────────────────────────
function objToMap(obj) {
  const m = new Map()
  for (const [k, v] of Object.entries(obj)) m.set(k, v)
  return m
}

// ── Restore Map<string, Set<string>> ──────────────────────────────────
function objToMapOfSets(obj) {
  const m = new Map()
  for (const [k, v] of Object.entries(obj)) m.set(k, new Set(Array.isArray(v) ? v : []))
  return m
}

// ══════════════════════════════════════════════════════════════════════
//  LOAD  — runs once on startup, restores all saved data into globals
// ══════════════════════════════════════════════════════════════════════
function loadAll() {
  let restored = 0

  // ── Slot economy ──────────────────────────────────────────────────
  const coinsData = readJSON(COIN_FILE)
  const dailyData = readJSON(DAILY_FILE)

  if (!global.slotData) {
    global.slotData = {
      coins:         new Map(),
      cooldowns:     new Map(),
      daily:         new Map(),
      totalSpins:    0,
      totalJackpots: 0,
    }
  }

  if (Object.keys(coinsData).length > 0) {
    global.slotData.coins = objToMap(coinsData.coins || coinsData)
    global.slotData.totalSpins    = coinsData.totalSpins    || 0
    global.slotData.totalJackpots = coinsData.totalJackpots || 0
    console.log(`[PERSIST] 💰 Restored ${global.slotData.coins.size} coin balances`)
    restored++
  }

  if (Object.keys(dailyData).length > 0) {
    global.slotData.daily = objToMap(dailyData)
    console.log(`[PERSIST] 🎁 Restored ${global.slotData.daily.size} daily timestamps`)
    restored++
  }

  // ── Hero card collections ──────────────────────────────────────────
  const cardsData = readJSON(CARDS_FILE)

  if (!global.heroSystem) {
    global.heroSystem = {
      apiCache:   new Map(),
      collection: new Map(),
      battles:    new Map(),
    }
  }

  if (Object.keys(cardsData).length > 0) {
    global.heroSystem.collection = objToMapOfSets(cardsData)
    const totalCards = [...global.heroSystem.collection.values()]
      .reduce((sum, set) => sum + set.size, 0)
    console.log(`[PERSIST] 🦸 Restored ${global.heroSystem.collection.size} players' card collections (${totalCards} cards total)`)
    restored++
  }

  // ── Hero API cache ─────────────────────────────────────────────────
  const cacheData = readJSON(CACHE_FILE)

  if (Object.keys(cacheData).length > 0) {
    for (const [k, v] of Object.entries(cacheData)) {
      // Keys stored as strings — convert back to number if numeric
      const key = isNaN(k) ? k : Number(k)
      global.heroSystem.apiCache.set(key, v)
    }
    console.log(`[PERSIST] 📡 Restored ${global.heroSystem.apiCache.size} cached hero profiles`)
    restored++
  }

  // ── Meta ──────────────────────────────────────────────────────────
  const meta = readJSON(META_FILE)
  if (meta.lastSave) {
    console.log(`[PERSIST] ⏱️  Last save was: ${meta.lastSave}`)
  }

  console.log(`[PERSIST] ✅ Load complete — ${restored} data file(s) restored`)
}

// ══════════════════════════════════════════════════════════════════════
//  SAVE  — serialises current globals to disk
// ══════════════════════════════════════════════════════════════════════
function saveAll(reason = "auto") {
  let saved = 0

  // ── Slot coins ────────────────────────────────────────────────────
  if (global.slotData?.coins) {
    writeJSON(COIN_FILE, {
      coins:         mapToObj(global.slotData.coins),
      totalSpins:    global.slotData.totalSpins    || 0,
      totalJackpots: global.slotData.totalJackpots || 0,
    })
    saved++
  }

  // ── Daily timestamps ──────────────────────────────────────────────
  if (global.slotData?.daily) {
    writeJSON(DAILY_FILE, mapToObj(global.slotData.daily))
    saved++
  }

  // ── Card collections ──────────────────────────────────────────────
  if (global.heroSystem?.collection) {
    writeJSON(CARDS_FILE, mapOfSetsToObj(global.heroSystem.collection))
    saved++
  }

  // ── Hero API cache (skip null/empty values) ────────────────────────
  if (global.heroSystem?.apiCache?.size > 0) {
    const cacheObj = {}
    for (const [k, v] of global.heroSystem.apiCache) cacheObj[k] = v
    writeJSON(CACHE_FILE, cacheObj)
    saved++
  }

  // ── Meta ──────────────────────────────────────────────────────────
  writeJSON(META_FILE, {
    lastSave: new Date().toISOString(),
    reason,
    players:  global.slotData?.coins?.size      || 0,
    cards:    global.heroSystem?.collection?.size || 0,
  })

  if (reason !== "auto") {
    console.log(`[PERSIST] 💾 Saved (${reason}) — ${saved} file(s) written`)
  }
}

// ══════════════════════════════════════════════════════════════════════
//  AUTO-SAVE LOOP
// ══════════════════════════════════════════════════════════════════════
let saveTimer = null

function startAutoSave() {
  if (saveTimer) return
  saveTimer = setInterval(() => saveAll("auto"), SAVE_MS)
  saveTimer.unref()   // don't block process exit
  console.log(`[PERSIST] ⏰ Auto-save enabled every ${SAVE_MS / 1000}s`)
}

// ══════════════════════════════════════════════════════════════════════
//  SAVE ON EXIT / CRASH / SIGNAL
// ══════════════════════════════════════════════════════════════════════
function setupExitHooks() {
  const handler = (signal) => {
    console.log(`\n[PERSIST] 🚨 ${signal} received — saving before exit...`)
    saveAll(signal)
    process.exit(0)
  }

  process.once("SIGINT",  () => handler("SIGINT"))
  process.once("SIGTERM", () => handler("SIGTERM"))

  process.once("exit", () => {
    // Synchronous save on normal exit
    saveAll("exit")
  })

  // Also save on uncaught errors (best-effort)
  const crashHandler = (err) => {
    console.error("[PERSIST] 💥 Crash detected — saving data...")
    saveAll("crash")
  }

  process.on("uncaughtException",  crashHandler)
  process.on("unhandledRejection", crashHandler)
}

// ══════════════════════════════════════════════════════════════════════
//  INIT — called on lib load
// ══════════════════════════════════════════════════════════════════════
loadAll()
startAutoSave()
setupExitHooks()

console.log("[PERSIST] 💾 Persistence engine active")

// ── Export manual save/load for other modules if needed ───────────────
module.exports = { saveAll, loadAll }
