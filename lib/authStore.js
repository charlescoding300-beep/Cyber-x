"use strict"

/*
 * ZEN X — VPS SQLite WhatsApp authentication store
 *
 * Durable source of truth:
 *   /root/zenx-db/zenx.db
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
 * ../../zenx-db/database.js
 * resolves to:
 * /root/zenx-db/database.js
 */
const db = require(path.join(__dirname, "../../zenx-db/database"))

console.log("[AUTH] ✔ VPS SQLite durable auth enabled")
console.log("[AUTH] Database:", path.join(__dirname, "../../zenx-db/zenx.db"))

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

const saveAuthStmt = db.prepare(`
  INSERT INTO wa_auth (
    phone,
    creds,
    keys,
    updated_at
  )
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(phone) DO UPDATE SET
    creds = excluded.creds,
    keys = excluded.keys,
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

function readAuth(phone) {
  const row = getAuthStmt.get(phone)

  if (!row) {
    return {
      creds: null,
      keys: {}
    }
  }

  return {
    creds: decode(row.creds),
    keys: decode(row.keys) || {}
  }
}

function writeAuth(phone, creds, keys) {
  saveAuthStmt.run(
    phone,
    encode(creds || {}),
    encode(keys || {})
  )
}

function deleteStoredAuth(phone) {
  deleteAuthStmt.run(phone)
}

// ─────────────────────────────────────────────────────────────
// MAIN API
// ─────────────────────────────────────────────────────────────

async function useAuthState(phone, sessDir) {
  ensureDir(sessDir)

  const stored = readAuth(phone)

  let creds = stored.creds

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

    const current = readAuth(phone)

    let map = current.keys[type]

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

          /*
           * Save the complete current key cache back to SQLite.
           */
          const current = readAuth(phone)

          const mergedKeys = {
            ...(current.keys || {})
          }

          for (const [type, map] of typeCache.entries()) {
            mergedKeys[type] = map
          }

          writeAuth(
            phone,
            creds,
            mergedKeys
          )
        }
      }
    },

    saveCreds: async () => {
      writeLocalCreds(
        sessDir,
        creds
      )

      const current = readAuth(phone)

      const mergedKeys = {
        ...(current.keys || {})
      }

      for (const [type, map] of typeCache.entries()) {
        mergedKeys[type] = map
      }

      writeAuth(
        phone,
        creds,
        mergedKeys
      )
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

    writeAuth(
      phone,
      creds,
      keys
    )

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
