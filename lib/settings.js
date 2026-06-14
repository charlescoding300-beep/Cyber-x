// ─────────────────────────────────────────────────────────────────────────────
// lib/settings.js  —  CYBER X  |  Persistent Bot Settings
// Survives Render restarts by writing to disk (settings.json)
// Auto-loaded by index.js via lib loader
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

require("dotenv").config()

// ── Storage file — lives next to index.js ────────────────────────────────────
const STORE_PATH = path.join(__dirname, "..", "data", "settings_store.json")

// Ensure data/ dir exists
const dataDir = path.dirname(STORE_PATH)
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

// ── Default values ────────────────────────────────────────────────────────────
const DEFAULTS = {
  // ── Identity ─────────────────────────────────────────────────────────────
  botName:  process.env.BOT_NAME     || "CYBER X",
  prefix:   process.env.PREFIX       || ".",
  owner:    process.env.OWNER_NUMBER || "",

  // ── Mode ─────────────────────────────────────────────────────────────────
  // "public"  → everyone can use commands
  // "private" → ONLY bot owner can use commands
  mode: "public",

  // ── Auto Typing ──────────────────────────────────────────────────────────
  // When ON: bot shows "typing…" for 5 s on NORMAL messages (non-command)
  // Commands ALWAYS fire instantly — zero delay, zero network waste
  autoTyping: false,

  // ── Auto Recording ───────────────────────────────────────────────────────
  // When ON: bot shows "recording audio…" for 5 s on voice-related messages
  autoRecording: false,

  // ── Auto Reply ───────────────────────────────────────────────────────────
  // When ON: bot auto-replies to DMs that are NOT commands
  autoReply:     false,
  autoReplyText: "Hey! I'm CYBER X 🤖. Type {prefix}menu to see commands.",

  // ── Status Viewer ────────────────────────────────────────────────────────
  // When ON: bot auto-views every status update from contacts
  autoViewStatus: false,

  // ── Status React ─────────────────────────────────────────────────────────
  // When ON: bot reacts to statuses it views
  autoReactStatus:  false,
  statusReactEmoji: "🔥",

  // ── Auto Read ────────────────────────────────────────────────────────────
  // When ON: marks every incoming message as read immediately
  autoRead: false,

  // ── Anti-link ────────────────────────────────────────────────────────────
  antiLink: false,

  // ── Anti-spam ────────────────────────────────────────────────────────────
  antiSpam: false,

  // ── Welcome / Goodbye ────────────────────────────────────────────────────
  welcome: false,
  goodbye: false,

  // ── Always-online presence ───────────────────────────────────────────────
  alwaysOnline: false,

  // ── Block non-contacts from using the bot ────────────────────────────────
  blockNonContact: false,

  // ── Group-only / DM-only command restriction ─────────────────────────────
  groupOnly: false,
  dmOnly:    false,
}

// ── Load saved data ──────────────────────────────────────────────────────────
function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw  = fs.readFileSync(STORE_PATH, "utf8")
      const data = JSON.parse(raw)
      return { ...DEFAULTS, ...data }
    }
  } catch (e) {
    console.error("[SETTINGS] Load error:", e.message)
  }
  return { ...DEFAULTS }
}

// ── Save to disk ─────────────────────────────────────────────────────────────
let saveTimer = null
function persist(store) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8")
    } catch (e) {
      console.error("[SETTINGS] Save error:", e.message)
    }
  }, 300)   // debounce — max 1 write per 300 ms
}

// ── Live store (singleton) ───────────────────────────────────────────────────
const store = loadStore()

console.log(`[SETTINGS] ✔ Loaded | mode:${store.mode} prefix:"${store.prefix}" owner:${store.owner || "NOT SET"}`)

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get one setting.
 * @param {string} key
 * @returns {*}
 */
function get(key) {
  return key in store ? store[key] : DEFAULTS[key]
}

/**
 * Set one or many settings and persist to disk.
 * @param {string|Object} keyOrObj  — key string OR { key: value, … }
 * @param {*}             [value]
 */
function set(keyOrObj, value) {
  if (typeof keyOrObj === "object") {
    Object.assign(store, keyOrObj)
  } else {
    store[keyOrObj] = value
  }
  persist(store)
}

/**
 * Toggle a boolean setting. Returns the new value.
 * @param {string} key
 * @returns {boolean}
 */
function toggle(key) {
  store[key] = !store[key]
  persist(store)
  return store[key]
}

/**
 * Reset everything to defaults and persist.
 */
function reset() {
  Object.assign(store, { ...DEFAULTS })
  // Keep identity from env
  store.botName = process.env.BOT_NAME     || DEFAULTS.botName
  store.prefix  = process.env.PREFIX       || DEFAULTS.prefix
  store.owner   = process.env.OWNER_NUMBER || DEFAULTS.owner
  persist(store)
}

/**
 * Get the full store object (read-only snapshot).
 * @returns {Object}
 */
function getAll() {
  return { ...store }
}

// ── Compatibility shim: index.js does `lib.settings.prefix` etc. directly ───
// So we also export the store properties flat on this object
const settings = {
  // Live getters so index.js always sees current values
  get botName()  { return store.botName  },
  get prefix()   { return store.prefix   },
  get owner()    { return store.owner    },
  get mode()     { return store.mode     },

  // API
  get, set, toggle, reset, getAll,

  // Internals (used by index.js auto-feature hooks)
  DEFAULTS,
  store,
}

module.exports = settings
