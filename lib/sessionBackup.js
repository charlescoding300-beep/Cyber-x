'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionBackup.js  —  CYBER X  |  GitHub Session Backup v3
//
// GitHub repo structure (one folder per user, split by file type):
//
//   Sessions/                          ← your private GitHub repo root
//     sessions/
//       2348120382097/
//         creds.json                   ← CRITICAL: bot can't connect without this
//         app-state-sync-key-XXX.json  ← CRITICAL: needed for WhatsApp state
//       2349012345678/
//         creds.json
//         app-state-sync-key-XXX.json
//     baileys-cache/
//       2348120382097/
//         device-list-XXX.json         ← CACHE: nice to have, bot works without
//         lid-mapping-XXX.json         ← CACHE: nice to have, bot works without
//         identity-key-XXX.json        ← CACHE: nice to have, bot works without
//       2349012345678/
//         device-list-XXX.json
//         ...
//     _meta.json                       ← which phones to reconnect on boot
//
// WHY SPLIT:
//   Critical files are small and must restore cleanly every time.
//   Cache files are hundreds of Baileys internal files — if they fail to
//   restore, the bot still connects (just slower, re-caches live).
//   Keeping them separate means a corrupted cache file can NEVER break the
//   bot's ability to reconnect.
//
// Each user is fully independent — one user's bad data never affects another.
//
// REQUIRED ENV VARS:
//   GITHUB_TOKEN         - Personal Access Token, "repo" scope
//   GITHUB_BACKUP_REPO   - "username/repo-name" (PRIVATE)
//   GITHUB_BACKUP_BRANCH - optional, defaults to "main"
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')

const SESS_ROOT = path.join(__dirname, '..', 'sessions')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPO         = process.env.GITHUB_BACKUP_REPO
const BRANCH       = process.env.GITHUB_BACKUP_BRANCH || 'main'

// GitHub folder paths
const SESS_FOLDER  = 'sessions'       // critical files
const CACHE_FOLDER = 'baileys-cache'  // internal Baileys cache files
const META_PATH    = '_meta.json'     // which phones to restart on boot

const enabled = !!(GITHUB_TOKEN && REPO)

