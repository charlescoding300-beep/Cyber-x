'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionBackup.js  —  CYBER X  |  Upstash Redis Session Backup
//
// Replaces the GitHub Contents API approach with Upstash Redis — faster,
// no file size limits, no rate limiting issues, no base64 newline bugs.
//
// Each user gets their OWN isolated Redis key:
//   session:<phone>   →  JSON blob of their Baileys session files
//   session:_meta     →  list of all known phones (for boot restore)
//
// One user's corrupted/missing key NEVER affects anyone else's restore.
//
// REQUIRED ENV VARS (set on Render):
//   UPSTASH_REDIS_REST_URL    - from Upstash dashboard
//   UPSTASH_REDIS_REST_TOKEN  - from Upstash dashboard
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')

const SESS_ROOT = path.join(__dirname, '..', 'sessions')

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

const enabled = !!(UPSTASH_URL && UPSTASH_TOKEN)

if (!enabled) {
  console.warn('[BACKUP] ⚠ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — sessions will NOT survive restarts')
}

// ─────────────────────────────────────────────────────────────────────────────
// Upstash REST API helper — dead simple GET/SET via HTTPS, no npm package
// ─────────────────────────────────────────────────────────────────────────────

function upstashRequest(command, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify([command, ...args])
    const url  = new URL(UPSTASH_URL)

    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname || '/',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let chunks = ''
      res.on('data', c => { chunks += c })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks)
          resolve(parsed)
        } catch (e) {
          reject(new Error('Upstash response parse failed: ' + chunks.slice(0, 100)))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function redisSet(key, value) {
  const res = await upstashRequest('SET', [key, value])
  if (res.error) throw new Error('Redis SET error: ' + res.error)
  return res.result
}

async function redisGet(key) {
  const res = await upstashRequest('GET', [key])
  if (res.error) throw new Error('Redis GET error: ' + res.error)
  return res.result   // null if key doesn't exist
}

async function redisDel(key) {
  const res = await upstashRequest('DEL', [key])
  if (res.error) throw new Error('Redis DEL error: ' + res.error)
  return res.result
}

async function redisKeys(pattern) {
  const res = await upstashRequest('KEYS', [pattern])
  if (res.error) throw new Error('Redis KEYS error: ' + res.error)
  return res.result || []
}

// ─────────────────────────────────────────────────────────────────────────────
// PACK / UNPACK — one user's session folder ⇄ one JSON string
// ─────────────────────────────────────────────────────────────────────────────

function packUser(phone) {
  const dir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(dir)) return null

  const out = {}
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file)
    if (!fs.statSync(filePath).isFile()) continue
    out[file] = fs.readFileSync(filePath).toString('base64')
  }
  return Object.keys(out).length ? JSON.stringify(out) : null
}

function unpackUser(phone, jsonStr) {
  if (!jsonStr) return false
  let data
  try { data = JSON.parse(jsonStr) } catch (e) {
    console.error(`[BACKUP:${phone}] ✗ JSON parse failed:`, e.message)
    return false
  }

  const dir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  for (const file of Object.keys(data)) {
    try {
      fs.writeFileSync(path.join(dir, file), Buffer.from(data[file], 'base64'))
    } catch (e) {
      console.error(`[BACKUP:${phone}] ✗ failed writing ${file}:`, e.message)
    }
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — save ONE user's session to their own Redis key
// ─────────────────────────────────────────────────────────────────────────────

const pushTimers  = new Map()
const pushFlight  = new Map()
const pushQueued  = new Map()

async function pushUserNow(phone) {
  if (!enabled) return
  if (pushFlight.get(phone)) { pushQueued.set(phone, true); return }
  pushFlight.set(phone, true)

  try {
    const packed = packUser(phone)
    if (!packed) { pushFlight.set(phone, false); return }

    await redisSet(`session:${phone}`, packed)
    console.log(`[BACKUP:${phone}] ✔ Pushed to Upstash Redis`)
  } catch (e) {
    console.error(`[BACKUP:${phone}] ✗ Push error:`, e.message)
  } finally {
    pushFlight.set(phone, false)
    if (pushQueued.get(phone)) {
      pushQueued.set(phone, false)
      pushUserNow(phone)
    }
  }
}

function schedulePush(phone) {
  if (!enabled || !phone) return
  clearTimeout(pushTimers.get(phone))
  pushTimers.set(phone, setTimeout(() => pushUserNow(phone), 4000))
}

async function pushImmediate(phone) {
  if (!enabled || !phone) return
  clearTimeout(pushTimers.get(phone))
  await pushUserNow(phone)
}

async function pushAll() {
  if (!enabled || !fs.existsSync(SESS_ROOT)) return 0
  const phones = fs.readdirSync(SESS_ROOT).filter(f => {
    const full = path.join(SESS_ROOT, f)
    return !f.startsWith('_') && fs.statSync(full).isDirectory()
  })
  let count = 0
  for (const phone of phones) {
    try { await pushUserNow(phone); count++ } catch {}
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE — pull EVERY user independently — one failure never blocks others
// ─────────────────────────────────────────────────────────────────────────────

async function restoreAll() {
  if (!enabled) {
    console.warn('[BACKUP] Skipping restore — Upstash not configured')
    return 0
  }

  let keys = []
  try {
    keys = await redisKeys('session:*')
  } catch (e) {
    console.error('[BACKUP] ✗ Could not list Redis keys:', e.message)
    return 0
  }

  // Filter out meta key, keep only phone keys
  const phoneKeys = keys.filter(k => k !== 'session:_meta')

  if (phoneKeys.length === 0) {
    console.log('[BACKUP] No sessions found in Redis — starting fresh')
    return 0
  }

  console.log(`[BACKUP] Found ${phoneKeys.length} session(s) — restoring each independently...`)

  let restored = 0

  for (const key of phoneKeys) {
    const phone = key.replace('session:', '')
    try {
      const jsonStr = await redisGet(key)
      if (!jsonStr) {
        console.warn(`[BACKUP:${phone}] ⚠ key exists but value is empty, skipping`)
        continue
      }
      const ok = unpackUser(phone, jsonStr)
      if (ok) {
        restored++
        console.log(`[BACKUP:${phone}] ✔ Restored`)
      }
    } catch (e) {
      // One user's error NEVER stops the loop for other users
      console.error(`[BACKUP:${phone}] ✗ Restore error (skipping):`, e.message)
    }
  }

  console.log(`[BACKUP] ✔ Restored ${restored}/${phoneKeys.length} session(s)`)
  return restored
}

// ─────────────────────────────────────────────────────────────────────────────
// ✨ NEW — deleteSession
// Permanently wipes a session from Redis so it never comes back after removal.
// Called by cleanupDeadSessions() in index.js when a session fails to recover.
// ─────────────────────────────────────────────────────────────────────────────
async function deleteSession(phone) {
  if (!enabled) return
  try {
    const clean = phone.replace(/\D/g, '')
    const key   = `session:${clean}`
    await redisDel(key)
    console.log(`[BACKUP] 🗑 Deleted from Redis: ${key}`)
  } catch (e) {
    console.error(`[BACKUP] ✗ deleteSession failed for ${phone}:`, e.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ✨ NEW — pushNow (alias used by gracefulShutdown in server.js)
// ─────────────────────────────────────────────────────────────────────────────
async function pushNow() {
  return pushAll()
}

module.exports = {
  enabled,
  schedulePush,
  pushImmediate,
  pushAll,
  pushNow,
  restoreAll,
  deleteSession,
}
