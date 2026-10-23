// ─────────────────────────────────────────────────────────────────────────────
// lib/isAdmin.js  —  ZENX  |  Admin + Owner Checker
//
// Handles ALL permission checks in one place:
//   • isOwner(sender)          — is this the bot owner?
//   • isAdmin(groupCache, from, sender, sock, ownerJid, senderAlt) — group admin?
//   • isBotAdmin(groupCache, from, sock)      — is the bot itself a group admin?
//   • getAdmins(groupCache, from)             — get Set of all admin numbers
//   • isOwnerOnly(sender, sock)               — strict owner-only gate (NEW)
//
// FIX (2026): WhatsApp now mixes @lid and @s.whatsapp.net JIDs inside
// groupMetadata().participants, and the .lid / .phoneNumber cross-reference
// fields are NOT always populated by WhatsApp for every participant.
// On top of that, incoming messages often carry msg.key.participant as an
// @lid JID while the real phone number sits in msg.key.participantPn.
// If we only ever match one representation, real admins get rejected.
//
// Fix: buildAdminSet() now indexes every admin under ALL forms we can see
// (raw id, lid, phoneNumber), and isAdmin() accepts an optional senderAlt
// (e.g. msg.key.participantPn) so we check both representations of the
// sender before deciding.
//
// MULTI-SESSION FIX: isOwner() now also accepts the session's own `sock`
// and recognizes that session's own linked WhatsApp account (sock.user.id /
// sock.user.lid) as that session's owner — independent of the global
// OWNER_NUMBER env var. This matters because in a multi-session bot, each
// linked account should always be treated as its own session's owner.
// ─────────────────────────────────────────────────────────────────────────────

// ── Try to load settings for owner list ──────────────────────────────────────
let _settings = null
try { _settings = require("./settings") } catch {}

// ── Strip :device suffix from JID ────────────────────────────────────────────
// e.g. "2547xxx:12@s.whatsapp.net" → "2547xxx@s.whatsapp.net"
function stripDevice(jid) {
  return (jid || "").replace(/:.*@/, "@")
}

// ── Get clean phone number from any JID ──────────────────────────────────────
function toNum(jid) {
  return stripDevice(jid || "").split("@")[0].replace(/\D/g, "")
}

// Keep WhatsApp's identity namespace intact. A LID is not a phone number, so
// stripping every JID down to digits can compare unrelated accounts. Baileys
// v7 exposes the PN/LID pair on GroupParticipant; index both when available.
function normalizeJid(jid) {
  const value = String(jid || "").trim().toLowerCase()
  if (!value) return ""
  return value.replace(/:\d+(?=@)/, "")
}

function identityKeys(value) {
  const jid = normalizeJid(value)
  if (!jid) return []
  const at = jid.lastIndexOf("@")
  if (at < 1) {
    const digits = jid.replace(/\D/g, "")
    return digits ? [`pn:${digits}`] : []
  }
  const local = jid.slice(0, at)
  const domain = jid.slice(at + 1)
  const keys = [`jid:${jid}`]
  if (domain === "s.whatsapp.net" || domain === "c.us") {
    const digits = local.replace(/\D/g, "")
    if (digits) keys.push(`pn:${digits}`)
  }
  return keys
}

function participantIdentityKeys(participant) {
  return [...new Set([
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
  ].flatMap(identityKeys))]
}

function isAdminParticipant(participant) {
  return participant?.admin === "admin" || participant?.admin === "superadmin" ||
    participant?.isAdmin === true || participant?.isSuperAdmin === true
}

