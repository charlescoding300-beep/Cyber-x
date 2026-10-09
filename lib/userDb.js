"use strict"

// ─────────────────────────────────────────────────────────────────────────────
// ZENX — SQLite-backed per-user persistence
//
// Source of truth:
//   database/zenx.db
//
// Namespace:
//   app_data / userdb / <phone>
//
// The public API intentionally remains compatible with the previous userDb
// implementation so existing commands do not need to change.
// ─────────────────────────────────────────────────────────────────────────────

const db = require("../database/database")

const cache = new Map()

const getStmt = db.prepare(`
  SELECT data
  FROM app_data
  WHERE namespace = 'userdb'
    AND data_key = ?
  LIMIT 1
`)

const setStmt = db.prepare(`
  INSERT INTO app_data (
    namespace,
    data_key,
    data,
    updated_at
  )
  VALUES ('userdb', ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(namespace, data_key)
  DO UPDATE SET
    data = excluded.data,
    updated_at = CURRENT_TIMESTAMP
`)

const deleteStmt = db.prepare(`
  DELETE FROM app_data
  WHERE namespace = 'userdb'
    AND data_key = ?
`)

const listStmt = db.prepare(`
  SELECT data_key
  FROM app_data
  WHERE namespace = 'userdb'
  ORDER BY data_key
`)

function cleanPhone(phone) {
  return String(phone || "")
    .split("@")[0]
    .split(":")[0]
    .replace(/\D/g, "")
}

function defaultUser(phone) {
  const now = new Date().toISOString()

  return {
    phone,
    createdAt: now,

    settings: {
      botName: "ZENX",
      prefix: ".",
      mode: "public",
      autoTyping: false,
      autoRecording: false,
      autoRead: false,
      autoReply: false,
      autoReplyText: "Hey! I'm ZENX 🤖. Type .menu to see commands.",
      autoViewStatus: false,
      autoReactStatus: false,
      statusReactEmoji: "🔥",
      alwaysOnline: false,
    },

    antilink: {
      enabled: false,
      groups: {},
    },

    antibadword: {
      enabled: false,
      words: [],
      groups: {},
    },

    antispam: {
      enabled: false,
      threshold: 5,
      groups: {},
    },

    welcome: {
      enabled: false,
      groups: {},
    },

    goodbye: {
      enabled: false,
      groups: {},
    },

    warns: {
      maxWarns: 3,
      groups: {},
    },

    antistatus: {
      enabled: false,
      groups: {},
    },

    mute: {
      groups: {},
    },

    memory: {
      enabled: false,
      groups: {},
    },

    stats: {
      totalMessages: 0,
      totalCommands: 0,
      joinedAt: now,
    },
  }
}

function deepMerge(target, source) {
  const result = { ...target }

  if (!source || typeof source !== "object") {
    return result
  }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = target[key]

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue)
    } else {
      result[key] = sourceValue
    }
  }

  return result
}

function loadUser(phoneInput) {
  const phone = cleanPhone(phoneInput)

  if (!phone) {
    throw new Error("userDb: invalid phone")
  }

  if (cache.has(phone)) {
    return cache.get(phone)
  }

  const row = getStmt.get(phone)

  let data = defaultUser(phone)

  if (row && row.data) {
    try {
      const raw = JSON.parse(row.data)
      data = deepMerge(data, raw)
    } catch (err) {
      console.error(
        `[DB:${phone}] Invalid SQLite user data:`,
        err.message
      )
    }
  }

  cache.set(phone, data)

  // Ensure new default fields are persisted when an old record is loaded.
  saveUser(phone)

  return data
}

function saveUser(phoneInput) {
  const phone = cleanPhone(phoneInput)
  const data = cache.get(phone)

  if (!phone || !data) return

  try {
    setStmt.run(phone, JSON.stringify(data))
  } catch (err) {
    console.error(`[DB:${phone}] SQLite save error:`, err.message)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

function get(phone) {
  return loadUser(phone)
}

function getSection(phone, section) {
  const user = loadUser(phone)
  return user[section]
}

function setSection(phone, section, data) {
  const user = loadUser(phone)

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    user[section] = {
      ...(user[section] || {}),
      ...data,
    }
  } else {
    user[section] = data
  }

  saveUser(phone)
  return user[section]
}

function setNested(phone, section, key, value) {
  const user = loadUser(phone)

  if (
    !user[section] ||
    typeof user[section] !== "object" ||
    Array.isArray(user[section])
  ) {
    user[section] = {}
  }

  user[section][key] = value

  saveUser(phone)

  return value
}

function getSetting(phone, key) {
  const user = loadUser(phone)
  return user.settings?.[key]
}

function updateSettings(phone, updates) {
  const user = loadUser(phone)

  if (!user.settings || typeof user.settings !== "object") {
    user.settings = {}
  }

  Object.assign(user.settings, updates || {})

  saveUser(phone)

  return user.settings
}

function incStat(phone, stat) {
  const user = loadUser(phone)

  if (!user.stats || typeof user.stats !== "object") {
    user.stats = {}
  }

  user.stats[stat] = (user.stats[stat] || 0) + 1

  saveUser(phone)

  return user.stats[stat]
}

function resetUser(phoneInput) {
  const phone = cleanPhone(phoneInput)

  if (!phone) {
    throw new Error("userDb: invalid phone")
  }

  const fresh = defaultUser(phone)

  cache.set(phone, fresh)
  saveUser(phone)

  return fresh
}

function deleteUser(phoneInput) {
  const phone = cleanPhone(phoneInput)

  if (!phone) return

  cache.delete(phone)

  try {
    deleteStmt.run(phone)
  } catch (err) {
    console.error(`[DB:${phone}] SQLite delete error:`, err.message)
  }
}

function listUsers() {
  return listStmt
    .all()
    .map(row => row.data_key)
    .filter(Boolean)
}

function restoreAll() {
  const users = listUsers()

  for (const phone of users) {
    loadUser(phone)
  }

  console.log(`[DB] ✔ Restored ${users.length} user database(s) from SQLite`)

  return users.length
}

// Compatibility function.
//
// Redis is intentionally gone. Existing startup code may still call
// restoreAllFromRedis(), so keep the function name temporarily and make it
// restore from SQLite instead of contacting any external service.
async function restoreAllFromRedis() {
  return restoreAll()
}

restoreAll()

console.log("[DB] ✔ SQLite per-user database ready")

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
  restoreAll,
  restoreAllFromRedis,

  // Kept for compatibility with any old caller.
  // Redis itself is no longer enabled or used.
  redisEnabled: false,
}
