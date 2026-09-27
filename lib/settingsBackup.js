"use strict"

// ─────────────────────────────────────────────────────────────────────────────
// lib/settingsBackup.js — Improved Settings + Session Keep-Alive
// 
// Features:
//  - Dual storage: Local VPS + Upstash Redis
//  - Keep-alive ping every 4 minutes
//  - Only restore sessions that responded to recent pings
//  - Safe & backward compatible
// ─────────────────────────────────────────────────────────────────────────────

const https = require("https")
const fs    = require("fs")
const path  = require("path")

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const KEY_PREFIX  = "settings:"
const PING_PREFIX = "ping:"
const PING_INTERVAL = 4 * 60 * 1000 // 4 minutes

function redisCommand(commandArray) {
  return new Promise((resolve) => {
    if (!REDIS_URL || !REDIS_TOKEN) {
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

async function pushSettings(phone, dataObj) {
  const r = await redisCommand(["SET", KEY_PREFIX + phone, JSON.stringify(dataObj)])
  if (!r.ok) console.error(`[SETTINGS-BACKUP] ✗ push failed for ${phone}:`, r.error)
  return r.ok
}

async function pullSettings(phone) {
  const r = await redisCommand(["GET", KEY_PREFIX + phone])
  if (!r.ok || !r.result) return null
  try { return JSON.parse(r.result) } catch { return null }
}

async function deleteSettings(phone) {
  const r = await redisCommand(["DEL", KEY_PREFIX + phone])
  if (r.ok) console.log(`[SETTINGS-BACKUP] 🗑 Deleted settings:${phone} from Redis`)
  else console.error(`[SETTINGS-BACKUP] ✗ delete failed for ${phone}:`, r.error)
  return r.ok
}

// ──────────────────────────────────────────────
// Keep-Alive Ping System
// ──────────────────────────────────────────────

async function markSessionAlive(phone) {
  const timestamp = Date.now()
  await redisCommand(["SET", PING_PREFIX + phone, String(timestamp), "EX", 600]) // expire after 10 min
  return true
}

async function isSessionAlive(phone) {
  const r = await redisCommand(["GET", PING_PREFIX + phone])
  if (!r.ok || !r.result) return false
  const lastPing = parseInt(r.result)
  if (isNaN(lastPing)) return false
  // Consider alive if last ping was within last 8 minutes
  return (Date.now() - lastPing) < (8 * 60 * 1000)
}

async function restoreAllSettings(usersDir) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log("[SETTINGS-BACKUP] ⚠ Redis not configured — skipping restore")
    return 0
  }

  const listResult = await redisCommand(["KEYS", `${KEY_PREFIX}*`])
  if (!listResult.ok || !Array.isArray(listResult.result)) {
    console.log("[SETTINGS-BACKUP] ℹ No settings keys found in Redis")
    return 0
  }

  if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true })

  let restored = 0
  let skipped = 0

  for (const key of listResult.result) {
    const phone = key.slice(KEY_PREFIX.length)

    // Only restore if the session was recently alive
    const alive = await isSessionAlive(phone)
    if (!alive) {
      skipped++
      continue
    }

    const data = await pullSettings(phone)
    if (data) {
      try {
        fs.writeFileSync(path.join(usersDir, `${phone}.json`), JSON.stringify(data, null, 2), "utf8")
        restored++
      } catch (e) {
        console.error(`[SETTINGS-BACKUP] ✗ restore write failed for ${phone}:`, e.message)
      }
    }
  }

  console.log(`[SETTINGS-BACKUP] ✅ Restored ${restored} active session(s) | Skipped ${skipped} inactive`)
  return restored
}

// ──────────────────────────────────────────────
// Watcher (keeps local ↔ Redis in sync)
// ──────────────────────────────────────────────

function watchAndSync(usersDir) {
  if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true })

  const debounceTimers = new Map()

  fs.watch(usersDir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".json")) return
    const phone = filename.replace(/\.json$/, "")

    clearTimeout(debounceTimers.get(phone))
    const t = setTimeout(async () => {
      debounceTimers.delete(phone)
      const filePath = path.join(usersDir, filename)
      try {
        if (!fs.existsSync(filePath)) return
        const raw  = fs.readFileSync(filePath, "utf8")
        const data = JSON.parse(raw)
        const ok   = await pushSettings(phone, data)
        if (ok) console.log(`[SETTINGS-BACKUP] 🔄 ${phone}.json changed — synced to Redis`)
      } catch (e) {
        console.error(`[SETTINGS-BACKUP] ✗ Watcher sync failed for ${phone}:`, e.message)
      }
    }, 500)
    debounceTimers.set(phone, t)
  })

  console.log(`[SETTINGS-BACKUP] 👁 Watching ${usersDir} — any settings change will sync to Redis`)
}

// ──────────────────────────────────────────────
// Keep-Alive Interval (runs every 4 minutes)
// ──────────────────────────────────────────────

function startKeepAlive(getActivePhones) {
  // getActivePhones should be a function that returns array of currently connected phone numbers
  setInterval(async () => {
    try {
      const phones = typeof getActivePhones === "function" ? await getActivePhones() : []
      if (!Array.isArray(phones) || phones.length === 0) return

      for (const phone of phones) {
        await markSessionAlive(phone)
      }
      console.log(`[KEEP-ALIVE] 💓 Pinged ${phones.length} active session(s)`)
    } catch (e) {
      console.error("[KEEP-ALIVE] Error:", e.message)
    }
  }, PING_INTERVAL)

  console.log("[KEEP-ALIVE] ✅ Session keep-alive started (every 4 minutes)")
}

module.exports = {
  pushSettings,
  pullSettings,
  deleteSettings,
  restoreAllSettings,
  watchAndSync,
  markSessionAlive,
  isSessionAlive,
  startKeepAlive
}