function participantMatches(participant, ...targets) {
  if (!participant) return false
  const keys = new Set(participantIdentityKeys(participant))
  return targets.filter(Boolean).some(target => identityKeys(target).some(key => keys.has(key)))
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER CHECK
// sock (optional) → if provided, this session's own linked account is
// always recognized as owner for this session.
// ─────────────────────────────────────────────────────────────────────────────
function isOwner(sender, extraOwnerJid, sock) {
  if (!sender) return false
  const clean = toNum(sender)
  if (!clean) return false

  if (extraOwnerJid) {
    if (clean === toNum(extraOwnerJid)) return true
  }

  if (_settings) {
    if (typeof _settings.isOwner === "function") {
      if (_settings.isOwner(sender)) return true
    }
    const owners = _settings.owners || _settings.store?.owners || []
    if (owners.includes(clean)) return true
    const base = (_settings.owner || _settings.store?.owner || "").replace(/\D/g, "")
    if (base && clean === base) return true
  }

  const envOwner = (process.env.OWNER_NUMBER || "").replace(/\D/g, "")
  if (envOwner && clean === envOwner) return true

  // ── Multi-session fix ──────────────────────────────────────────────────
  // This bot's OWN linked WhatsApp account is always its own owner, for
  // THIS session — independent of the global OWNER_NUMBER env var. Each
  // session's sock.user.id is that session's own connected number.
  if (sock?.user?.id) {
    const linkedNum = toNum(sock.user.id)
    if (linkedNum && clean === linkedNum) return true
  }
  if (sock?.user?.lid) {
    const linkedLid = toNum(sock.user.lid)
    if (linkedLid && clean === linkedLid) return true
  }

  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER ONLY GATE  ← NEW
// A strict check that ONLY passes for the bot owner.
// Unlike isAdmin() which also passes for group admins, this one
// is purely for commands that only Charles should be able to run.
//
// Usage in any command:
//   const { isOwnerOnly } = require("../lib/isAdmin")
//   if (!isOwnerOnly(sender, sock)) return sock.sendMessage(...)
// ─────────────────────────────────────────────────────────────────────────────
function isOwnerOnly(sender, sock, senderAlt) {
  if (isOwner(sender, null, sock)) return true
  if (senderAlt && isOwner(senderAlt, null, sock)) return true
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ADMIN SET
// Reads from groupCache (in-RAM, zero network) and returns a Set containing
// EVERY identity form (id, lid, phoneNumber) for each admin — so a match on
// any one representation succeeds.
// ─────────────────────────────────────────────────────────────────────────────
function buildAdminSet(groupCache, from) {
  const meta = groupCache?.[from]
  if (!meta?.participants) return new Set()

  const admins = new Set()
  for (const p of meta.participants) {
    if (!isAdminParticipant(p)) continue

    // Whatever format p.id is in (lid OR phone) — index it
    const idNum = toNum(p.id)
    if (idNum) admins.add(idNum)

    // Explicit phoneNumber field (present on some @lid participants)
    if (p.phoneNumber) admins.add(toNum(p.phoneNumber))

    // Explicit lid field (present on some phone-keyed participants)
    if (p.lid) admins.add(toNum(p.lid))

    // Some Baileys forks expose participantPn / jid as an alt field too
    if (p.jid) admins.add(toNum(p.jid))
  }
  return admins
}

// ─────────────────────────────────────────────────────────────────────────────
// IS ADMIN
// sender     → msg.key.participant (often @lid now)
// senderAlt  → msg.key.participantPn / msg.participantAlt, if available
// Checks BOTH representations against the admin set.
// ─────────────────────────────────────────────────────────────────────────────
function isAdmin(groupCache, from, sender, sock, ownerJid, senderAlt) {
  if (!from?.endsWith("@g.us")) return false

  // Owner always counts as admin — sock is passed through so isOwner can
  // also check this session's own linked account.
  if (isOwner(sender, ownerJid, sock) || (senderAlt && isOwner(senderAlt, ownerJid, sock))) return true

  return isParticipantAdmin(groupCache, from, sender, senderAlt)
}

function isParticipantAdmin(groupCache, from, ...targets) {
  const meta = groupCache?.[from]
  if (!Array.isArray(meta?.participants)) return false
  return meta.participants.some(p => isAdminParticipant(p) && participantMatches(p, ...targets))
}

// ─────────────────────────────────────────────────────────────────────────────
// IS BOT ADMIN
// ─────────────────────────────────────────────────────────────────────────────
function isBotAdmin(groupCache, from, sock) {
  if (!from?.endsWith("@g.us")) return false
  const rawCandidates = [
    sock?.user?.id,
    sock?.user?.lid,
    sock?.authState?.creds?.me?.id,
    sock?.authState?.creds?.me?.lid,
  ].filter(Boolean)
  const meta = groupCache?.[from]
  if (!Array.isArray(meta?.participants)) return false
  return meta.participants.some(p => isAdminParticipant(p) && participantMatches(p, ...rawCandidates))
}

function stateForSocket(sock, phone) {
  const states = global.__sessionStates
  if (!(states instanceof Map)) return null
  if (phone && states.has(String(phone))) return states.get(String(phone))
  for (const state of states.values()) {
    if (state?.sock === sock) return state
    const stateId = normalizeJid(state?.sock?.user?.id)
    const socketId = normalizeJid(sock?.user?.id)
    if (stateId && socketId && stateId === socketId) return state
  }
  return null
}

const ADMIN_META_TTL_MS = 60_000
const ADMIN_META_MAX_STALE_MS = 5 * 60_000
const ADMIN_META_TIMEOUT_MS = 8_000
const adminMetaInflight = new Map()

async function getAdminMetadata(sock, from, phone) {
  const state = stateForSocket(sock, phone)
  const cached = state?.groupCache?.[from]
  const age = cached?._cachedAt ? Date.now() - cached._cachedAt : Infinity
  if (Array.isArray(cached?.participants) && age <= ADMIN_META_TTL_MS) {
    return { meta: cached, available: true, stale: false }
  }

  const key = `${state?.phone || toNum(sock?.user?.id)}:${from}`
  let refresh = adminMetaInflight.get(key)
  if (!refresh) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("groupMetadata timed out")), ADMIN_META_TIMEOUT_MS)
    })
    refresh = Promise.race([Promise.resolve().then(() => sock.groupMetadata(from)), timeout])
      .then(meta => {
        if (!meta || !Array.isArray(meta.participants)) {
          throw new Error("groupMetadata returned no participant list")
        }
        if (state?.groupCache) state.groupCache[from] = { ...meta, _cachedAt: Date.now() }
        return meta
      })
      .finally(() => {
        clearTimeout(timer)
        adminMetaInflight.delete(key)
      })
    adminMetaInflight.set(key, refresh)
  }

  try {
    return { meta: await refresh, available: true, stale: false }
  } catch (error) {
    if (Array.isArray(cached?.participants) && age <= ADMIN_META_MAX_STALE_MS) {
      return { meta: cached, available: true, stale: true, error }
    }
    return { meta: null, available: false, stale: false, error }
  }
}

