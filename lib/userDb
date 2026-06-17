// ─────────────────────────────────────────────────────────────────────────────
// lib/userDb.js  —  CYBER X  |  Per-User Persistent Database
//
// Each linked user gets their own JSON file in data/users/<phone>.json
// This stores ALL their settings, antilink state, welcome messages,
// warn counts, antibadword lists etc.
//
// On bot restart or crash recovery — everything auto-restores from disk.
// Auto-loaded by index.js via lib loader.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const USERS_DIR = path.join(__dirname, "..", "data", "users")
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true })

// In-memory cache: phone -> full user data object
const cache = new Map()

// Debounce timers per user to avoid hammering disk
const saveTimers = new Map()

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT USER DATA STRUCTURE
// Every section has its own namespace so they never conflict
// ─────────────────────────────────────────────────────────────────────────────

function defaultUser(phone) {
  return {
    phone,
    createdAt: new Date().toISOString(),

    // ── Bot Settings ─────────────────────────────────────────────────────────
    settings: {
      botName:        "CYBER X",
      prefix:         ".",
      mode:           "public",     // "public" | "private"
      autoTyping:     false,
      autoRecording:  false,
      autoRead:       false,
      autoReply:      false,
      autoReplyText:  "Hey! I'm CYBER X 🤖. Type .menu to see commands.",
      autoViewStatus: false,
      autoReactStatus: false,
      statusReactEmoji: "🔥",
      alwaysOnline:   false,
    },

    // ── Anti-Link ─────────────────────────────────────────────────────────────
    antilink: {
      enabled: false,
      groups:  {},   // groupJid -> { enabled, action: "warn"|"kick"|"delete" }
    },

    // ── Anti-Badword ──────────────────────────────────────────────────────────
    antibadword: {
      enabled: false,
      words:   [],
      groups:  {},   // groupJid -> { enabled, words: [] }
    },

    // ── Anti-Spam ─────────────────────────────────────────────────────────────
    antispam: {
      enabled:   false,
      threshold: 5,   // messages per 10s before action
      groups:    {},
    },

    // ── Welcome / Goodbye ─────────────────────────────────────────────────────
    welcome: {
      enabled: false,
      groups:  {},   // groupJid -> { enabled, message }
    },
    goodbye: {
      enabled: false,
      groups:  {},
    },

    // ── Warn System ───────────────────────────────────────────────────────────
    warns: {
      maxWarns: 3,
      groups:   {},   // groupJid -> { userJid -> warnCount }
    },

    // ── Anti-Status ───────────────────────────────────────────────────────────
    antistatus: {
      enabled: false,
      groups:  {},
    },

    // ── Mute ──────────────────────────────────────────────────────────────────
    mute: {
      groups: {},   // groupJid -> true/false
    },

    // ── Group Memory (AI context) ─────────────────────────────────────────────
    memory: {
      enabled: false,
      groups:  {},   // groupJid -> [{ role, content }]
    },

    // ── Stats ─────────────────────────────────────────────────────────────────
    stats: {
      totalMessages: 0,
      totalCommands: 0,
      joinedAt:      new Date().toISOString(),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK I/O
// ─────────────────────────────────────────────────────────────────────────────

function filePath(phone) {
  return path.join(USERS_DIR, `${phone}.json`)
}

function loadUser(phone) {
  if (cache.has(phone)) return cache.get(phone)

  const file = filePath(phone)
  let data = defaultUser(phone)

  if (fs.existsSync(file)) {
    try {
      const raw  = JSON.parse(fs.readFileSync(file, "utf8"))
      // Deep merge so new default fields appear without wiping existing data
      data = deepMerge(defaultUser(phone), raw)
    } catch (e) {
      console.error(`[DB] Load error for ${phone}:`, e.message)
    }
  }

  cache.set(phone, data)
  return data
}

function saveUser(phone) {
  clearTimeout(saveTimers.get(phone))
  saveTimers.set(phone, setTimeout(() => {
    const data = cache.get(phone)
    if (!data) return
    try {
      fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2), "utf8")
    } catch (e) {
      console.error(`[DB] Save error for ${phone}:`, e.message)
    }
  }, 300))   // debounce 300ms
}

// ─────────────────────────────────────────────────────────────────────────────
// DEEP MERGE — merges saved data into defaults so new fields always appear
// ─────────────────────────────────────────────────────────────────────────────

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a user's full data (loads from disk if not cached)
 */
function get(phone) {
  return loadUser(phone)
}

/**
 * Get a specific section of a user's data
 * e.g. getSection("2348xxx", "antilink") → { enabled, groups }
 */
function getSection(phone, section) {
  const user = loadUser(phone)
  return user[section]
}

/**
 * Update a specific section and save
 * e.g. setSection("2348xxx", "antilink", { enabled: true })
 */
function setSection(phone, section, data) {
  const user = loadUser(phone)
  if (typeof data === "object" && !Array.isArray(data)) {
    user[section] = { ...user[section], ...data }
  } else {
    user[section] = data
  }
  saveUser(phone)
}

/**
 * Update a nested value inside a section
 * e.g. setNested("2348xxx", "settings", "prefix", "!")
 */
function setNested(phone, section, key, value) {
  const user = loadUser(phone)
  if (!user[section]) user[section] = {}
  user[section][key] = value
  saveUser(phone)
}

/**
 * Get a single setting value
 * e.g. getSetting("2348xxx", "prefix") → "."
 */
function getSetting(phone, key) {
  const user = loadUser(phone)
  return user.settings?.[key]
}

/**
 * Update one or more settings
 * e.g. updateSettings("2348xxx", { prefix: "!", mode: "private" })
 */
function updateSettings(phone, updates) {
  const user = loadUser(phone)
  Object.assign(user.settings, updates)
  saveUser(phone)
}

/**
 * Increment a stat counter
 */
function incStat(phone, stat) {
  const user = loadUser(phone)
  user.stats[stat] = (user.stats[stat] || 0) + 1
  saveUser(phone)
}

/**
 * Reset a user's data to defaults (but keep phone + createdAt)
 */
function resetUser(phone) {
  const fresh = defaultUser(phone)
  cache.set(phone, fresh)
  saveUser(phone)
}

/**
 * Delete a user's data completely
 */
function deleteUser(phone) {
  cache.delete(phone)
  try { fs.unlinkSync(filePath(phone)) } catch {}
}

/**
 * List all phones that have saved data
 */
function listUsers() {
  return fs.readdirSync(USERS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""))
}

/**
 * Restore all users into memory cache on boot
 * Called automatically when this module loads
 */
function restoreAll() {
  const phones = listUsers()
  for (const phone of phones) {
    loadUser(phone)
  }
  console.log(`[DB] ✔ Restored ${phones.length} user database(s)`)
}

// Auto-restore on load
restoreAll()

console.log("[DB] ✔ Per-user database ready")

module.exports = {
  get,
  getSection,
  setSection,
  setNested,
  getSetting,
  updateSettings,
  incStat,
  resetUser,
  deleteUser,
  listUsers,
  saveUser,
}
