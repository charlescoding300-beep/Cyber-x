"use strict"

// ─────────────────────────────────────────────────────────────────────────────
// lib/authStore.js — DURABLE WhatsApp auth state (creds + all Signal keys)
//
// Drop-in replacement for Baileys' useMultiFileAuthState(), backed by
// Upstash Redis as the durable source of truth, with a local disk mirror
// in the exact same file layout useMultiFileAuthState() itself uses (so
// if Redis is briefly unreachable, the session still loads from disk).
//
// Storage layout in Redis, one phone's data fully isolated from every
// other phone's:
//   wa:auth:<phone>:creds            → the AuthenticationCreds blob
//   wa:auth:<phone>:keys:<type>      → {id: value} map for that key type
//   wa:auth:<phone>:keys:__types     → a set of which <type> keys exist,
//                                      so restore/delete know what to walk
//
// Deletion is deliberately NOT wired to every disconnect — only
// deleteAuth() removes anything, and the only caller of that should be
// removeSession(), which itself only fires on a confirmed real logout or
// an explicit owner removal. A network blip, a PM2 restart, a crash — none
// of those should ever touch this data. That mirrors the exact same
// principle already built into lib/settingsBackup.js today.
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require("fs")
const path  = require("path")
const https = require("https")
const { proto, initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys")

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const enabled     = !!(REDIS_URL && REDIS_TOKEN)

if (enabled) {
  console.log("[AUTH] ✔ Upstash Redis REST configured (durable auth)")
} else {
  console.warn("[AUTH] ⚠ Upstash Redis REST not configured — durable auth disabled, using local disk only")
}

// ── Low-level Redis REST helper — same confirmed-correct request shape as
//    lib/settingsBackup.js: POST the raw command array to the REST root
//    URL, not /pipeline. ──────────────────────────────────────────────────
function redisCommand(commandArray) {
  return new Promise((resolve) => {
    if (!enabled) {
      resolve({ ok: false, error: "Redis not configured" })
      return
    }
    let url
    try { url = new URL(REDIS_URL) } catch (e) {
      resolve({ ok: false, error: `Bad UPSTASH_REDIS_REST_URL: ${e.message}` })
      return
    }
    const body = JSON.stringify(commandArray)
    const options = {
      hostname: url.hostname,
      path:     url.pathname || "/",
      method:   "POST",
      headers: {
        "Authorization": `Bearer ${REDIS_TOKEN}`,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }
    const req = https.request(options, (res) => {
      let data = ""
      res.on("data", chunk => { data += chunk })
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ ok: true, result: JSON.parse(data).result }) }
          catch { resolve({ ok: true, result: data }) }
        } else {
          resolve({ ok: false, error: `HTTP ${res.statusCode}: ${data}` })
        }
      })
    })
    req.on("error", (e) => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

function credsKey(phone)          { return `wa:auth:${phone}:creds` }
function keysTypeKey(phone, type) { return `wa:auth:${phone}:keys:${type}` }
function keysIndexKey(phone)      { return `wa:auth:${phone}:keys:__types` }

async function redisSetJSON(key, obj) {
  const r = await redisCommand(["SET", key, JSON.stringify(obj, BufferJSON.replacer)])
  if (!r.ok) console.error(`[AUTH] ✗ Redis SET failed for ${key}:`, r.error)
  return r.ok
}
async function redisGetJSON(key) {
  const r = await redisCommand(["GET", key])
  if (!r.ok || !r.result) return null
  try { return JSON.parse(r.result, BufferJSON.reviver) } catch { return null }
}
async function redisDel(key) {
  return redisCommand(["DEL", key])
}
async function redisSAdd(key, member) {
  return redisCommand(["SADD", key, member])
}
async function redisSMembers(key) {
  const r = await redisCommand(["SMEMBERS", key])
  return (r.ok && Array.isArray(r.result)) ? r.result : []
}

// ── Local disk mirror — same file layout useMultiFileAuthState() uses,
//    so a Redis outage never breaks an in-progress session, and so the
//    plain Baileys loader could still read this folder in an emergency. ──
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) }

function writeLocalCreds(sessDir, creds) {
  ensureDir(sessDir)
  fs.writeFileSync(path.join(sessDir, "creds.json"), JSON.stringify(creds, BufferJSON.replacer, 2))
}
function readLocalCreds(sessDir) {
  const file = path.join(sessDir, "creds.json")
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, "utf8"), BufferJSON.reviver) } catch { return null }
}
function fileNameForKey(type, id) { return `${type}-${id}.json` }
function writeLocalKey(sessDir, type, id, value) {
  ensureDir(sessDir)
  const file = path.join(sessDir, fileNameForKey(type, id))
  if (value === null || value === undefined) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return
  }
  fs.writeFileSync(file, JSON.stringify(value, BufferJSON.replacer, 2))
}
function readLocalKey(sessDir, type, id) {
  const file = path.join(sessDir, fileNameForKey(type, id))
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, "utf8"), BufferJSON.reviver) } catch { return null }
}