async function getGroupAdminContext(sock, from, sender, senderAlt, phone) {
  const result = await getAdminMetadata(sock, from, phone)
  if (!result.available) {
    return { ...result, botAdmin: false, senderAdmin: false }
  }
  const cache = { [from]: result.meta }
  return {
    ...result,
    botAdmin: isBotAdmin(cache, from, sock),
    senderAdmin: isParticipantAdmin(cache, from, sender, senderAlt),
  }
}

function sessionPhoneOf(sock, fallback) {
  const state = stateForSocket(sock, fallback)
  const phone = state?.phone || fallback || sock?.user?.id || sock?.user?.lid || ""
  return toNum(phone)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET ADMINS
// ─────────────────────────────────────────────────────────────────────────────
function getAdmins(groupCache, from) {
  if (!from?.endsWith("@g.us")) return new Set()
  return buildAdminSet(groupCache, from)
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT — called from index.js once after connect
// ─────────────────────────────────────────────────────────────────────────────
let _cache = null
let _sock  = null

function initAdminCache(groupCache) {
  _cache = groupCache
  console.log("[isAdmin] ✔ Admin cache wired — instant checks enabled")
}

function setSocket(sock) {
  _sock = sock
}

// ── Convenience wrappers — now also accept senderAlt (participantPn) ─────────
function checkIsAdmin(from, sender, ownerJid, senderAlt) {
  return isAdmin(_cache || {}, from, sender, _sock, ownerJid, senderAlt)
}

function checkIsBotAdmin(from) {
  return isBotAdmin(_cache || {}, from, _sock)
}

function checkGetAdmins(from) {
  return getAdmins(_cache || {}, from)
}

// ── Convenience wrapper for owner-only check ──────────────────────────────────
function checkIsOwnerOnly(sender, senderAlt) {
  return isOwnerOnly(sender, _sock, senderAlt)
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  isOwner,
  isOwnerOnly,       // ← NEW
  isAdmin,
  isBotAdmin,
  getAdmins,
  buildAdminSet,
  normalizeJid,
  identityKeys,
  participantIdentityKeys,
  participantMatches,
  isAdminParticipant,
  isParticipantAdmin,
  getAdminMetadata,
  getGroupAdminContext,
  sessionPhoneOf,
  toNum,
  stripDevice,

  initAdminCache,
  setSocket,

  checkIsAdmin,
  checkIsBotAdmin,
  checkGetAdmins,
  checkIsOwnerOnly,  // ← NEW
}
