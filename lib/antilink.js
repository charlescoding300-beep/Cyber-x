// ─────────────────────────────────────────
//   lib/antilink.js — CYBER X Antilink Library
// ─────────────────────────────────────────

const antilinkSettings = new Map() // groupId -> { enabled, action, warnings }
const warnCount = new Map()        // "groupId:userId" -> number

// ───────── URL / LINK DETECTION ─────────
const linkRegex = /(?:https?:\/\/|www\.|chat\.whatsapp\.com|t\.me\/|wa\.me\/|bit\.ly\/|tinyurl\.com\/|youtu\.be\/|discord\.gg\/)[^\s]*/gi

function containsLink(text) {
  if (!text) return false
  return linkRegex.test(text)
}

// ───────── GROUP SETTINGS ─────────
function enableAntilink(groupId, action = "delete") {
  antilinkSettings.set(groupId, {
    enabled: true,
    action, // "delete" | "warn" | "kick"
  })
}

function disableAntilink(groupId) {
  antilinkSettings.set(groupId, { enabled: false, action: "delete" })
}

function isAntilinkEnabled(groupId) {
  const setting = antilinkSettings.get(groupId)
  return setting?.enabled === true
}

function getAction(groupId) {
  return antilinkSettings.get(groupId)?.action || "delete"
}

// ───────── WARNING SYSTEM ─────────
function addWarning(groupId, userId) {
  const key = `${groupId}:${userId}`
  const current = warnCount.get(key) || 0
  warnCount.set(key, current + 1)
  return current + 1
}

function getWarnings(groupId, userId) {
  return warnCount.get(`${groupId}:${userId}`) || 0
}

function resetWarnings(groupId, userId) {
  warnCount.delete(`${groupId}:${userId}`)
}

module.exports = {
  containsLink,
  enableAntilink,
  disableAntilink,
  isAntilinkEnabled,
  getAction,
  addWarning,
  getWarnings,
  resetWarnings,
}
