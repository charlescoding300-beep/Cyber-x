'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionBackup.js  —  CYBER X  |  GitHub Session Backup
//
// Render's free tier wipes local disk on every restart/redeploy, which was
// disconnecting every linked user's WhatsApp session. This module backs up
// gateway_sessions/ (every linked user's auth creds) to a PRIVATE GitHub
// repo, and restores them automatically on boot — so sessions survive
// restarts without needing a database.
//
// REQUIRED ENV VARS (set these on Render):
//   GITHUB_TOKEN          - a GitHub Personal Access Token with "repo" scope
//   GITHUB_BACKUP_REPO    - "username/repo-name" of a PRIVATE repo to use as
//                           storage (create an empty private repo for this)
//   GITHUB_BACKUP_BRANCH  - optional, defaults to "main"
//
// HOW IT WORKS:
//   - Every time a session connects/updates, its creds folder is packed
//     into a base64 JSON blob and pushed to the GitHub repo via the
//     GitHub Contents API (no git binary needed — pure HTTPS calls).
//   - On boot, restoreAll() pulls the latest backup from GitHub and
//     extracts it into gateway_sessions/ BEFORE sessions try to start.
//   - Pushes are debounced (max once per 20s) so rapid reconnects don't
//     spam GitHub's API and hit rate limits.
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')

const GW_SESSIONS = path.join(__dirname, '..', 'gateway_sessions')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const REPO         = process.env.GITHUB_BACKUP_REPO   // "username/repo"
const BRANCH       = process.env.GITHUB_BACKUP_BRANCH || 'main'
const BACKUP_PATH  = 'sessions-backup.json'            // file inside the repo

const enabled = !!(GITHUB_TOKEN && REPO)

if (!enabled) {
  console.warn('[BACKUP] ⚠ GITHUB_TOKEN / GITHUB_BACKUP_REPO not set — sessions will NOT survive restarts')
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Contents API helpers (raw HTTPS — no extra npm package needed)
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
        try { parsed = JSON.parse(chunks) } catch (e) {}
        resolve({ status: res.statusCode, data: parsed })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PACK / UNPACK — turn the whole gateway_sessions/ folder into one JSON blob
// ─────────────────────────────────────────────────────────────────────────────

function packSessions() {
  const out = {}
  if (!fs.existsSync(GW_SESSIONS)) return out

  for (const userId of fs.readdirSync(GW_SESSIONS)) {
    const dir = path.join(GW_SESSIONS, userId)
    if (!fs.statSync(dir).isDirectory()) continue

    out[userId] = {}
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file)
      if (!fs.statSync(filePath).isFile()) continue
      out[userId][file] = fs.readFileSync(filePath).toString('base64')
    }
  }
  return out
}

function unpackSessions(data) {
  if (!data || typeof data !== 'object') return 0
  let restored = 0

  for (const userId of Object.keys(data)) {
    const dir = path.join(GW_SESSIONS, userId)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    for (const file of Object.keys(data[userId])) {
      const filePath = path.join(dir, file)
      fs.writeFileSync(filePath, Buffer.from(data[userId][file], 'base64'))
    }
    restored++
  }
  return restored
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH — save current sessions to GitHub (debounced)
// ─────────────────────────────────────────────────────────────────────────────

let pushTimer = null
let pushInFlight = false
let pushQueued = false

async function pushNow() {
  if (!enabled) return
  if (pushInFlight) { pushQueued = true; return }
  pushInFlight = true
  console.log('[BACKUP-DEBUG] pushNow() started')

  try {
    const packed  = packSessions()
    const content = Buffer.from(JSON.stringify(packed)).toString('base64')

    // Need the current file's SHA to update it (GitHub Contents API requirement)
    const existing = await ghRequest('GET', `/repos/${REPO}/contents/${BACKUP_PATH}?ref=${BRANCH}`)
    const sha = existing.status === 200 ? existing.data.sha : undefined

    const body = {
      message: `backup: ${Object.keys(packed).length} session(s) — ${new Date().toISOString()}`,
      content,
      branch: BRANCH,
    }
    if (sha) body.sha = sha

    console.log(`[BACKUP-DEBUG] About to PUT to GitHub — packed sessions: ${Object.keys(packed).length}, content length: ${content.length}`)
    const res = await ghRequest('PUT', `/repos/${REPO}/contents/${BACKUP_PATH}`, body)
    console.log(`[BACKUP-DEBUG] GitHub responded with status: ${res.status}`)

    if (res.status === 200 || res.status === 201) {
      console.log(`[BACKUP] ✔ Pushed ${Object.keys(packed).length} session(s) to GitHub`)
    } else {
      console.error('[BACKUP] ✗ Push failed:', res.status, JSON.stringify(res.data))
    }
  } catch (e) {
    console.error('[BACKUP] ✗ Push error:', e.message)
  } finally {
    pushInFlight = false
    if (pushQueued) { pushQueued = false; pushNow() }
  }
}

/**
 * Schedule a backup push, debounced to max once per 20s so rapid
 * reconnects/creds.update events don't spam GitHub's API.
 */
function schedulePush() {
  if (!enabled) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushNow, 20000)
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE — pull sessions from GitHub on boot
// ─────────────────────────────────────────────────────────────────────────────

async function restoreAll() {
  if (!enabled) {
    console.warn('[BACKUP] Skipping restore — backup not configured')
    return 0
  }

  try {
    const res = await ghRequest('GET', `/repos/${REPO}/contents/${BACKUP_PATH}?ref=${BRANCH}`)

    if (res.status === 404) {
      console.log('[BACKUP] No existing backup found in repo — starting fresh')
      return 0
    }
    if (res.status !== 200) {
      console.error('[BACKUP] ✗ Restore fetch failed:', res.status, res.data && res.data.message)
      return 0
    }

    const json = Buffer.from(res.data.content, 'base64').toString('utf8')
    const data = JSON.parse(json)
    const count = unpackSessions(data)

    console.log(`[BACKUP] ✔ Restored ${count} session(s) from GitHub`)
    return count
  } catch (e) {
    console.error('[BACKUP] ✗ Restore error:', e.message)
    return 0
  }
}

module.exports = {
  enabled,
  schedulePush,
  pushNow,
  restoreAll,
}
