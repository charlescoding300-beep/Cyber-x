'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/greetLock.js — CYBER X | Cross-session welcome/goodbye lock
//
// PROBLEM: if 2+ of your CYBER X sessions are members of the same WhatsApp
// group, WhatsApp sends the "someone joined/left" event to EACH session
// independently — each has no idea the other exists, so both send a
// welcome/goodbye message, and the group sees duplicates.
//
// FIX: before sending, each session tries to "claim" the event by writing
// a short-lived key to Upstash Redis (shared across all sessions). Only
// the session that successfully claims it (first to arrive) sends the
// message — anyone else sees the key already exists and skips silently.
//
// Uses Upstash's SET ... NX (set-if-not-exists) via the REST API, same
// connection details already configured in lib/sessionBackup.js.
// ─────────────────────────────────────────────────────────────────────────────

const https = require('https')

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

const enabled = !!(UPSTASH_URL && UPSTASH_TOKEN)

if (!enabled) {
  console.warn('[GREET-LOCK] ⚠ Upstash not configured — falling back to per-session (no dedup across sessions)')
}

function upstashRequest(pathParts) {
  return new Promise((resolve, reject) => {
    const url = new URL(UPSTASH_URL)
    const encodedPath = pathParts.map(p => encodeURIComponent(p)).join('/')

    const options = {
      hostname: url.hostname,
      path: `/${encodedPath}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      },
      timeout: 5000,
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

const LOCK_TTL_SECONDS = 30 // claim window — plenty for a join/leave event to settle

/**
 * Attempts to claim a greet event. Returns true if THIS caller claimed it
 * (meaning: go ahead and send the message). Returns false if someone else
 * already claimed it within the last LOCK_TTL_SECONDS (meaning: skip).
 *
 * key should uniquely identify the event, e.g.:
 *   `greetlock:${groupId}:${participantJid}:${action}:${Math.floor(Date.now()/5000)}`
 * The 5-second time bucket groups near-simultaneous events from different
 * sessions into the same lock key without needing exact millisecond sync.
 */
async function claimGreetEvent(groupId, participantJid, action) {
  if (!enabled) return true // no Redis — every session sends, old behavior

  const timeBucket = Math.floor(Date.now() / 5000) // 5-second buckets
  const key = `greetlock:${groupId}:${participantJid}:${action}:${timeBucket}`

  try {
    // SET key value NX EX <ttl> — only succeeds if key doesn't already exist
    const result = await upstashRequest(['set', key, '1', 'NX', 'EX', String(LOCK_TTL_SECONDS)])
    // Upstash REST returns { result: "OK" } on success, { result: null } if key existed
    return result?.result === 'OK'
  } catch (e) {
    console.error('[GREET-LOCK] claim error:', e.message)
    return true // fail open — better to double-send occasionally than never send
  }
}

module.exports = { claimGreetEvent }
