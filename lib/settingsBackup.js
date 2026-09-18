"use strict"

// ─────────────────────────────────────────────────────────────────────────────
// lib/settingsBackup.js — PER-SESSION settings backup to Upstash Redis
//
// One dedicated key per phone: "settings:<phone>". This is deliberately
// separate from lib/persist.js's single combined snapshot blob — that
// approach makes it impossible to remove just one session's data without
// touching everyone else's. Here, each session's settings live and die on
// their own key, so a real logout can wipe exactly that session's Redis
// footprint and nothing else's.
//
// Uses the same request shape already confirmed correct elsewhere in this
// codebase (see lib/persist.js's redisSet fix note): POST the raw command
// array to the Upstash REST root URL, not /pipeline.
// ─────────────────────────────────────────────────────────────────────────────

const https = require("https")
const fs    = require("fs")
const path  = require("path")

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const KEY_PREFIX  = "settings:"

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

// The one function that matters for the "don't weigh down Upstash" ask —
// removes exactly this phone's key and nothing else's.
async function deleteSettings(phone) {
  const r = await redisCommand(["DEL", KEY_PREFIX + phone])
  if (r.ok) console.log(`[SETTINGS-BACKUP] 🗑 Deleted settings:${phone} from Redis`)
  else console.error(`[SETTINGS-BACKUP] ✗ delete failed for ${phone}:`, r.error)
  return r.ok
}

// Called once at boot, before sessions start. Pulls every settings:<phone>
// key down to data/users/<phone>.json so each session's settings are ready
// the instant its forUser(phone) reads them — matches "session A, B, C...
// each carrying their own stuff, restored immediately."
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
  for (const key of listResult.result) {
    const phone = key.slice(KEY_PREFIX.length)
    const data  = await pullSettings(phone)
    if (data) {
      try {
        fs.writeFileSync(path.join(usersDir, `${phone}.json`), JSON.stringify(data, null, 2), "utf8")
        restored++
      } catch (e) {
        console.error(`[SETTINGS-BACKUP] ✗ restore write failed for ${phone}:`, e.message)
      }
    }
  }
  console.log(`[SETTINGS-BACKUP] ✅ Restored ${restored} session settings file(s) from Redis`)
  return restored
}

module.exports = { pushSettings, pullSettings, deleteSettings, restoreAllSettings, watchAndSync }

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY NET — watches data/users/*.json directly and pushes any change to
// that phone's Redis key, independent of which code path wrote the file.
// This exists because we already found one command (the old prefix.js)
// silently writing to a completely different, disconnected backend — this
// catches that class of bug for good: it doesn't matter which command
// touched a phone's settings, or whether it correctly called
// forUser(phone).set() or not — if the file on disk changed, it gets backed
// up. The one thing it can't do is catch a command writing to some file
// OUTSIDE data/users/ entirely — a watcher can only watch where it's
// pointed.
// ─────────────────────────────────────────────────────────────────────────────
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
        if (!fs.existsSync(filePath)) return // file was deleted, not written
        const raw  = fs.readFileSync(filePath, "utf8")
        const data = JSON.parse(raw)
        const ok   = await pushSettings(phone, data)
        if (ok) console.log(`[SETTINGS-BACKUP] \ud83d\udd04 ${phone}.json changed — synced to Redis`)
      } catch (e) {
        console.error(`[SETTINGS-BACKUP] \u2717 Watcher sync failed for ${phone}:`, e.message)
      }
    }, 500) // debounce rapid successive writes to the same file into one push
    debounceTimers.set(phone, t)
  })

  console.log(`[SETTINGS-BACKUP] \ud83d\udc41 Watching ${usersDir} — any settings change from any source will sync to Redis`)
}
