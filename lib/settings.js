"use strict"

const fs   = require("fs")
const path = require("path")
const persistence = require("../database/persistence")
require("dotenv").config()

// ── Storage paths ────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, "..", "data")
const STORE_PATH  = path.join(DATA_DIR, "settings_store.json")
const USERS_DIR   = path.join(DATA_DIR, "users")
const GLOBAL_SETTINGS_NAMESPACE = "global_settings"
const GLOBAL_SETTINGS_KEY = "main"

if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true })

// Per-session settings use the local SQLite database, with JSON retained as
// a compatibility mirror and one-time migration source.
let settingsBackup = null
try { settingsBackup = require("./settingsBackup") } catch {}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseOwners(raw) {
  return (raw || "")
    .split(",")
    .map(n => n.replace(/\D/g, ""))
    .filter(Boolean)
}
const ENV_OWNERS = parseOwners(process.env.OWNER_NUMBER)

function cleanPhone(phoneOrJid) {
  return (phoneOrJid || "").split("@")[0].split(":")[0].replace(/\D/g, "")
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  botName:          process.env.BOT_NAME || "ZENX",
  prefix:           process.env.BOT_PREFIX || ".",
  owner:            ENV_OWNERS[0] || "",
  owners:           ENV_OWNERS,
  mode:             "public",
  autoTyping:       false,
  autoRecording:    false,
  autoReply:        false,
  autoReplyText:    "Hey! I'm ZENX 🤖. Type {prefix}menu to see commands.",
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
  const saved = persistence.get(GLOBAL_SETTINGS_NAMESPACE, GLOBAL_SETTINGS_KEY, null)
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    return { ...DEFAULTS, ...saved }
  }

  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"))
      const loaded = data && typeof data === "object" && !Array.isArray(data) ? data : {}
      persistence.set(GLOBAL_SETTINGS_NAMESPACE, GLOBAL_SETTINGS_KEY, loaded)
      return { ...DEFAULTS, ...loaded }
    }
  } catch (e) {
    console.error("[SETTINGS] Load error:", e.message)
  }
  return { ...DEFAULTS }
}

// ── Immediate local SQLite persist (global) ──────────────────────────────────
function persist(store) {
  try {
    persistence.set(GLOBAL_SETTINGS_NAMESPACE, GLOBAL_SETTINGS_KEY, store)
  } catch (e) {
    console.error("[SETTINGS] SQLite save error:", e.message)
  }
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8")
  } catch (e) {
    console.error("[SETTINGS] JSON mirror save error:", e.message)
  }
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
  const clean = cleanPhone(idOrNumber)
  return store.owners.includes(clean)
}

function getOwners() {
  return [...store.owners]
}

function reset() {
  Object.assign(store, { ...DEFAULTS })
  store.botName = process.env.BOT_NAME || DEFAULTS.botName
  store.prefix  = process.env.BOT_PREFIX || DEFAULTS.prefix
  store.owners  = ENV_OWNERS
  store.owner   = ENV_OWNERS[0] || ""
  persist(store)
}

function getAll() {
  return { ...store }
}

// ── Per-user settings layer (self-contained, no userDb needed) ────────────────
const userFileCache = new Map()
const USER_FILE_CACHE_MAX = 2048

function cacheUserFile(phone, data) {
  userFileCache.delete(phone)
  userFileCache.set(phone, data)
  if (userFileCache.size > USER_FILE_CACHE_MAX) {
    userFileCache.delete(userFileCache.keys().next().value)
  }
  return data
}

function userFilePath(phone) {
  return path.join(USERS_DIR, `${phone}.json`)
}

function readUserFile(phone) {
  if (userFileCache.has(phone)) {
    const cached = userFileCache.get(phone)
    userFileCache.delete(phone)
    userFileCache.set(phone, cached)
    return cached
  }

  try {
    const saved = settingsBackup?.loadSettings?.(phone)
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return cacheUserFile(phone, saved)
    }
  } catch (e) {
    console.error(`[SETTINGS] SQLite user load error (${phone}):`, e.message)
  }

  const file = userFilePath(phone)
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"))
      const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
      cacheUserFile(phone, data)
      persistToSQLite(phone, data)
      return data
    }
  } catch (e) {
    console.error(`[SETTINGS] User load error (${phone}):`, e.message)
  }
  return cacheUserFile(phone, {})
}

function clearUserCache(phoneOrJid) {
  userFileCache.delete(cleanPhone(phoneOrJid))
}

function persistToSQLite(phone, data) {
  if (!settingsBackup) return
  try {
    if (typeof settingsBackup.saveSettings === "function") {
      settingsBackup.saveSettings(phone, data)
      return
    }
    settingsBackup.pushSettings(phone, data).catch(e => {
      console.error(`[SETTINGS] SQLite user save error (${phone}):`, e.message)
    })
  } catch (e) {
    console.error(`[SETTINGS] SQLite user save error (${phone}):`, e.message)
  }
}

function writeUserFile(phone, data) {
  flushUserFile(phone, data)
}

function flushUserFile(phone, data) {
  cacheUserFile(phone, data)
  // Commit to SQLite synchronously so a quick process restart cannot lose
  // a command's setting change. Keep the JSON file for older integrations.
  persistToSQLite(phone, data)
  try {
    fs.mkdirSync(USERS_DIR, { recursive: true })
    fs.writeFileSync(userFilePath(phone), JSON.stringify(data, null, 2), "utf8")
  } catch (e) {
    console.error(`[SETTINGS] User JSON mirror error (${phone}):`, e.message)
  }
}

function forUser(phoneOrJid) {
  const phone = cleanPhone(phoneOrJid)
  // Load once when the session settings object is created. Message and command
  // hot paths then read memory instead of doing existsSync/readFileSync/parse
  // for every setting lookup. All writes below update this same cached object.
  const fileData = readUserFile(phone)
  if (!fileData.settings || typeof fileData.settings !== "object") {
    fileData.settings = {}
  }

  function load() {
    return fileData
  }

  return {
    get(key) {
      const fileData = load()
      const userSettings = fileData.settings
      if (key in userSettings && userSettings[key] !== undefined && userSettings[key] !== null) {
        return userSettings[key]
      }
      return get(key)
    },

    isSet(key) {
      const fileData = load()
      return key in fileData.settings && fileData.settings[key] !== undefined
    },

    all() {
      const fileData = load()
      return { ...store, ...fileData.settings }
    },

    getAll() {
      const fileData = load()
      return { ...store, ...fileData.settings }
    },

    // Every setting change is committed to local SQLite immediately.
    set(keyOrObj, value) {
      const fileData = load()
      if (typeof keyOrObj === "object" && keyOrObj !== null) {
        Object.assign(fileData.settings, keyOrObj)
      } else {
        fileData.settings[keyOrObj] = value
      }
      flushUserFile(phone, fileData)
      return fileData.settings
    },

    unset(key) {
      const fileData = load()
      delete fileData.settings[key]
      flushUserFile(phone, fileData)
    },

    flush() {
      const fileData = load()
      flushUserFile(phone, fileData)
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

  get, set, toggle, reset, getAll, isOwner, getOwners,

  forUser,
  clearUserCache,

  DEFAULTS,
  store,
}

module.exports = settings
