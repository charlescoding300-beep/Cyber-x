// ════════════════════════════════════════════════════════════════════
//  lib/isAdmin.js — CYBER X | Auto-init Admin Checker
//  • Zero network calls — reads directly from groupCache in RAM
//  • Call lib.initAdminCache(groupCache) once on connect — done
//  • After that: lib.isAdmin / lib.isBotAdmin just work everywhere
//  • Commands just destructure isAdmin — no setup needed per command
// ════════════════════════════════════════════════════════════════════

let _cache = null   // reference to groupCache from index.js

// ── Called once from index.js after connect ──────────────────────
function initAdminCache(groupCache) {
  _cache = groupCache
  console.log("[isAdmin] ✔ Admin cache wired — instant admin checks enabled")
}

// ── Strip :device suffix, return phone number only ───────────────
const toNum = jid => (jid || "").replace(/:.*@/, "@").split("@")[0]

// ── Build admin Set from cached metadata ─────────────────────────
function _buildAdminSet(from) {
  const meta = _cache?.[from]
  if (!meta?.participants) return new Set()

  const admins = new Set()
  for (const p of meta.participants) {
    if (p.admin !== "admin" && p.admin !== "superadmin") continue
    admins.add(toNum(p.id))
    // LID participant → also index phone number
    if (p.id?.endsWith("@lid") && p.phoneNumber) {
      admins.add(p.phoneNumber.replace(/\D/g, ""))
    }
    // PN participant → also index lid if present
    if (p.lid) admins.add(toNum(p.lid))
  }
  return admins
}

// ── Is sender an admin? (sync — instant) ─────────────────────────
function isAdmin(sock, from, sender) {
  if (!from?.endsWith("@g.us")) return false
  return _buildAdminSet(from).has(toNum(sender))
}

// ── Is the bot itself an admin? (sync — instant) ─────────────────
function isBotAdmin(sock, from) {
  if (!from?.endsWith("@g.us")) return false
  const botNum = toNum(sock?.user?.id || "")
  return _buildAdminSet(from).has(botNum)
}

// ── Get full admin Set for a group ───────────────────────────────
function getAdmins(from) {
  if (!from?.endsWith("@g.us")) return new Set()
  return _buildAdminSet(from)
}

module.exports = { initAdminCache, isAdmin, isBotAdmin, getAdmins, toNum }
