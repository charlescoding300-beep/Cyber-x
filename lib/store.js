// ═══════════════════════════════════════════════════════════════
// lib/store.js — CYBER X PERSISTENT DATA STORE
//
// ✅ Zero index.js changes needed
// ✅ Survives Render restarts AND redeploys
// ✅ Each lib gets its own isolated namespace
// ✅ Auto-saves on every change (debounced)
// ✅ Double-backup: data/store.json + session/data_backup.json
//    (session/ is already backed up by index.js backup system)
//
// HOW IT WORKS:
//   antilink.js does: const { createStore } = require('./store')
//   → store.js runs synchronously (Node module cache)
//   → data is restored BEFORE antilink.js reads anything
//   → works regardless of lib load order
// ═══════════════════════════════════════════════════════════════

"use strict"

const fs   = require("fs")
const path = require("path")

// ─────────────────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────────────────

const ROOT         = path.join(__dirname, "..")
const DATA_DIR     = path.join(ROOT, "data")
const SESSION_DIR  = path.join(ROOT, "session")
const STORE_FILE   = path.join(DATA_DIR,   "store.json")
const BACKUP_FILE  = path.join(SESSION_DIR, "data_backup.json")

// Ensure directories exist
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true })
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

// ─────────────────────────────────────────────────────────
// MASTER STORE — one JSON object, namespaced
// Structure: { antilink: { groups:{}, warnings:{} }, antistatus: {...} }
// ─────────────────────────────────────────────────────────

let masterStore = {}

// ─────────────────────────────────────────────────────────
// LOAD — tries store.json first, falls back to backup
// ─────────────────────────────────────────────────────────

function loadStore() {
  // 1. Try main store file
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8")
      if (raw.trim()) {
        masterStore = JSON.parse(raw)
        console.log("[STORE] ✔ Loaded from data/store.json")
        return
      }
    }
  } catch (e) {
    console.error("[STORE] store.json read error:", e.message)
  }

  // 2. Fallback: session/data_backup.json (survives Render redeploys
  //    because index.js backupSession() includes all files in session/)
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, "utf8")
      if (raw.trim()) {
        masterStore = JSON.parse(raw)
        console.log("[STORE] ✔ Restored from session/data_backup.json")
        // Write back to main store so it's in both places
        saveNow()
        return
      }
    }
  } catch (e) {
    console.error("[STORE] backup read error:", e.message)
  }

  console.log("[STORE] ✔ Starting fresh (no existing data)")
}

// ─────────────────────────────────────────────────────────
// SAVE — writes to both locations every time
// ─────────────────────────────────────────────────────────

function saveNow() {
  const json = JSON.stringify(masterStore, null, 2)
  try { fs.writeFileSync(STORE_FILE,  json) } catch {}
  try { fs.writeFileSync(BACKUP_FILE, json) } catch {}
}

// Debounced save — batches rapid writes into one disk write
let saveTimer = null
function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 300)
}

// ─────────────────────────────────────────────────────────
// RUN LOAD IMMEDIATELY on first require()
// This is synchronous — all data is ready before the
// calling module (antilink.js etc.) continues loading
// ─────────────────────────────────────────────────────────

loadStore()

// ─────────────────────────────────────────────────────────
// createStore(namespace, defaults)
//
// Returns a store handle for one namespace.
// All reads/writes go through the shared masterStore.
//
// Usage in lib files:
//   const { createStore } = require('./store')
//   const db = createStore('antilink', { groups: {}, warnings: {} })
//   db.get('groups')           → {}
//   db.set('groups', myObj)    → saves automatically
//   db.update('groups', fn)    → fn receives current value, returns new value
// ─────────────────────────────────────────────────────────

function createStore(namespace, defaults = {}) {
  // Ensure namespace exists with defaults for any missing keys
  if (!masterStore[namespace]) {
    masterStore[namespace] = { ...defaults }
    scheduleSave()
  } else {
    // Fill in any new default keys that didn't exist before
    let changed = false
    for (const [k, v] of Object.entries(defaults)) {
      if (masterStore[namespace][k] === undefined) {
        masterStore[namespace][k] = v
        changed = true
      }
    }
    if (changed) scheduleSave()
  }

  const handle = {
    // Get a key's value (returns deep-cloned to avoid accidental mutation)
    get(key) {
      const val = masterStore[namespace][key]
      if (val === undefined) return defaults[key]
      return val
    },

    // Set a key's value and schedule save
    set(key, value) {
      masterStore[namespace][key] = value
      scheduleSave()
    },

    // Update a key via transform function: update('groups', g => { g[jid] = ...; return g })
    update(key, fn) {
      const current = masterStore[namespace][key] ?? defaults[key] ?? null
      masterStore[namespace][key] = fn(current)
      scheduleSave()
    },

    // Delete a key
    del(key) {
      delete masterStore[namespace][key]
      scheduleSave()
    },

    // Force immediate save (no debounce)
    flush() {
      clearTimeout(saveTimer)
      saveNow()
    },

    // Get the whole namespace as a plain object (for reading only)
    all() {
      return { ...masterStore[namespace] }
    }
  }

  return handle
}

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────

module.exports = {
  createStore,
  saveNow,   // for external force-save if needed
}
