// ─────────────────────────────────────────────────────────────────────────────
// lib/settings.js  —  CYBER X  |  Persistent Bot Settings
//
// TWO LAYERS:
//   1. Global store  → applies to everyone (saved to data/settings_store.json)
//   2. Per-user store → loaded from lib/userDb, overrides global per-user
//
// Usage in index.js / commands:
//   const settings = require("./lib/settings")
//
//   settings.get("autoTyping")              // global value
//   settings.forUser(phone).get("autoTyping") // user override → falls back to global
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

require("dotenv").config()

// ── Try to load userDb (soft dependency) ─────────────────────────────────────
let userDb = null
try { userDb = require("./userDb") } catch {}

// ── Storage file ──────────────────────────────────────────────────────────────
const STORE_PATH = path.join(__dirname, "..", "data", "settings_store.json")
const dataDir    = path.dirname(STORE_PATH)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseOwners(raw) {
  return (raw || "")
    .split(",")
    .map(n => n.replace(/\D/g, ""))
    .filter(Boolean)
}

const ENV_OWNERS = parseOwners(process.env.OWNER_NUMBER)

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  botName:          process.env.BOT_NAME || "CYBER X",
  prefix:           process.env.PREFIX   || ".",
  owner:            ENV_OWNERS[0] || "",
  owners:           ENV_OWNERS,
  mode:             "public",
  autoTyping:       false,
  autoRecording:    false,
  autoReply:        false,
  autoReplyText:    "Hey! I'm CYBER X 🤖. Type {prefix}menu to see commands.",
  autoViewStatus:   false,
  autoReactStatus:  false,
  statusReactEmoji: "🔥",
  autoRead:         false,
  antiLink:         false,
  antiSpam:         false,
  welcome:          false,
  goodbye:          false,
  alwaysOnline:     false,
  blockNonContact:  false,
  groupOnly:        false,
  dmOnly:           false,
}

// ── Load global store ─────────────────────────────────────────────────────────
function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))
      return { ...DEFAULTS, ...data }
    }
  } catch (e) {
    console.error("[SETTINGS] Load error:", e.message)
  }
  return { ...DEFAULTS }
}

// ── Debounced persist ─────────────────────────────────────────────────────────
let saveTimer = null
function persist(store) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8")
    } catch (e) {
      console.error("[SETTINGS] Save error:", e.message)
    }
  }, 300)
}

// ── Global store (singleton) ──────────────────────────────────────────────────
const store = loadStore()

// Env owners always win over stale disk data
if (ENV_OWNERS.length > 0) {
  store.owners = ENV_OWNERS
  store.owner  = ENV_OWNERS[0]
}

console.log(`[SETTINGS] ✔ Loaded | mode:${store.mode} prefix:"${store.prefix}" owners:${store.owners.length ? store.owners.join(", ") : "NOT SET"}`)

// ── Global API ────────────────────────────────────────────────────────────────
function get(key) {
  return key in store ? store[key] : DEFAULTS[key]
}

function set(keyOrObj, value) {
  if (typeof keyOrObj === "object") {
    Object.assign(store, keyOrObj)
  } else {
    store[keyOrObj] = value
  }
  persist(store)
}

function toggle(key) {
  store[key] = !store[key]
  persist(store)
  return store[key]
}

function isOwner(idOrNumber) {
  if (!idOrNumber) return false
  const clean = idOrNumber.split("@")[0].split(":")[0].replace(/\D/g, "")
  return store.owners.includes(clean)
}

function getOwners() {
  return [...store.owners]
}

function reset() {
  Object.assign(store, { ...DEFAULTS })
  store.botName = process.env.BOT_NAME || DEFAULTS.botName
  store.prefix  = process.env.PREFIX   || DEFAULTS.prefix
  store.owners  = ENV_OWNERS
  store.owner   = ENV_OWNERS[0] || ""
  persist(store)
}

function getAll() {
  return { ...store }
}

// ── Per-user settings layer ───────────────────────────────────────────────────
// Returns a helper that checks user overrides first, falls back to global.
// Auto-discovers keys from userDb without any manual wiring.
//
// Usage:
//   const u = settings.forUser("2547xxxxxxx")
//   u.get("autoTyping")     // user value if set, else global
//   u.get("prefix")         // same
//   u.isSet("autoTyping")   // true only if the user explicitly set it
//
function forUser(phoneOrJid) {
  // Clean the phone — strip @s.whatsapp.net etc.
  const phone = (phoneOrJid || "")
    .split("@")[0].split(":")[0].replace(/\D/g, "")

  // Pull user's saved settings section (returns {} if userDb not available)
  const userSettings = userDb ? (userDb.getSection(phone, "settings") || {}) : {}

  return {
    /**
     * Get a setting — user value wins, falls back to global store.
     */
    get(key) {
      if (key in userSettings && userSettings[key] !== undefined && userSettings[key] !== null) {
        return userSettings[key]
      }
      return get(key)  // global fallback
    },

    /**
     * True only if the user has explicitly set this key themselves.
     */
    isSet(key) {
      return key in userSettings && userSettings[key] !== undefined
    },

    /**
     * All settings merged: global base + user overrides on top.
     */
    all() {
      return { ...store, ...userSettings }
    },

    /**
     * Update a user setting (saves to userDb).
     */
    set(keyOrObj) {
      if (!userDb) return
      if (typeof keyOrObj === "object") {
        userDb.updateSettings(phone, keyOrObj)
      } else {
        const [k, v] = [keyOrObj, arguments[1]]
        userDb.updateSettings(phone, { [k]: v })
      }
    },
  }
}

// ── Compatibility shim (index.js accesses these as flat properties) ───────────
const settings = {
  get botName()  { return store.botName },
  get prefix()   { return store.prefix  },
  get owner()    { return store.owner   },
  get owners()   { return store.owners  },
  get mode()     { return store.mode    },

  // API
  get, set, toggle, reset, getAll, isOwner, getOwners,

  // ✨ Per-user layer — auto-loads any setting saved by any command
  forUser,

  // Internals
  DEFAULTS,
  store,
}

module.exports = settings
