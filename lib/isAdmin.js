// ════════════════════════════════════════════════════════════════════
//  lib/isAdmin.js  —  CYBER X  |  ⚡ Ultra-fast Admin Checker v3
//
//  HOW IT WORKS (fastest possible):
//    1. Baileys in-memory store → instant RAM read, zero network
//    2. In-flight deduplication → concurrent calls share one fetch
//    3. 5-min TTL cache → fallback if store misses
//    4. Auto-invalidation → group-participants.update clears cache
//
//  USAGE inside any command:
//    const { isAdmin, isBotAdmin, getAdmins } = require('../lib/isAdmin')
//    const admin    = await isAdmin(sock, from, sender)
//    const botAdmin = await isBotAdmin(sock, from)
// ════════════════════════════════════════════════════════════════════

const CACHE    = new Map()
const INFLIGHT = new Map()
const TTL      = 5 * 60 * 1000

let _store = null   // set once from index.js via setStore()

// ── Called once from index.js after store is created ─────────────────
function setStore(store) {
  _store = store
}

// ── Called once from index.js after sock is created ──────────────────
function setSocket(sock) {
  sock.ev.on('group-participants.update', ({ id, action }) => {
    if (['promote', 'demote', 'remove', 'add'].includes(action)) {
      CACHE.delete(id)
      INFLIGHT.delete(id)
    }
  })
}

// ── Internal: fetch from store (RAM) or fallback to network ──────────
async function _fetch(sock, from) {
  try {
    // Priority 1: Baileys in-memory store — instant, no network call
    const meta = _store?.groupMetadata?.[from]
               ?? await sock.groupMetadata(from)  // fallback if store empty

    const admins = new Set(
      meta.participants
        .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
        .map(p => p.id)
    )
    const botJid   = (sock.user?.id || '').replace(/:.*@/, '@')
    const botAdmin = admins.has(botJid)
    const entry    = { admins, botJid, botAdmin, ts: Date.now() }

    CACHE.set(from, entry)
    INFLIGHT.delete(from)
    return entry
  } catch {
    INFLIGHT.delete(from)
    return { admins: new Set(), botAdmin: false }
  }
}

// ── Internal: store hit → cache hit → in-flight → fresh fetch ────────
function _get(sock, from) {
  // Hot path: valid cache
  const cached = CACHE.get(from)
  if (cached && Date.now() - cached.ts < TTL) return Promise.resolve(cached)

  // Already fetching: join it
  if (INFLIGHT.has(from)) return INFLIGHT.get(from)

  // Cold: start fetch, register in-flight
  const promise = _fetch(sock, from)
  INFLIGHT.set(from, promise)
  return promise
}

// ── Public API ────────────────────────────────────────────────────────

async function isAdmin(sock, from, sender) {
  if (!from?.endsWith('@g.us')) return false
  const { admins } = await _get(sock, from)
  return admins.has(sender)
}

async function isBotAdmin(sock, from) {
  if (!from?.endsWith('@g.us')) return false
  const { botAdmin } = await _get(sock, from)
  return botAdmin
}

async function getAdmins(sock, from) {
  if (!from?.endsWith('@g.us')) return new Set()
  const { admins } = await _get(sock, from)
  return admins
}

function invalidate(from) {
  CACHE.delete(from)
  INFLIGHT.delete(from)
}

function invalidateAll() {
  CACHE.clear()
  INFLIGHT.clear()
}

module.exports = { isAdmin, isBotAdmin, getAdmins, setSocket, setStore, invalidate, invalidateAll }
