"use strict"

/*
 * ZEN X — VPS SQLite WhatsApp authentication store
 *
 * Durable source of truth:
 *   ~/zenx-bot/database/zenx.db
 *
 * This keeps the same public API used by index.js:
 *   useAuthState()
 *   restoreAllSessions()
 *   deleteAuth()
 *   pushLocalSessionToRedis()
 *   enabled
 *
 * Redis/Upstash is no longer used.
 */

const fs = require("fs")
const path = require("path")

const {
  proto,
  initAuthCreds,
  BufferJSON
} = require("@whiskeysockets/baileys")

/*
 * Load the central VPS database.
 *
 * ~/zenx-bot/lib/authStore.js
 * ../database/database.js
 * resolves to:
 * ../database/database.js
 */
const db = require(path.join(__dirname, "../database/database"))

console.log("[AUTH] ✔ VPS SQLite durable auth enabled")
console.log("[AUTH] Database:", path.join(__dirname, "../database/zenx.db"))

const enabled = true

// ─────────────────────────────────────────────────────────────
// LOCAL MIRROR
// ─────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeLocalCreds(sessDir, creds) {
  ensureDir(sessDir)

  fs.writeFileSync(
    path.join(sessDir, "creds.json"),
    JSON.stringify(creds, BufferJSON.replacer, 2)
  )
}

function readLocalCreds(sessDir) {
  const file = path.join(sessDir, "creds.json")

  if (!fs.existsSync(file)) {
    return null
  }

  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8"),
      BufferJSON.reviver
    )
  } catch {
    return null
  }
}

function fileNameForKey(type, id) {
  return `${type}-${id}.json`
}

function writeLocalKey(sessDir, type, id, value) {
  ensureDir(sessDir)

  const file = path.join(
    sessDir,
    fileNameForKey(type, id)
  )

  if (value === null || value === undefined) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }

    return
  }

  fs.writeFileSync(
    file,
    JSON.stringify(value, BufferJSON.replacer, 2)
  )
}

function readLocalKey(sessDir, type, id) {
  const file = path.join(
    sessDir,
    fileNameForKey(type, id)
  )

  if (!fs.existsSync(file)) {
    return null
  }

  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8"),
      BufferJSON.reviver
    )
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// SQLITE SERIALIZATION
// ─────────────────────────────────────────────────────────────

function encode(value) {
  return JSON.stringify(value, BufferJSON.replacer)
}