if (!enabled) {
  console.warn('[BACKUP] ⚠ GITHUB_TOKEN / GITHUB_BACKUP_REPO not set — sessions will NOT survive restarts')
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE CLASSIFICATION
// Baileys writes many internal cache files alongside the critical creds.
// We separate them so a bloated cache can never corrupt the critical restore.
// ─────────────────────────────────────────────────────────────────────────────

function isCriticalFile(filename) {
  return (
    filename === 'creds.json' ||
    filename.startsWith('app-state-sync-key-') ||
    filename.startsWith('app-state-sync-version-')
  )
}

function isCacheFile(filename) {
  return (
    filename.startsWith('device-list-') ||
    filename.startsWith('lid-mapping-') ||
    filename.startsWith('identity-key-')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Contents API helpers
// ─────────────────────────────────────────────────────────────────────────────

function ghRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: Object.assign({
        'User-Agent':    'CYBER-X-Backup',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
      }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    }, (res) => {
      let chunks = ''
      res.on('data', (c) => { chunks += c })
      res.on('end', () => {
        let parsed = {}
        try { parsed = JSON.parse(chunks) } catch {}
        resolve({ status: res.statusCode, data: parsed })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// GitHub returns base64 with embedded newlines — must strip before decoding
function decodeGithubContent(rawBase64) {
  const clean = (rawBase64 || '').replace(/\s/g, '')
  return Buffer.from(clean, 'base64').toString('utf8')
}

// Push a single JSON object to one GitHub file, creating or updating it
async function pushFile(githubPath, payload, commitMessage) {
  const content = Buffer.from(JSON.stringify(payload)).toString('base64')
  const existing = await ghRequest('GET', `/repos/${REPO}/contents/${githubPath}?ref=${BRANCH}`)
  const sha = existing.status === 200 ? existing.data.sha : undefined

  const body = { message: commitMessage, content, branch: BRANCH }
  if (sha) body.sha = sha

  const res = await ghRequest('PUT', `/repos/${REPO}/contents/${githubPath}`, body)
  return res.status === 200 || res.status === 201
}

// ─────────────────────────────────────────────────────────────────────────────
// PACK — read a user's local session folder, split into critical + cache
// ─────────────────────────────────────────────────────────────────────────────

function packUser(phone) {
  const dir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(dir)) return { critical: null, cache: null }

  const critical = {}
  const cache    = {}

  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file)
    if (!fs.statSync(filePath).isFile()) continue
    const b64 = fs.readFileSync(filePath).toString('base64')
    if (isCriticalFile(file))    critical[file] = b64
    else if (isCacheFile(file))  cache[file]    = b64
    // anything else (e.g. unknown future files) goes into critical to be safe
    else                         critical[file] = b64
  }

  return {
    critical: Object.keys(critical).length ? critical : null,
    cache:    Object.keys(cache).length    ? cache    : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UNPACK — write files back to local disk for one user
// ─────────────────────────────────────────────────────────────────────────────

function unpackFiles(phone, data) {
  if (!data || typeof data !== 'object') return 0
  const dir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  let count = 0
  for (const [file, b64] of Object.entries(data)) {
    try {
      fs.writeFileSync(path.join(dir, file), Buffer.from(b64, 'base64'))
      count++
    } catch (e) {
      console.error(`[BACKUP:${phone}] ✗ failed writing ${file}: ${e.message}`)
    }
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — one user, both critical and cache, independently
// ─────────────────────────────────────────────────────────────────────────────

const pushTimers  = new Map()
const pushFlight  = new Map()
const pushQueued  = new Map()

async function pushUserNow(phone) {
  if (!enabled) return
  if (pushFlight.get(phone)) { pushQueued.set(phone, true); return }
  pushFlight.set(phone, true)

  try {
    const { critical, cache } = packUser(phone)

    // Always push critical — this is what the bot NEEDS to reconnect
    if (critical) {
      const ok = await pushFile(
        `${SESS_FOLDER}/${phone}/sessionData.json`,
        critical,
        `backup session: ${phone} — ${new Date().toISOString()}`
      )
      if (ok) console.log(`[BACKUP:${phone}] ✔ Critical session pushed`)
      else    console.error(`[BACKUP:${phone}] ✗ Critical session push failed`)
    }

    // Push cache separately — if this fails, the bot still works fine
    if (cache) {
      try {
        const ok = await pushFile(
          `${CACHE_FOLDER}/${phone}/baileysCache.json`,
          cache,
          `backup cache: ${phone} — ${new Date().toISOString()}`
        )
        if (ok) console.log(`[BACKUP:${phone}] ✔ Baileys cache pushed`)
      } catch (e) {
        // Cache push failure is non-fatal — log and move on
        console.warn(`[BACKUP:${phone}] ⚠ Cache push failed (non-fatal): ${e.message}`)
      }
    }
  } catch (e) {
    console.error(`[BACKUP:${phone}] ✗ Push error: ${e.message}`)
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

// ─────────────────────────────────────────────────────────────────────────────
// META
// ─────────────────────────────────────────────────────────────────────────────

async function pushMeta(phones) {
  if (!enabled) return
  try {
    await pushFile(META_PATH, phones, `meta: ${phones.length} phone(s)`)
  } catch (e) {
    console.error('[BACKUP:meta] ✗ push failed:', e.message)
  }
}

async function fetchMeta() {
  try {
    const res = await ghRequest('GET', `/repos/${REPO}/contents/${META_PATH}?ref=${BRANCH}`)
    if (res.status !== 200) return []
    const json = decodeGithubContent(res.data.content)
    return json ? JSON.parse(json) : []
  } catch (e) {
    console.error('[BACKUP:meta] ✗ fetch failed:', e.message)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE — per user, critical first then cache best-effort
// One user's bad/missing data NEVER blocks another user's restore.
// ─────────────────────────────────────────────────────────────────────────────

async function listRemoteUsers() {
  try {
    const res = await ghRequest('GET', `/repos/${REPO}/contents/${SESS_FOLDER}?ref=${BRANCH}`)
    if (res.status !== 200 || !Array.isArray(res.data)) return []
    return res.data.filter(e => e.type === 'dir').map(e => e.name)
  } catch (e) {
    console.error('[BACKUP] ✗ listRemoteUsers error:', e.message)
    return []
  }
}

async function fetchAndUnpack(phone, githubPath, label) {
  try {
    const res = await ghRequest('GET', `/repos/${REPO}/contents/${githubPath}?ref=${BRANCH}`)
    if (res.status === 404) return 0
    if (res.status !== 200) {
      console.error(`[BACKUP:${phone}] ✗ ${label} fetch failed: ${res.status}`)
      return 0
    }
    const json = decodeGithubContent(res.data.content)
    if (!json) { console.error(`[BACKUP:${phone}] ✗ ${label} content empty`); return 0 }
    const data = JSON.parse(json)
    const count = unpackFiles(phone, data)
    console.log(`[BACKUP:${phone}] ✔ ${label}: ${count} file(s) restored`)
    return count
  } catch (e) {
    console.error(`[BACKUP:${phone}] ✗ ${label} error: ${e.message}`)
    return 0
  }
}

async function restoreAll() {
  if (!enabled) {
    console.warn('[BACKUP] Skipping restore — backup not configured')
    return 0
  }

  const phones = await listRemoteUsers()

  if (phones.length === 0) {
    console.log('[BACKUP] No session folders found — starting fresh')
    return 0
  }

  console.log(`[BACKUP] Restoring ${phones.length} user(s) independently...`)
  let restored = 0

  for (const phone of phones) {
    try {
      // CRITICAL restore — must succeed for bot to connect
      const criticalCount = await fetchAndUnpack(
        phone,
        `${SESS_FOLDER}/${phone}/sessionData.json`,
        'critical session'
      )

      if (criticalCount > 0) {
        restored++
        // CACHE restore — best-effort, failure is non-fatal
        await fetchAndUnpack(
          phone,
          `${CACHE_FOLDER}/${phone}/baileysCache.json`,
          'Baileys cache'
        ).catch(e => console.warn(`[BACKUP:${phone}] ⚠ cache restore skipped: ${e.message}`))
      }
    } catch (e) {
      console.error(`[BACKUP:${phone}] ✗ unexpected error, skipping: ${e.message}`)
      // never let one user crash the whole restore loop
    }
  }

  console.log(`[BACKUP] ✔ ${restored}/${phones.length} session(s) restored`)
  return restored
}

module.exports = {
  enabled,
  schedulePush,
  pushImmediate,
  pushMeta,
  fetchMeta,
  restoreAll,
}

