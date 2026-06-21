'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/sessionBackup.js  —  CYBER X  |  GitHub Session Backup
//
// FIXED: now points at sessions/ (the folder index.js's startBot() actually
// uses via useMultiFileAuthState(state.sessDir)) instead of the old
// gateway_sessions/ folder from an earlier architecture, which nothing was
// ever writing to. This was the reason restores were silently doing nothing
// — the backup system was watching an empty folder.
//
// Render's free tier wipes local disk on every restart/redeploy, which was
// disconnecting every linked user's WhatsApp session. This module backs up
// sessions/ (every linked user's auth creds — owner AND anyone paired via
// the website or .fuckme, since they ALL go through index.js's startBot())
// to a PRIVATE GitHub repo, and restores them automatically on boot — so
// sessions survive restarts without needing a database.
//
// REQUIRED ENV VARS (set these on Render):
//   GITHUB_TOKEN          - a GitHub Personal Access Token with "repo" scope
//   GITHUB_BACKUP_REPO    - "username/repo-name" of a PRIVATE repo to use as
//                           storage (create an empty private repo for this)
//   GITHUB_BACKUP_BRANCH  - optional, defaults to "main"
//
// HOW IT WORKS:
//   - Every time ANY session connects or its creds update — whether it was
//     started from the website pairing flow, the .fuckme command, or your
//     own owner session — index.js calls sessionBackup.schedulePush().
//     Every session funnels through the same startBot() function in
//     index.js, so there is only ONE place sessions get created and ONE
//     place backups get triggered from. No more disconnected systems.
//   - The whole sessions/ folder is packed into one base64 JSON blob and
//     pushed to the GitHub repo via the GitHub Contents API (no git binary
//     needed — pure HTTPS calls).
//   - On boot, restoreAll() pulls the latest backup from GitHub and
//     extracts it into sessions/ BEFORE index.js tries to start anything.
//   - Pushes are debounced (max once per 4s) so rapid reconnects don't
//     spam GitHub's API and hit rate limits.
//   - pushImmediate() bypasses the debounce entirely — call this right
//     after a session successfully connects, so a complete backup exists
//     immediately rather than depending on a debounced timer surviving
//     until it fires (which it may not, on Render's free tier, if the
//     process restarts/exits before the debounce window elapses).
// ─────────────────────────────────────────────────────────────────────────────

const fs    = require('fs')
const path  = require('path')
const https = require('https')

// FIXED PATH — this now matches exactly what index.js uses:
//   const SESS_ROOT = path.join(__dirname, "sessions")
const SESS_ROOT = path.join(__dirname, '..', 'sessions')

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
// PACK / UNPACK — turn the whole sessions/ folder into one JSON blob
// ─────────────────────────────────────────────────────────────────────────────

function packSessions() {
  const out = {}
  if (!fs.existsSync(SESS_ROOT)) return out

  for (const userId of fs.readdirSync(SESS_ROOT)) {
    const dir = path.join(SESS_ROOT, userId)
    if (!fs.statSync(dir).isDirectory()) continue

    // Skip non-session files that might live in sessions/ (e.g. _meta.json
    // is handled separately below, not per-user)
    if (userId.startsWith('_')) continue

    out[userId] = {}
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file)
      if (!fs.statSync(filePath).isFile()) continue
      out[userId][file] = fs.readFileSync(filePath).toString('base64')
    }
  }

  // Also back up _meta.json (the list of which phones index.js should
  // restart on boot) so a fresh restore knows who to reconnect, not just
  // what creds exist on disk
  const metaFile = path.join(SESS_ROOT, '_meta.json')
  if (fs.existsSync(metaFile)) {
    out.__meta__ = fs.readFileSync(metaFile).toString('base64')
  }

  return out
}

function unpackSessions(data) {
  if (!data || typeof data !== 'object') return 0
  let restored = 0

  for (const userId of Object.keys(data)) {
    if (userId === '__meta__') {
      const metaFile = path.join(SESS_ROOT, '_meta.json')
      if (!fs.existsSync(SESS_ROOT)) fs.mkdirSync(SESS_ROOT, { recursive: true })
      fs.writeFileSync(metaFile, Buffer.from(data.__meta__, 'base64'))
      continue
    }

    const dir = path.join(SESS_ROOT, userId)
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

  try {
    const packed  = packSessions()
    const content = Buffer.from(JSON.stringify(packed)).toString('base64')

    // Need the current file's SHA to update it (GitHub Contents API requirement)
    const existing = await ghRequest('GET', `/repos/${REPO}/contents/${BACKUP_PATH}?ref=${BRANCH}`)
    const sha = existing.status === 200 ? existing.data.sha : undefined

    const body = {
      message: `backup: ${Object.keys(packed).filter(k => k !== '__meta__').length} session(s) — ${new Date().toISOString()}`,
      content,
      branch: BRANCH,
    }
    if (sha) body.sha = sha

    const res = await ghRequest('PUT', `/repos/${REPO}/contents/${BACKUP_PATH}`, body)

    if (res.status === 200 || res.status === 201) {
      const count = Object.keys(packed).filter(k => k !== '__meta__').length
      console.log(`[BACKUP] ✔ Pushed ${count} session(s) to GitHub`)
    } else {
      console.error('[BACKUP] ✗ Push failed:', res.status, res.data && res.data.message)
    }
  } catch (e) {
    console.error('[BACKUP] ✗ Push error:', e.message)
  } finally {
    pushInFlight = false
    if (pushQueued) { pushQueued = false; pushNow() }
  }
}

/**
 * Schedule a backup push, debounced to max once per 4s so rapid
 * reconnects/creds.update events don't spam GitHub's API.
 *
 * Shortened from 20s → 4s: on Render's free tier, the process can exit
 * (memory guard, restart, redeploy) before a long-debounced push ever
 * fires, since setTimeout doesn't survive process.exit(). A shorter
 * window means fewer scheduled-but-lost pushes.
 */
function schedulePush() {
  if (!enabled) return
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushNow, 4000)
}

/**
 * Push immediately, bypassing the debounce entirely. Use this right after
 * a session successfully connects (not on every creds.update — that still
 * goes through schedulePush so we don't spam GitHub's API on rapid key
 * rotation). This guarantees a fresh, COMPLETE backup exists right after
 * pairing, rather than hoping a debounced push survives until it fires.
 */
async function pushImmediate() {
  if (!enabled) return
  clearTimeout(pushTimer)   // cancel any pending debounced push, we're doing it now
  await pushNow()
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
  pushImmediate,
  pushNow,
  restoreAll,
}
