"use strict"

const fs = require("fs")
const path = require("path")
const persistence = require("../database/persistence")

const SETTINGS_NAMESPACE = "session_settings"
const ALIVE_NAMESPACE = "session_alive"
const DEFAULT_USERS_DIR = path.join(__dirname, "..", "data", "users")

function cleanPhone(phone) {
  return String(phone || "").split("@")[0].split(":")[0].replace(/\D/g, "")
}

function loadSettings(phone) {
  const clean = cleanPhone(phone)
  return clean ? persistence.get(SETTINGS_NAMESPACE, clean, null) : null
}

function saveSettings(phone, data) {
  const clean = cleanPhone(phone)
  if (!clean || !data || typeof data !== "object" || Array.isArray(data)) return false
  persistence.set(SETTINGS_NAMESPACE, clean, data)
  return true
}

async function pushSettings(phone, data) {
  return saveSettings(phone, data)
}

async function pullSettings(phone) {
  return loadSettings(phone)
}

async function deleteSettings(phone) {
  const clean = cleanPhone(phone)
  if (!clean) return false
  persistence.remove(SETTINGS_NAMESPACE, clean)
  return true
}

async function restoreAllSettings(usersDir = DEFAULT_USERS_DIR) {
  let migrated = 0
  if (fs.existsSync(usersDir)) {
    for (const filename of fs.readdirSync(usersDir).filter(name => name.endsWith(".json"))) {
      const phone = cleanPhone(filename.slice(0, -5))
      if (!phone || persistence.has(SETTINGS_NAMESPACE, phone)) continue

      try {
        const data = JSON.parse(fs.readFileSync(path.join(usersDir, filename), "utf8"))
        if (data && typeof data === "object" && !Array.isArray(data)) {
          saveSettings(phone, data)
          migrated++
        }
      } catch (e) {
        console.error(`[SETTINGS] Legacy settings import failed for ${phone}:`, e.message)
      }
    }
  }

  const count = persistence.list(SETTINGS_NAMESPACE).length
  console.log(`[SETTINGS] ✔ SQLite settings ready (${count} session(s); ${migrated} legacy file(s) imported)`)
  return migrated
}

function listSettingsUsers() {
  return persistence.list(SETTINGS_NAMESPACE).map(row => row.data_key)
}

function watchAndSync() {
  // Writes now go directly to SQLite; no filesystem watcher or network backup is needed.
  return true
}

async function markSessionAlive(phone) {
  const clean = cleanPhone(phone)
  if (!clean) return false
  persistence.set(ALIVE_NAMESPACE, clean, { at: Date.now() })
  return true
}

async function isSessionAlive(phone) {
  const clean = cleanPhone(phone)
  if (!clean) return false
  const record = persistence.get(ALIVE_NAMESPACE, clean, null)
  return Number.isFinite(record?.at) && Date.now() - record.at < 8 * 60 * 1000
}

function startKeepAlive(getActivePhones) {
  const timer = setInterval(async () => {
    try {
      const phones = typeof getActivePhones === "function" ? await getActivePhones() : []
      for (const phone of Array.isArray(phones) ? phones : []) await markSessionAlive(phone)
    } catch (e) {
      console.error("[SETTINGS] SQLite keep-alive error:", e.message)
    }
  }, 4 * 60 * 1000)
  timer.unref?.()
  return timer
}

module.exports = {
  pushSettings,
  pullSettings,
  saveSettings,
  loadSettings,
  deleteSettings,
  restoreAllSettings,
  listSettingsUsers,
  watchAndSync,
  markSessionAlive,
  isSessionAlive,
  startKeepAlive,
}
