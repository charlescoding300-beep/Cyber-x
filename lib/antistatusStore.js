'use strict'
// ════════════════════════════════════════════════════════════════════
//  lib/antistatusStore.js  —  ZENX | permanent anti-status warning records
//
//  Warnings are saved to disk the moment they change and are only ever
//  removed when an admin resets them (.resetwarn / .antistatus reset).
//  They survive restarts, crashes and re-joins. A person who was kicked at
//  3/3 keeps their 3/3 record.
//
//  File:  <project>/data/antistatus-warns.json      (override: ANTISTATUS_DATA_DIR)
//  Limit: ANTISTATUS_MAX_WARNS in .env (default 3)
//         ANTISTATUS_KICK_AT_MAX=0 in .env → count only, never auto-remove
//
//  Records are keyed by  session phone + group + user, so each connected
//  bot number keeps its own separate list.
//
//  USE IT FROM lib/antistatusgc.js  (instead of counting warnings in memory):
//      const store = require('./antistatusStore').antistatusStore
//      const count = store.addWarn(phone, groupJid, senderJid)      // → new total
//      if (count >= store.MAX_WARNS) { /* remove from group */ }
//  and from your .resetwarn command for the "antistatus" type:
//      store.reset(phone, groupJid, userJid)       // one person  → true/false
//      store.reset(phone, groupJid, 'all')         // everyone in this group → count
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const DIR  = process.env.ANTISTATUS_DATA_DIR || path.join(__dirname, '..', 'data')
const FILE = path.join(DIR, 'antistatus-warns.json')
const MAX_WARNS = Math.max(1, parseInt(process.env.ANTISTATUS_MAX_WARNS, 10) || 3)
// 3 warnings → removed from the group. Set ANTISTATUS_KICK_AT_MAX=0 in .env to only count and never remove.
const KICK_AT_MAX = process.env.ANTISTATUS_KICK_AT_MAX !== '0'
const MAX_HISTORY = 50

let db = { version: 1, warns: {} }

// "2348012345678:12@s.whatsapp.net" → "2348012345678@s.whatsapp.net"  (drop the device part)
const norm = jid => String(jid || '').trim().replace(/:\d+(?=@)/, '')
const keyOf = (phone, group, user) => `${String(phone)}|${norm(group)}|${norm(user)}`

function load() {
  try { fs.mkdirSync(DIR, { recursive: true }) } catch {}
  for (const f of [FILE, FILE + '.bak']) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (parsed && typeof parsed.warns === 'object') { db = { version: 1, warns: parsed.warns }; return }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        try { fs.renameSync(f, `${f}.corrupt-${Date.now()}`) } catch {}   // keep the bad file, never lose data silently
        console.warn(`[ANTISTATUS STORE] ${path.basename(f)} unreadable (${e.message}) — trying backup`)
      }
    }
  }
}

// atomic: write a temp file, keep the previous good copy as .bak, then rename over the real file
function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak') } catch {}
    fs.renameSync(tmp, FILE)
  } catch (e) {
    console.error('[ANTISTATUS STORE] SAVE FAILED:', e.message)
  }
}

load()

function addWarn(phone, group, user, meta = {}) {
  const k = keyOf(phone, group, user)
  const now = Date.now()
  const rec = db.warns[k] || (db.warns[k] = { count: 0, first: now, last: now, history: [] })
  rec.count += 1
  rec.last = now
  rec.history.push({ at: now, ...meta })
  if (rec.history.length > MAX_HISTORY) rec.history.splice(0, rec.history.length - MAX_HISTORY)
  save()
  return rec.count
}

const getWarn = (phone, group, user) => db.warns[keyOf(phone, group, user)]?.count || 0

// user = a JID → removes that person (returns true/false); user = 'all' → clears the group (returns how many)
function reset(phone, group, user) {
  if (String(user).toLowerCase() === 'all') {
    const prefix = `${String(phone)}|${norm(group)}|`
    let n = 0
    for (const k of Object.keys(db.warns)) if (k.startsWith(prefix)) { delete db.warns[k]; n++ }
    if (n) save()
    return n
  }
  const k = keyOf(phone, group, user)
  if (!db.warns[k]) return false
  delete db.warns[k]
  save()
  return true
}

function list(phone, group) {
  const prefix = `${String(phone)}|${norm(group)}|`
  return Object.entries(db.warns)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, r]) => ({ user: k.slice(prefix.length), count: r.count, first: r.first, last: r.last }))
    .sort((a, b) => b.count - a.count || b.last - a.last)
}

const stats = () => ({ file: FILE, total: Object.keys(db.warns).length })

const api = { addWarn, getWarn, reset, list, stats, norm, MAX_WARNS, KICK_AT_MAX, FILE, _reload: load }

// the engine / other commands can reach it through globals too
global.__antistatusWarnStore  = api
global.__antistatusAddWarn    = addWarn
global.__antistatusGetWarns   = getWarn
global.__antistatusResetWarn  = reset
global.__antistatusListWarns  = list

// index.js auto-loads everything in lib/ and may merge exports by name, so export ONE namespaced key
module.exports = { antistatusStore: api }