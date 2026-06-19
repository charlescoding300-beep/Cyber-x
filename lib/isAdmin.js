// ─────────────────────────────────────────────────────────────────────────────
// lib/isAdmin.js  —  CYBER X  |  Admin + Owner Checker
//
// Handles ALL permission checks in one place:
//   • isOwner(sender)          — is this the bot owner?
//   • isAdmin(groupCache, from, sender, sock, ownerJid, senderAlt) — group admin?
//   • isBotAdmin(groupCache, from, sock)      — is the bot itself a group admin?
//   • getAdmins(groupCache, from)             — get Set of all admin numbers
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

// ─────────────────────────────────────────────────────────────────────────────
// OWNER CHECK
// ─────────────────────────────────────────────────────────────────────────────
function isOwner(sender, extraOwnerJid) {
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
    if (p.admin !== "admin" && p.admin !== "superadmin") continue

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

  // Owner always counts as admin
  if (isOwner(sender, ownerJid) || (senderAlt && isOwner(senderAlt, ownerJid))) return true

  const admins = buildAdminSet(groupCache, from)

  if (admins.has(toNum(sender))) return true
  if (senderAlt && admins.has(toNum(senderAlt))) return true

  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// IS BOT ADMIN
// ─────────────────────────────────────────────────────────────────────────────
function isBotAdmin(groupCache, from, sock) {
  if (!from?.endsWith("@g.us")) return false
  const admins = buildAdminSet(groupCache, from)

  // Bot identity can also be split across lid/pn — check every id Baileys exposes
  const candidates = [
    sock?.user?.id,
    sock?.user?.lid,
    sock?.authState?.creds?.me?.id,
    sock?.authState?.creds?.me?.lid,
  ].filter(Boolean).map(toNum)

  return candidates.some(num => admins.has(num))
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

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  isOwner,
  isAdmin,
  isBotAdmin,
  getAdmins,
  buildAdminSet,
  toNum,
  stripDevice,

  initAdminCache,
  setSocket,

  checkIsAdmin,
  checkIsBotAdmin,
  checkGetAdmins,
}
