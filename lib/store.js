"use strict"

const fs = require("fs")
const path = require("path")

// Central VPS SQLite database — source of truth
const db = require(path.join(__dirname, "../../zenx-db/database"))

const ROOT = path.join(__dirname, "..")
const DATA_DIR = path.join(ROOT, "data")
const SESSION_DIR = path.join(ROOT, "session")
const STORE_FILE = path.join(DATA_DIR, "store.json")
const BACKUP_FILE = path.join(SESSION_DIR, "data_backup.json")

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
}

// Generic command-state storage lives in app_data.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_data (
    namespace TEXT NOT NULL,
    data_key TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (namespace, data_key)
  )
`)

const getStmt = db.prepare(`
  SELECT data
  FROM app_data
  WHERE namespace = ? AND data_key = ?
`)

const setStmt = db.prepare(`
  INSERT INTO app_data (namespace, data_key, data, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(namespace, data_key)
  DO UPDATE SET
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`)

const delStmt = db.prepare(`
  DELETE FROM app_data
  WHERE namespace = ? AND data_key = ?
`)

const namespaceStmt = db.prepare(`
  SELECT data_key, data
  FROM app_data
  WHERE namespace = ?
`)

function clone(value) {
  if (value === undefined) return undefined

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function parse(value, fallback = undefined) {
  if (value === null || value === undefined) {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function ensureNamespace(namespace, defaults = {}) {
  for (const [key, value] of Object.entries(defaults)) {
    const existing = getStmt.get(namespace, key)

    if (!existing) {
      setStmt.run(
        namespace,
        key,
        JSON.stringify(value)
      )
    }
  }
}

function migrateLegacyStore() {
  let legacy = null

  // Prefer existing data/store.json.
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8")

      if (raw.trim()) {
        legacy = JSON.parse(raw)
      }
    }
  } catch (error) {
    console.error(
      "[STORE] Legacy store.json read error:",
      error.message
    )
  }

  // If store.json is unavailable, try the old backup.
  if (!legacy) {
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        const raw = fs.readFileSync(BACKUP_FILE, "utf8")

        if (raw.trim()) {
          legacy = JSON.parse(raw)
        }
      }
    } catch (error) {
      console.error(
        "[STORE] Legacy backup read error:",
        error.message
      )
    }
  }

  if (!legacy || typeof legacy !== "object") {
    return
  }

  let migrated = 0

  const transaction = db.transaction(() => {
    for (const [namespace, values] of Object.entries(legacy)) {
      if (!values || typeof values !== "object") {
        continue
      }

      for (const [key, value] of Object.entries(values)) {
        const existing = getStmt.get(namespace, key)

        // SQLite always wins if the key already exists.
        if (!existing) {
          setStmt.run(
            namespace,
            key,
            JSON.stringify(value)
          )

          migrated++
        }
      }
    }
  })

  transaction()

  if (migrated > 0) {
    console.log(
      `[STORE] ✔ Migrated ${migrated} legacy value(s) into VPS SQLite`
    )
  }
}

// One-time migration of the existing command store.
migrateLegacyStore()

console.log("[STORE] ✔ SQLite command store enabled")
console.log("[STORE] Database:", path.join(
  __dirname,
  "../../zenx-db/zenx.db"
))

function createStore(namespace, defaults = {}) {
  ensureNamespace(namespace, defaults)

  const handle = {
    get(key) {
      const row = getStmt.get(namespace, key)

      if (!row) {
        return clone(defaults[key])
      }

      return clone(
        parse(row.data, defaults[key])
      )
    },

    set(key, value) {
      setStmt.run(
        namespace,
        key,
        JSON.stringify(value)
      )
    },

    update(key, fn) {
      const current = handle.get(key)

      const next = fn(
        current === undefined
          ? clone(defaults[key])
          : current
      )

      setStmt.run(
        namespace,
        key,
        JSON.stringify(next)
      )

      return next
    },

    del(key) {
      delStmt.run(namespace, key)
    },

    flush() {
      // SQLite writes are synchronous.
      // Nothing needs to be flushed.
      return true
    },

    all() {
      const rows = namespaceStmt.all(namespace)
      const result = {}

      for (const row of rows) {
        result[row.data_key] = parse(row.data)
      }

      return clone(result)
    }
  }

  return handle
}

function saveNow() {
  // Kept for compatibility with older modules.
  return true
}

module.exports = {
  createStore,
  saveNow,
}
