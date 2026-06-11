// ════════════════════════════════════════════════════════════════════
//  lib/isAdmin.js — CYBER X | Ultra-fast Admin Checker v5
//  Fix: full LID + PN dual-index so @lid and @s.whatsapp.net both match
// ════════════════════════════════════════════════════════════════════

const CACHE    = new Map()
const INFLIGHT = new Map()
const TTL      = 5 * 60 * 1000

let _store = null

// strip @domain and :device — works on @s.whatsapp.net AND @lid
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

      // always store the raw id number (works for both @s.whatsapp.net and @lid)
      admins.add(toNum(p.id))

      // if participant is stored as @lid, also index their phone number
      // so a sender arriving as @s.whatsapp.net still matches
      if (p.id?.endsWith("@lid") && p.phoneNumber) {
        admins.add(p.phoneNumber.replace(/\D/g, ""))
      }

      // if there's a separate lid field on a PN participant, index that too
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