function decode(value) {
  if (value === null || value === undefined) {
    return null
  }

  try {
    return JSON.parse(value, BufferJSON.reviver)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// SQLITE HELPERS
// ─────────────────────────────────────────────────────────────

const getAuthStmt = db.prepare(`
  SELECT creds, keys
  FROM wa_auth
  WHERE phone = ?
`)

const getAuthCredsStmt = db.prepare(`
  SELECT creds
  FROM wa_auth
  WHERE phone = ?
`)

const getAuthKeysStmt = db.prepare(`
  SELECT key_type, key_id, value
  FROM wa_auth_keys
  WHERE phone = ?
`)

const getAuthKeysByTypeStmt = db.prepare(`
  SELECT key_id, value
  FROM wa_auth_keys
  WHERE phone = ? AND key_type = ?
`)

const upsertAuthKeyStmt = db.prepare(`
  INSERT INTO wa_auth_keys (phone, key_type, key_id, value, updated_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(phone, key_type, key_id) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP
`)

const deleteAuthKeyStmt = db.prepare(`
  DELETE FROM wa_auth_keys
  WHERE phone = ? AND key_type = ? AND key_id = ?
`)

const deleteAuthKeysForPhoneStmt = db.prepare(`
  DELETE FROM wa_auth_keys
  WHERE phone = ?
`)

const saveAuthStmt = db.prepare(`
  INSERT INTO wa_auth (phone, creds, keys, updated_at)
  VALUES (?, ?, '{}', CURRENT_TIMESTAMP)
  ON CONFLICT(phone) DO UPDATE SET
    creds = excluded.creds,
    updated_at = CURRENT_TIMESTAMP
`)

const deleteAuthStmt = db.prepare(`
  DELETE FROM wa_auth
  WHERE phone = ?
`)

const listPhonesStmt = db.prepare(`
  SELECT phone
  FROM wa_auth
  ORDER BY phone
`)

const persistAuthKeysTx = db.transaction((phone, changes) => {
  for (const [type, values] of Object.entries(changes || {})) {
    if (!values || typeof values !== "object") continue
    for (const [id, value] of Object.entries(values)) {
      if (value === null || value === undefined) {
        deleteAuthKeyStmt.run(phone, type, id)
      } else {
        upsertAuthKeyStmt.run(phone, type, id, encode(value))
      }
    }
  }
})

function saveAuthKeys(phone, changes) {
  persistAuthKeysTx(phone, changes)
}

const legacyAuthKeysStmt = db.prepare(`
  SELECT phone, keys
  FROM wa_auth
  WHERE keys IS NOT NULL AND keys <> '{}'
`)
const clearLegacyAuthKeysStmt = db.prepare(`
  UPDATE wa_auth SET keys = '{}', updated_at = CURRENT_TIMESTAMP
  WHERE phone = ?
`)
const migrateLegacyAuthKeysTx = db.transaction(() => {
  for (const row of legacyAuthKeysStmt.all()) {
    const legacyKeys = decode(row.keys)
    if (!legacyKeys || typeof legacyKeys !== "object" || Array.isArray(legacyKeys)) continue

    for (const [type, values] of Object.entries(legacyKeys)) {
      if (!values || typeof values !== "object") continue
      for (const [id, value] of Object.entries(values)) {
        upsertAuthKeyStmt.run(row.phone, type, id, encode(value))
      }
    }

    // Clear the legacy blob only after every contained key has been copied.
    clearLegacyAuthKeysStmt.run(row.phone)
  }
})
migrateLegacyAuthKeysTx()

function readAuth(phone) {
  const row = getAuthStmt.get(phone)

  if (!row) {
    return { creds: null, keys: {} }
  }

  const keys = {}
  const keyRows = getAuthKeysStmt.all(phone)
  for (const keyRow of keyRows) {
    if (!keys[keyRow.key_type]) keys[keyRow.key_type] = {}
    keys[keyRow.key_type][keyRow.key_id] = decode(keyRow.value)
  }

  return {
    creds: decode(row.creds),
    keys: keyRows.length ? keys : (decode(row.keys) || {})
  }
}

function readAuthCreds(phone) {
  const row = getAuthCredsStmt.get(phone)
  return row ? decode(row.creds) : null
}

function readAuthKeysByType(phone, type) {
  const rows = getAuthKeysByTypeStmt.all(phone, type)
  const map = {}
  for (const row of rows) map[row.key_id] = decode(row.value)
  if (rows.length) return map

  // Compatibility fallback if a legacy row could not be migrated.
  const legacy = getAuthStmt.get(phone)
  const legacyKeys = legacy ? decode(legacy.keys) : null
  return legacyKeys?.[type] && typeof legacyKeys[type] === "object" ? legacyKeys[type] : {}
}

function writeAuth(phone, creds) {
  saveAuthStmt.run(phone, encode(creds || {}))
}

function deleteStoredAuth(phone) {
  deleteAuthKeysForPhoneStmt.run(phone)
  deleteAuthStmt.run(phone)
}

// ─────────────────────────────────────────────────────────────
// MAIN API
// ─────────────────────────────────────────────────────────────

async function useAuthState(phone, sessDir) {
  ensureDir(sessDir)

  let creds = readAuthCreds(phone)

  /*
   * Migration/fallback:
   *
   * If SQLite has no credentials yet, check the existing local
   * session directory before creating a brand-new auth state.
   */
  if (!creds) {
    creds = readLocalCreds(sessDir)
  }

  if (!creds) {
    creds = initAuthCreds()
  }

  writeLocalCreds(sessDir, creds)
  writeAuth(phone, creds)

  /*
   * Each phone keeps its own in-memory key cache.
   *
   * SQLite stores:
   *
   * {
   *   "session": {
   *      "id": value
   *   },
   *   "pre-key": {
   *      "id": value
   *   }
   * }
   */
  const typeCache = new Map()

  async function loadType(type) {
    if (typeCache.has(type)) {
      return typeCache.get(type)
    }

    // Load only the requested key type; repeated calls use the in-memory map.
    let map = readAuthKeysByType(phone, type)

    if (!map || typeof map !== "object") {
      map = {}
    }

    typeCache.set(type, map)

    return map
  }

  return {
    state: {
      creds,

      keys: {
        get: async (type, ids) => {
          const map = await loadType(type)

          const result = {}

          for (const id of ids) {
            let value = map[id]

            /*
             * Compatibility fallback for any old local session
             * files that have not yet been written into SQLite.
             */
            if (value === undefined) {
              value = readLocalKey(
                sessDir,
                type,
                id
              )
            }

            if (value !== undefined && value !== null) {
              if (type === "app-state-sync-key") {
                value =
                  proto.Message.AppStateSyncKeyData.fromObject(
                    value
                  )
              }

              result[id] = value
            }
          }

          return result
        },

        set: async (data) => {
          for (const type of Object.keys(data)) {
            const map = await loadType(type)

            for (const id of Object.keys(data[type])) {
              const value = data[type][id]

              if (
                value !== null &&
                value !== undefined
              ) {
                map[id] = value

                writeLocalKey(
                  sessDir,
                  type,
                  id,
                  value
                )
              } else {
                delete map[id]

                writeLocalKey(
                  sessDir,
                  type,
                  id,
                  null
                )
              }
            }

            typeCache.set(type, map)
          }

          // Persist just changed keys; never stringify the session's full key map.
          saveAuthKeys(phone, data)
        }
      }
    },

    saveCreds: async () => {
      writeLocalCreds(
        sessDir,
        creds
      )

      writeAuth(phone, creds)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// RESTORE ALL DURABLE SESSIONS
// ─────────────────────────────────────────────────────────────

async function restoreAllSessions(sessRoot) {
  ensureDir(sessRoot)

  const rows = listPhonesStmt.all()

  if (!rows.length) {
    console.log("[AUTH] ℹ No VPS SQLite sessions found")

    return 0
  }

  let restored = 0

  for (const row of rows) {
    const phone = row.phone

    try {
      const auth = readAuth(phone)

      if (!auth.creds) {
        continue
      }

      const sessDir = path.join(
        sessRoot,
        phone
      )

      ensureDir(sessDir)

      writeLocalCreds(
        sessDir,
        auth.creds
      )

      for (const type of Object.keys(auth.keys || {})) {
        const map = auth.keys[type]

        if (!map) {
          continue
        }

        for (const id of Object.keys(map)) {
          writeLocalKey(
            sessDir,
            type,
            id,
            map[id]
          )
        }
      }

      restored++

      console.log(
        `[AUTH] ✔ Restored VPS session: ${phone}`
      )

    } catch (e) {
      console.error(
        `[AUTH] ✗ Restore failed for ${phone}:`,
        e.message
      )
    }
  }

  console.log(
    `[AUTH] ✔ VPS SQLite restore complete: ${restored} session(s)`
  )

  return restored
}

// ─────────────────────────────────────────────────────────────
// DELETE AUTH
// ─────────────────────────────────────────────────────────────

async function deleteAuth(phone, sessDir) {
  /*
   * SQLite is the durable source of truth.
   * Delete the persisted WhatsApp auth record directly.
   */
  deleteStoredAuth(phone)

  /*
   * Delete local mirror only when explicitly requested.
   */
  if (sessDir && fs.existsSync(sessDir)) {
    fs.rmSync(
      sessDir,
      {
        recursive: true,
        force: true
      }
    )
  }

  console.log(
    `[AUTH] ✔ Deleted VPS auth for ${phone}`
  )

  return true
}

// ─────────────────────────────────────────────────────────────
// COMPATIBILITY FUNCTION
// ─────────────────────────────────────────────────────────────

/*
 * Existing code may still call this old Redis migration function.
 *
 * Redis no longer exists in the storage path, so this function now
 * imports the local session into SQLite instead.
 */
async function pushLocalSessionToRedis(phone, sessDir) {
  if (!sessDir || !fs.existsSync(sessDir)) {
    return false
  }

  try {
    const creds = readLocalCreds(sessDir)

    if (!creds) {
      return false
    }

    const keys = {}

    const files = fs.readdirSync(sessDir)

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue
      }

      if (file === "creds.json") {
        continue
      }

      const base = file.replace(/\.json$/, "")

      const knownTypes = [
        "app-state-sync-key",
        "app-state-sync-version",
        "sender-key-memory",
        "sender-key",
        "pre-key",
        "session"
      ]

      let found = null

      for (const type of knownTypes) {
        if (base.startsWith(type + "-")) {
          found = {
            type,
            id: base.slice(type.length + 1)
          }

          break
        }
      }

      if (!found) {
        continue
      }

      const value = readLocalKey(
        sessDir,
        found.type,
        found.id
      )

      if (value === null) {
        continue
      }

      if (!keys[found.type]) {
        keys[found.type] = {}
      }

      keys[found.type][found.id] = value
    }

    writeAuth(phone, creds)
    saveAuthKeys(phone, keys)

    console.log(
      `[AUTH] ✔ Imported local session into VPS SQLite: ${phone}`
    )

    return true

  } catch (e) {
    console.error(
      `[AUTH] ✗ Local session import failed for ${phone}:`,
      e.message
    )

    return false
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  enabled,
  useAuthState,
  restoreAllSessions,
  deleteAuth,
  pushLocalSessionToRedis
}