// Known Baileys key types, longest/most-specific first — needed to safely
// reverse-parse "<type>-<id>.json" filenames during migration, since some
// type names themselves contain hyphens (a naive split on "-" would cut
// the type/id boundary in the wrong place).
const KNOWN_KEY_TYPES = [
  "app-state-sync-key",
  "app-state-sync-version",
  "sender-key-memory",
  "sender-key",
  "pre-key",
  "session",
]
function parseKeyFileName(filename) {
  const base = filename.replace(/\.json$/, "")
  for (const type of KNOWN_KEY_TYPES) {
    if (base.startsWith(type + "-")) {
      return { type, id: base.slice(type.length + 1) }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN API
// ─────────────────────────────────────────────────────────────────────────────

// Drop-in replacement for useMultiFileAuthState(sessDir) — same
// { state: { creds, keys }, saveCreds } shape Baileys expects.
async function useAuthState(phone, sessDir) {
  ensureDir(sessDir)

  // Redis is the source of truth when available; local disk is the
  // fallback (covers a Redis outage, or a session that predates this
  // auth store and hasn't been migrated yet).
  let creds = enabled ? await redisGetJSON(credsKey(phone)) : null
  if (!creds) creds = readLocalCreds(sessDir)
  if (!creds) creds = initAuthCreds()
  writeLocalCreds(sessDir, creds)

  // Per-type key cache, loaded lazily and kept in sync with both Redis
  // and the local mirror on every write.
  const typeCache = new Map()
  async function loadType(type) {
    if (typeCache.has(type)) return typeCache.get(type)
    let map = enabled ? await redisGetJSON(keysTypeKey(phone, type)) : null
    if (!map) map = {}
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
            if (value === undefined) {
              // Not in the type-map yet — fall back to a per-file local
              // read (covers a not-yet-migrated pre-existing session).
              value = readLocalKey(sessDir, type, id)
            }
            if (value) {
              if (type === "app-state-sync-key") {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
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
              if (value) {
                map[id] = value
                writeLocalKey(sessDir, type, id, value)
              } else {
                delete map[id]
                writeLocalKey(sessDir, type, id, null)
              }
            }
            typeCache.set(type, map)
            if (enabled) {
              await redisSetJSON(keysTypeKey(phone, type), map)
              await redisSAdd(keysIndexKey(phone), type)
            }
          }
        },
      },
    },
    saveCreds: async () => {
      writeLocalCreds(sessDir, creds)
      if (enabled) await redisSetJSON(credsKey(phone), creds)
    },
  }
}

// Called once at boot, before any session starts. Rebuilds every phone's
// local session folder from Redis so startBot()'s existing disk-based
// discovery finds valid creds immediately — no new pairing code needed
// for anyone WhatsApp hasn't actually logged out.
async function restoreAllSessions(sessRoot) {
  if (!enabled) {
    console.log("[AUTH] ⚠ Redis not configured — skipping durable-auth restore")
    return 0
  }
  const keysResult = await redisCommand(["KEYS", "wa:auth:*:creds"])
  if (!keysResult.ok || !Array.isArray(keysResult.result)) {
    console.log("[AUTH] ℹ No durable sessions found in Redis")
    return 0
  }

  let restored = 0
  for (const key of keysResult.result) {
    const match = key.match(/^wa:auth:(.+):creds$/)
    if (!match) continue
    const phone = match[1]
    try {
      const creds = await redisGetJSON(key)
      if (!creds) continue

      const sessDir = path.join(sessRoot, phone)
      ensureDir(sessDir)
      writeLocalCreds(sessDir, creds)

      const types = await redisSMembers(keysIndexKey(phone))
      for (const type of types) {
        const map = await redisGetJSON(keysTypeKey(phone, type))
        if (!map) continue
        for (const id of Object.keys(map)) {
          writeLocalKey(sessDir, type, id, map[id])
        }
      }
      restored++
    } catch (e) {
      console.error(`[AUTH] ✗ Restore failed for ${phone}:`, e.message)
    }
  }
  console.log(`[AUTH] ✔ Restored ${restored} session(s) from durable store`)
  return restored
}

// The only function that deletes anything. Call this ONLY from
// removeSession() — a confirmed real WhatsApp logout or an explicit
// owner-initiated removal. Never from an ordinary disconnect/reconnect.
async function deleteAuth(phone, sessDir) {
  if (fs.existsSync(sessDir)) fs.rmSync(sessDir, { recursive: true, force: true })
  if (!enabled) return
  await redisDel(credsKey(phone))
  const types = await redisSMembers(keysIndexKey(phone))
  for (const type of types) await redisDel(keysTypeKey(phone, type))
  await redisDel(keysIndexKey(phone))
  console.log(`[AUTH] 🗑 Deleted durable auth for ${phone}`)
}

// One-time migration helper — pushes an existing local-disk-only session
// (from before this auth store existed) up to Redis proactively, instead
// of waiting for the next natural creds.update/keys.set to do it.
async function pushLocalSessionToRedis(phone, sessDir) {
  if (!enabled) return false
  if (!fs.existsSync(sessDir)) return false

  const creds = readLocalCreds(sessDir)
  if (creds) await redisSetJSON(credsKey(phone), creds)

  const byType = {}
  for (const file of fs.readdirSync(sessDir)) {
    if (file === "creds.json" || !file.endsWith(".json")) continue
    const parsed = parseKeyFileName(file)
    if (!parsed) continue
    try {
      const value = JSON.parse(fs.readFileSync(path.join(sessDir, file), "utf8"), BufferJSON.reviver)
      byType[parsed.type] = byType[parsed.type] || {}
      byType[parsed.type][parsed.id] = value
    } catch (e) {
      console.error(`[AUTH] ✗ Migration read failed for ${file}:`, e.message)
    }
  }

  for (const type of Object.keys(byType)) {
    await redisSetJSON(keysTypeKey(phone, type), byType[type])
    await redisSAdd(keysIndexKey(phone), type)
  }

  console.log(`[AUTH] ⬆ Migrated local session ${phone} to Redis (${Object.keys(byType).length} key type(s))`)
  return true
}

module.exports = {
  enabled,
  useAuthState,
  restoreAllSessions,
  deleteAuth,
  pushLocalSessionToRedis,
}

