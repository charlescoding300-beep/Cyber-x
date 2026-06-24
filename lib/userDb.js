// ─────────────────────────────────────────────────────────────────────────────
// lib/userDb.js  —  CYBER X  |  Per-User Persistent Database
//
// Each linked user gets their own JSON file in data/users/<phone>.json
// This stores ALL their settings, antilink state, welcome messages,
// warn counts, antibadword lists etc.
//
// ── PERSISTENCE FIX ───────────────────────────────────────────────────────────
// Render's free-tier filesystem is EPHEMERAL: every restart, redeploy, or
// spin-down-from-inactivity wipes data/users/*.json completely, resetting
// every group's antilink/antibadword/welcome/goodbye/warns back to
// defaults. This is the same problem lib/sessionBackup.js already solved
// for WhatsApp session credentials, using Upstash Redis as a durable
// off-disk store. This file now does the SAME thing for user/group
// settings, reusing the identical Upstash REST API pattern (same env
// vars, same https-based request helper, same per-key isolation so one
// user's corrupted data never blocks anyone else's restore).
//
// Redis key format:  userdb:<phone>   (parallel to session:<phone>)
//
// REQUIRED ENV VARS (already set on Render for sessionBackup.js — reused
// here, no new config needed):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// If these aren't set, this file behaves exactly as it did before —
// disk-only, no remote backup, with the original warning preserved below.
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require("fs")
const path  = require("path")
const https = require("https")

const USERS_DIR = path.join(__dirname, "..", "data", "users")
if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR, { recursive: true })

// In-memory cache: phone -> full user data object
const cache = new Map()

// Debounce timers per user to avoid hammering disk
const saveTimers = new Map()

// ─────────────────────────────────────────────────────────────────────────────
// UPSTASH REDIS — same helper pattern as lib/sessionBackup.js
// ─────────────────────────────────────────────────────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const redisEnabled  = !!(UPSTASH_URL && UPSTASH_TOKEN)

if (!redisEnabled) {
  console.warn("[DB] ⚠ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — group/user settings will NOT survive restarts")
}

function upstashRequest(command, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify([command, ...args])
    const url  = new URL(UPSTASH_URL)

    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname || "/",
      method:   "POST",
      headers:  {
        "Authorization": `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = ""
      res.on("data", c => { chunks += c })
      res.on("end", () => {
        try {
          resolve(JSON.parse(chunks))
        } catch (e) {
          reject(new Error("Upstash response parse failed: " + chunks.slice(0, 100)))
        }
      })
    })
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

async function redisSet(key, value) {
  const res = await upstashRequest("SET", [key, value])
  if (res.error) throw new Error("Redis SET error: " + res.error)
  return res.result
}

async function redisGet(key) {
  const res = await upstashRequest("GET", [key])
  if (res.error) throw new Error("Redis GET error: " + res.error)
  return res.result   // null if key doesn't exist
}

async function redisKeys(pattern) {
  const res = await upstashRequest("KEYS", [pattern])
  if (res.error) throw new Error("Redis KEYS error: " + res.error)
  return res.result || []
}

// ── Push one user's data to Redis — debounced + in-flight guarded ───────────
// Same queue/in-flight pattern as sessionBackup.js's pushUserNow, so rapid
// repeated saves (e.g. many setSection calls in a row) collapse into a
// single push instead of racing each other.
const redisPushTimers = new Map()
const redisPushFlight  = new Map()
const redisPushQueued  = new Map()

async function redisPushNow(phone) {
  if (!redisEnabled) return
  if (redisPushFlight.get(phone)) { redisPushQueued.set(phone, true); return }
  redisPushFlight.set(phone, true)

  try {
    const data = cache.get(phone)
    if (!data) return
    await redisSet(`userdb:${phone}`, JSON.stringify(data))
    console.log(`[DB:${phone}] ✔ Pushed to Upstash Redis`)
  } catch (e) {
    console.error(`[DB:${phone}] ✗ Redis push error:`, e.message)
  } finally {
    redisPushFlight.set(phone, false)
    if (redisPushQueued.get(phone)) {
      redisPushQueued.set(phone, false)
      redisPushNow(phone)
    }
  }
}

function scheduleRedisPush(phone) {
  if (!redisEnabled || !phone) return
  // No debounce delay — push immediately on every save. A 1.5s debounce
  // left a narrow window where a Render crash/restart between the disk
  // write and the delayed Redis push could lose that one change. Pushing
  // instantly closes that gap; redisPushNow's own in-flight/queued guard
  // (above) still collapses rapid back-to-back saves into a single
  // request instead of racing, so this is safe even for setSection calls
  // fired in quick succession.
  clearTimeout(redisPushTimers.get(phone))
  redisPushNow(phone)
}

/**
 * Restore every userdb:* key from Redis into local cache + disk.
 * Call once on boot, BEFORE sessions start handling messages — same
 * timing as sessionBackup.restoreAll().
 */
async function restoreAllFromRedis() {
  if (!redisEnabled) {
    console.warn("[DB] Skipping Redis restore — Upstash not configured")
    return 0
  }

  let keys = []
  try {
    keys = await redisKeys("userdb:*")
  } catch (e) {
    console.error("[DB] ✗ Could not list Redis keys:", e.message)
    return 0
  }

  if (keys.length === 0) {
    console.log("[DB] No user data found in Redis — starting fresh")
    return 0
  }

  console.log(`[DB] Found ${keys.length} user record(s) in Redis — restoring each independently...`)

  let restored = 0
  for (const key of keys) {
    const phone = key.replace("userdb:", "")
    try {
      const jsonStr = await redisGet(key)
      if (!jsonStr) {
        console.warn(`[DB:${phone}] ⚠ key exists but value is empty, skipping`)
        continue
      }
      const raw = JSON.parse(jsonStr)
      const merged = deepMerge(defaultUser(phone), raw)
      cache.set(phone, merged)
      try {
        fs.writeFileSync(filePath(phone), JSON.stringify(merged, null, 2), "utf8")
      } catch (e) {
        console.error(`[DB:${phone}] ✗ disk write after restore failed:`, e.message)
      }
      restored++
      console.log(`[DB:${phone}] ✔ Restored from Redis`)
    } catch (e) {
      // One user's error NEVER stops the loop for other users
      console.error(`[DB:${phone}] ✗ Restore error (skipping):`, e.message)
    }
  }

  console.log(`[DB] ✔ Restored ${restored}/${keys.length} user record(s) from Redis`)
  return restored
}

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
    // Mirror every disk save to Redis too, so it survives the next
    // restart even though the disk write itself won't.
    scheduleRedisPush(phone)
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
  if (redisEnabled) {
    redisSet(`userdb:${phone}`, "").catch(() => {})
  }
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
 * Restore all users into memory cache on boot — disk first, same as before.
 * Redis restore (restoreAllFromRedis) is now called separately and
 * EARLIER from index.js's init(), before this runs, so by the time this
 * executes the cache may already hold fresher data than disk for users
 * whose local JSON was wiped by a restart.
 */
function restoreAll() {
  const phones = listUsers()
  for (const phone of phones) {
    loadUser(phone)
  }
  console.log(`[DB] ✔ Restored ${phones.length} user database(s)`)
}

// Auto-restore from disk on load (unchanged from before — kept for any
// session whose data survived on disk, e.g. a same-instance hot reload
// rather than a true Render restart).
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
  restoreAllFromRedis,
  redisEnabled,
}
