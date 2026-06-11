// ════════════════════════════════════════════════════════════════════
//  lib/isAdmin.js — CYBER X | Ultra-fast Admin Checker v5
//  LID + PN dual-index — works regardless of JID format
// ════════════════════════════════════════════════════════════════════

const CACHE    = new Map()
const INFLIGHT = new Map()
const TTL      = 5 * 60 * 1000

let _store = null

const toNum = jid => (jid || "").replace(/:.*@/, "@").split("@")[0]

function setStore(store) { _store = store }

function setSocket(sock) {
  sock.ev.on("group-participants.update", ({ id, action }) => {
    if (["promote", "demote", "remove", "add"].includes(action)) {
      CACHE.delete(id)
      INFLIGHT.delete(id)
    }
  })
}

async function _fetch(sock, from) {
  try {
    const meta = _store?.groupMetadata?.[from]
               ?? await sock.groupMetadata(from)

    const admins = new Set()
    for (const p of meta.participants) {
      if (p.admin !== "admin" && p.admin !== "superadmin") continue
      admins.add(toNum(p.id))
      // LID participant → also index phone number so PN sender matches
      if (p.id?.endsWith("@lid") && p.phoneNumber) {
        admins.add(p.phoneNumber.replace(/\D/g, ""))
      }
      // PN participant → also index lid if present
      if (p.lid) admins.add(toNum(p.lid))
    }

    const botNum   = toNum(sock.user?.id || "")
    const botAdmin = admins.has(botNum)
    const entry    = { admins, botNum, botAdmin, ts: Date.now() }

    CACHE.set(from, entry)
    INFLIGHT.delete(from)
    return entry
  } catch {
    INFLIGHT.delete(from)
    return { admins: new Set(), botAdmin: false }
  }
}

function _get(sock, from) {
  const cached = CACHE.get(from)
  if (cached && Date.now() - cached.ts < TTL) return Promise.resolve(cached)
  if (INFLIGHT.has(from)) return INFLIGHT.get(from)
  const p = _fetch(sock, from)
  INFLIGHT.set(from, p)
  return p
}

async function isAdmin(sock, from, sender) {
  if (!from?.endsWith("@g.us")) return false
  const { admins } = await _get(sock, from)
  return admins.has(toNum(sender))
}

async function isBotAdmin(sock, from) {
  if (!from?.endsWith("@g.us")) return false
  const { botAdmin } = await _get(sock, from)
  return botAdmin
}

async function getAdmins(sock, from) {
  if (!from?.endsWith("@g.us")) return new Set()
  const { admins } = await _get(sock, from)
  return admins
}

function invalidate(from)  { CACHE.delete(from);  INFLIGHT.delete(from) }
function invalidateAll()   { CACHE.clear();        INFLIGHT.clear()      }

module.exports = { isAdmin, isBotAdmin, getAdmins, setSocket, setStore, invalidate, invalidateAll, toNum }
