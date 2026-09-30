'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionBackup.js  —  ZEN X  |  Upstash Redis Session Backup (Compressed)
//
// - Compresses session data with zlib before saving (much smaller)
// - Skips empty / tiny sessions
// - Prevents "max request size exceeded" errors
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')
const zlib  = require('zlib')

const SESS_ROOT = path.join(__dirname, '..', 'sessions')

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

const enabled = !!(UPSTASH_URL && UPSTASH_TOKEN)

if (!enabled) {
  console.warn('[BACKUP] ⚠ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — sessions will NOT survive restarts')
}

// ─────────────────────────────────────────────────────────────────────────────
// Upstash REST helper
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
          resolve(JSON.parse(chunks))
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
  return res.result
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
// Compression helpers
// ─────────────────────────────────────────────────────────────────────────────

function compress(str) {
  return zlib.gzipSync(Buffer.from(str, 'utf8')).toString('base64')
}

function decompress(b64) {
  try {
    const buf = Buffer.from(b64, 'base64')
    // Check if it's gzip (starts with 1f 8b)
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      return zlib.gunzipSync(buf).toString('utf8')
    }
    // Old uncompressed data (fallback)
    return b64
  } catch {
    // Fallback for old uncompressed sessions
    return b64
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PACK / UNPACK
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
  try {
    data = JSON.parse(jsonStr)
  } catch (e) {
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
// PUSH
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

    if (!packed) {
      console.warn(`[BACKUP:${phone}] ⚠ Nothing to push (empty session)`)
      return
    }

    const originalSize = Buffer.byteLength(packed)

    if (originalSize < 50) {
      console.warn(`[BACKUP:\( {phone}] ⚠ Session too small ( \){originalSize} bytes), skipping`)
      return
    }

    // Compress
    const compressed = compress(packed)
    const compressedSize = Buffer.byteLength(compressed)

    if (compressedSize > 9_500_000) {
      console.error(`[BACKUP:\( {phone}] ✗ Even compressed session is too large ( \){(compressedSize / 1024 / 1024).toFixed(2)} MB). Skipping.`)
      return
    }

    await redisSet(`session:${phone}`, compressed)

    console.log(`[BACKUP:\( {phone}] ✔ Pushed to Upstash Redis ( \){(originalSize / 1024).toFixed(1)} KB → ${(compressedSize / 1024).toFixed(1)} KB)`)
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
// RESTORE
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
      const raw = await redisGet(key)
      if (!raw) {
        console.warn(`[BACKUP:${phone}] ⚠ key exists but value is empty, skipping`)
        continue
      }

      // Decompress (supports both old uncompressed + new compressed)
      const jsonStr = decompress(raw)

      const ok = unpackUser(phone, jsonStr)
      if (ok) {
        restored++
        console.log(`[BACKUP:${phone}] ✔ Restored`)
      }
    } catch (e) {
      console.error(`[BACKUP:${phone}] ✗ Restore error (skipping):`, e.message)
    }
  }

  console.log(`[BACKUP] ✔ Restored \( {restored}/ \){phoneKeys.length} session(s)`)
  return restored
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete + aliases
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
