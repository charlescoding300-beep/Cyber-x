// ─────────────────────────────────────────────────────────────────────────────
// lib/isAdmin.js  —  CYBER X  |  Admin + Owner Checker
//
// Handles ALL permission checks in one place:
//   • isOwner(sender)          — is this the bot owner?
//   • isAdmin(groupCache, from, sender, sock) — is sender a group admin?
//   • isBotAdmin(groupCache, from, sock)      — is the bot itself a group admin?
//   • getAdmins(groupCache, from)             — get Set of all admin numbers
//
// Usage in any command:
//   const { isAdmin, isBotAdmin, isOwner } = require("../lib/isAdmin")
//
// Or just use the context destructure — index.js and session.js
// already pass isAdmin, isBotAdmin, isOwner into every command.run()
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
// Checks against:
//   1. settings.owners array (from lib/settings.js / .env OWNER_NUMBER)
//   2. ownerVerifiedJid (session-persistent verified owner)
//   3. Direct env fallback
// ─────────────────────────────────────────────────────────────────────────────
function isOwner(sender, extraOwnerJid) {
  if (!sender) return false
  const clean = toNum(sender)
  if (!clean) return false

  // 1. Check verified owner from this session (passed in from index.js)
  if (extraOwnerJid) {
    if (clean === toNum(extraOwnerJid)) return true
  }

  // 2. Check settings.owners array
  if (_settings) {
    if (typeof _settings.isOwner === "function") {
      if (_settings.isOwner(sender)) return true
    }
    const owners = _settings.owners || _settings.store?.owners || []
    if (owners.includes(clean)) return true
    const base = (_settings.owner || _settings.store?.owner || "").replace(/\D/g, "")
    if (base && clean === base) return true
  }

  // 3. Raw env fallback
  const envOwner = (process.env.OWNER_NUMBER || "").replace(/\D/g, "")
  if (envOwner && clean === envOwner) return true

  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ADMIN SET
// Reads from groupCache (in-RAM, zero network) and returns a Set of phone
// numbers that are admins in the given group.
// Handles @lid JIDs, device suffixes, and phoneNumber fields.
// ─────────────────────────────────────────────────────────────────────────────
function buildAdminSet(groupCache, from) {
  const meta = groupCache?.[from]
  if (!meta?.participants) return new Set()

  const admins = new Set()
  for (const p of meta.participants) {
    if (p.admin !== "admin" && p.admin !== "superadmin") continue

    // Standard JID
    admins.add(toNum(p.id))

    // @lid participant — also index phone number if available
    if (p.id?.endsWith("@lid") && p.phoneNumber)
      admins.add(p.phoneNumber.replace(/\D/g, ""))

    // PN participant — also index lid if present
    if (p.lid)
      admins.add(toNum(p.lid))
  }
  return admins
}

// ─────────────────────────────────────────────────────────────────────────────
// IS ADMIN
// Returns true if sender is a group admin OR the bot owner.
// Owner always passes admin checks — they can use any admin command anywhere.
// ─────────────────────────────────────────────────────────────────────────────
function isAdmin(groupCache, from, sender, sock, ownerJid) {
  if (!from?.endsWith("@g.us")) return false

  // Owner always counts as admin
  if (isOwner(sender, ownerJid)) return true

  const admins = buildAdminSet(groupCache, from)
  return admins.has(toNum(sender))
}

// ─────────────────────────────────────────────────────────────────────────────
// IS BOT ADMIN
// Returns true if the bot's own number is a group admin.
// ─────────────────────────────────────────────────────────────────────────────
function isBotAdmin(groupCache, from, sock) {
  if (!from?.endsWith("@g.us")) return false
  const botNum = toNum(sock?.user?.id || "")
  if (!botNum) return false
  const admins = buildAdminSet(groupCache, from)
  return admins.has(botNum)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET ADMINS
// Returns the full Set of admin phone numbers for a group.
// Useful for commands that need to list or count admins.
// ─────────────────────────────────────────────────────────────────────────────
function getAdmins(groupCache, from) {
  if (!from?.endsWith("@g.us")) return new Set()
  return buildAdminSet(groupCache, from)
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT — called from index.js once after connect
// Stores a reference to groupCache so lib.isAdmin / lib.isBotAdmin
// can be called without passing groupCache every time
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

// ── Convenience wrappers (uses stored cache — for index.js usage) ─────────────
function checkIsAdmin(from, sender, ownerJid) {
  return isAdmin(_cache || {}, from, sender, _sock, ownerJid)
}

function checkIsBotAdmin(from) {
  return isBotAdmin(_cache || {}, from, _sock)
}

function checkGetAdmins(from) {
  return getAdmins(_cache || {}, from)
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  // Core functions (pass groupCache explicitly — for session.js usage)
  isOwner,
  isAdmin,
  isBotAdmin,
  getAdmins,
  buildAdminSet,
  toNum,
  stripDevice,

  // Init (called from index.js)
  initAdminCache,
  setSocket,

  // Convenience wrappers (uses stored cache — for index.js)
  checkIsAdmin,
  checkIsBotAdmin,
  checkGetAdmins,
}
