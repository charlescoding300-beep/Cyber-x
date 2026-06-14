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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a comma-separated list of numbers from env into clean digit-only strings.
 * e.g. "2547xxxxxxx, 2348yyyyyyy" -> ["2547xxxxxxx", "2348yyyyyyy"]
 * @param {string} raw
 * @returns {string[]}
 */
function parseOwners(raw) {
  return (raw || "")
    .split(",")
    .map(n => n.replace(/\D/g, ""))
    .filter(Boolean)
}

// ── Default values ────────────────────────────────────────────────────────────
const ENV_OWNERS = parseOwners(process.env.OWNER_NUMBER)

const DEFAULTS = {
  // ── Identity ─────────────────────────────────────────────────────────────
  botName:  process.env.BOT_NAME     || "CYBER X",
  prefix:   process.env.PREFIX       || ".",

  // Primary owner (first in the list) — kept for backward compatibility
  owner:    ENV_OWNERS[0] || "",

  // Full list of owner numbers (supports multiple owners / rotation)
  owners: ENV_OWNERS,

  // ── Mode ─────────────────────────────────────────────────────────────────
  // "public"  → everyone can use commands
  // "private" → ONLY bot owner(s) can use commands
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

// ── Always trust env for owner(s) — never let stale disk data override it ────
// If OWNER_NUMBER is set in .env, it always wins, overwriting whatever was
// saved to settings_store.json from a previous deploy/run.
if (ENV_OWNERS.length > 0) {
  store.owners = ENV_OWNERS
  store.owner  = ENV_OWNERS[0]
}

console.log(`[SETTINGS] ✔ Loaded | mode:${store.mode} prefix:"${store.prefix}" owners:${store.owners.length ? store.owners.join(", ") : "NOT SET"}`)

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
 * Check if a given number/jid belongs to one of the bot owners.
 * Strips WhatsApp suffixes (@s.whatsapp.net, @g.us, :device) and
 * non-digit chars before comparing.
 * @param {string} idOrNumber
 * @returns {boolean}
 */
function isOwner(idOrNumber) {
  if (!idOrNumber) return false
  const clean = idOrNumber.split("@")[0].split(":")[0].replace(/\D/g, "")
  return store.owners.includes(clean)
}

/**
 * Get the list of owner numbers.
 * @returns {string[]}
 */
function getOwners() {
  return [...store.owners]
}

/**
 * Reset everything to defaults and persist.
 * Owner(s) are always re-derived from env, never reset to blank.
 */
function reset() {
  Object.assign(store, { ...DEFAULTS })
  // Keep identity from env
  store.botName = process.env.BOT_NAME || DEFAULTS.botName
  store.prefix  = process.env.PREFIX   || DEFAULTS.prefix
  store.owners  = ENV_OWNERS
  store.owner   = ENV_OWNERS[0] || ""
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
  get owners()   { return store.owners   },
  get mode()     { return store.mode     },

  // API
  get, set, toggle, reset, getAll, isOwner, getOwners,

  // Internals (used by index.js auto-feature hooks)
  DEFAULTS,
  store,
}

module.exports = settings
