"use strict"

const fs   = require("fs")
const path = require("path")
require("dotenv").config()

// ── Storage paths ────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, "..", "data")
const STORE_PATH  = path.join(DATA_DIR, "settings_store.json")
const USERS_DIR   = path.join(DATA_DIR, "users")

if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true })

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
  botName:          process.env.BOT_NAME || "CYBER X",
  prefix:           process.env.BOT_PREFIX || ".",
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

// ── Debounced persist (global) ─────────────────────────────────────────────────
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

function userFilePath(phone) {
  return path.join(USERS_DIR, `${phone}.json`)
}

function readUserFile(phone) {
  const file = userFilePath(phone)
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"))
      return raw && typeof raw === "object" ? raw : {}
    }
  } catch (e) {
    console.error(`[SETTINGS] User load error (${phone}):`, e.message)
  }
  return {}
}

const userSaveTimers = new Map()
function writeUserFile(phone, data) {
  clearTimeout(userSaveTimers.get(phone))
  const t = setTimeout(() => {
    try {
      fs.writeFileSync(userFilePath(phone), JSON.stringify(data, null, 2), "utf8")
    } catch (e) {
      console.error(`[SETTINGS] User save error (${phone}):`, e.message)
    }
  }, 300)
  userSaveTimers.set(phone, t)
}

function flushUserFile(phone, data) {
  try {
    fs.writeFileSync(userFilePath(phone), JSON.stringify(data, null, 2), "utf8")
  } catch (e) {
    console.error(`[SETTINGS] User flush error (${phone}):`, e.message)
  }
}

function forUser(phoneOrJid) {
  const phone = cleanPhone(phoneOrJid)

  function load() {
    const fileData = readUserFile(phone)
    if (!fileData.settings || typeof fileData.settings !== "object") {
      fileData.settings = {}
    }
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

    set(keyOrObj, value) {
      const fileData = load()
      if (typeof keyOrObj === "object" && keyOrObj !== null) {
        Object.assign(fileData.settings, keyOrObj)
      } else {
        fileData.settings[keyOrObj] = value
      }
      writeUserFile(phone, fileData)
      return fileData.settings
    },

    unset(key) {
      const fileData = load()
      delete fileData.settings[key]
      writeUserFile(phone, fileData)
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

  DEFAULTS,
  store,
}

module.exports = settings
