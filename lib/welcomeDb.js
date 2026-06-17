// ─────────────────────────────────────────────────────────────────────────────
// lib/welcomeDb.js  —  CYBER X  |  Per-group welcome/goodbye persistent storage
//
// Saves to disk — survives bot restarts, crashes, and redeploys.
//
// Storage path priority:
//   1. Render Disk  → /data/welcome_store.json   (if /data exists & is writable)
//   2. Local        → <project>/data/welcome_store.json
//
// This means:
//   • On Render with a Disk mounted at /data  → fully persistent across deploys
//   • On Render free tier (no disk)           → persists within a session only
//   • Locally / Termux                        → always persists
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

// ── Resolve best storage path ─────────────────────────────────────────────────
function resolvePath() {
  // Render persistent disk is mounted at /data
  const renderDisk = "/data"
  if (fs.existsSync(renderDisk)) {
    try {
      fs.accessSync(renderDisk, fs.constants.W_OK)
      return path.join(renderDisk, "welcome_store.json")
    } catch {}
  }
  // Fallback: local data/ folder next to index.js
  const localDir = path.join(__dirname, "..", "data")
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true })
  return path.join(localDir, "welcome_store.json")
}

const STORE_PATH = resolvePath()
console.log(`[WELCOMEDB] ✔ Storage: ${STORE_PATH}`)

// ── Load from disk ────────────────────────────────────────────────────────────
function load() {
  try {
    if (fs.existsSync(STORE_PATH))
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))
  } catch (e) {
    console.error("[WELCOMEDB] Load error:", e.message)
  }
  return {}
}

// ── In-memory db (singleton) ──────────────────────────────────────────────────
const db = load()

// ── Debounced save ────────────────────────────────────────────────────────────
let saveTimer = null
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(db, null, 2), "utf8")
    } catch (e) {
      console.error("[WELCOMEDB] Save error:", e.message)
    }
  }, 300)
}

// ── Save immediately on crash / exit so nothing is lost ──────────────────────
function saveNow() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(db, null, 2), "utf8")
  } catch {}
}
process.on("exit",           saveNow)
process.on("SIGINT",         () => { saveNow(); process.exit(0) })
process.on("SIGTERM",        () => { saveNow(); process.exit(0) })
process.on("uncaughtException", (e) => {
  console.error("[WELCOMEDB] uncaughtException — saving before crash:", e.message)
  saveNow()
})

// ── Ensure group entry exists ─────────────────────────────────────────────────
function ensure(groupId) {
  if (!db[groupId]) db[groupId] = {}
}

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Get one field for a group.
 * @param {string} groupId
 * @param {string} key
 * @param {*}      fallback
 */
function get(groupId, key, fallback = null) {
  const g = db[groupId]
  if (!g || !(key in g) || g[key] === undefined) return fallback
  return g[key]
}

/**
 * Set one or many fields for a group and persist.
 * @param {string}        groupId
 * @param {string|Object} keyOrObj
 * @param {*}             [value]
 */
function set(groupId, keyOrObj, value) {
  ensure(groupId)
  if (typeof keyOrObj === "object") {
    Object.assign(db[groupId], keyOrObj)
  } else {
    db[groupId][keyOrObj] = value
  }
  save()
}

/**
 * Get the full config object for a group (read-only snapshot).
 * @param {string} groupId
 * @returns {Object}
 */
function getGroup(groupId) {
  return db[groupId] ? { ...db[groupId] } : {}
}

/**
 * Delete one field for a group.
 * @param {string} groupId
 * @param {string} key
 */
function del(groupId, key) {
  if (db[groupId]) {
    delete db[groupId][key]
    save()
  }
}

/**
 * Wipe all settings for a group.
 * @param {string} groupId
 */
function reset(groupId) {
  db[groupId] = {}
  save()
}

module.exports = { get, set, getGroup, del, reset }
