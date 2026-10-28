'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/sudostore.js  —  ZEN X | per-session SUDO list (persistent)
//
//  Each linked WhatsApp session (bot owner) has its OWN sudo list, stored in
//  data/sudo/<session-number>.json. Sudo users can use the bot while it is in
//  PRIVATE mode. They are NOT owners: owner-only commands stay owner-only.
//
//  The list survives restarts (written atomically to disk) and is removed when
//  that session is logged out / removed.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'data', 'sudo')
const cache = new Map()

const digits = v => String(v || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
const fileFor = sessionPhone => path.join(DIR, `${digits(sessionPhone) || 'unknown'}.json`)

function load(sessionPhone) {
  const key = digits(sessionPhone) || 'unknown'
  if (cache.has(key)) return cache.get(key)

  let data = { users: {} }
  try {
    const file = fileFor(key)
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed.users === 'object' && parsed.users !== null) data = parsed
    }
  } catch (e) {
    console.error('[SUDO] could not read sudo list:', e.message)
  }
  cache.set(key, data)
  return data
}

function save(sessionPhone, data) {
  const key = digits(sessionPhone) || 'unknown'
  fs.mkdirSync(DIR, { recursive: true })
  const file = fileFor(key)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)   // atomic: a crash never leaves a half-written list
  cache.set(key, data)
}

// Phone-number format check: 7–15 digits, no leading zero (international format)
const isValidNumber = n => /^[1-9]\d{6,14}$/.test(n)

// Is any of these numbers on this session's sudo list?
function isSudo(sessionPhone, numbers) {
  const users = load(sessionPhone).users
  return (numbers || []).map(digits).some(n => n && Object.prototype.hasOwnProperty.call(users, n))
}

function list(sessionPhone) {
  const users = load(sessionPhone).users
  return Object.entries(users)
    .map(([number, info]) => ({ number, addedBy: info.addedBy || null, addedAt: info.addedAt || null }))
    .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
}

// returns { ok, reason } — reason: 'invalid' | 'exists' | 'added'
function add(sessionPhone, number, addedBy) {
  const n = digits(number)
  if (!isValidNumber(n)) return { ok: false, reason: 'invalid' }
  const data = load(sessionPhone)
  if (Object.prototype.hasOwnProperty.call(data.users, n)) return { ok: false, reason: 'exists' }
  data.users[n] = { addedBy: digits(addedBy) || null, addedAt: new Date().toISOString() }
  save(sessionPhone, data)
  return { ok: true, reason: 'added' }
}

// returns true if removed, false if the number was not on the list
function remove(sessionPhone, number) {
  const n = digits(number)
  const data = load(sessionPhone)
  if (!Object.prototype.hasOwnProperty.call(data.users, n)) return false
  delete data.users[n]
  save(sessionPhone, data)
  return true
}

// removes everyone; returns how many were removed
function clear(sessionPhone) {
  const data = load(sessionPhone)
  const count = Object.keys(data.users).length
  data.users = {}
  save(sessionPhone, data)
  return count
}

// called when a session is removed (logout): drop its file and cache entry
function wipe(sessionPhone) {
  const key = digits(sessionPhone) || 'unknown'
  cache.delete(key)
  try { fs.unlinkSync(fileFor(key)) } catch {}
  try { fs.unlinkSync(fileFor(key) + '.tmp') } catch {}
}

module.exports = { isSudo, list, add, remove, clear, wipe, isValidNumber, digits }

