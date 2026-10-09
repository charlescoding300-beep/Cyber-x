"use strict"

// ─────────────────────────────────────────────────────────────────────────────
// ZEN X — Local VPS Session Backup
//
// WhatsApp/Baileys session state is already stored locally in:
//   sessions/<phone>/
//
// Redis/Upstash is intentionally NOT used.
//
// This module keeps the old API so index.js and other callers continue to work.
// The local session directory is the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs")
const path = require("path")

const SESS_ROOT = path.join(__dirname, "..", "sessions")

function cleanPhone(phone) {
  return String(phone || "")
    .replace(/\D/g, "")
}

function sessionExists(phone) {
  const clean = cleanPhone(phone)
  if (!clean) return false

  const dir = path.join(SESS_ROOT, clean)

  return (
    fs.existsSync(dir) &&
    fs.statSync(dir).isDirectory()
  )
}

// Local persistence is always available because it is on the VPS filesystem.
const enabled = true

// ─────────────────────────────────────────────────────────────────────────────
// Compatibility push functions
//
// The live Baileys session is already written directly to sessions/<phone>.
// There is nothing to upload anywhere.
// ─────────────────────────────────────────────────────────────────────────────

function schedulePush(phone) {
  const clean = cleanPhone(phone)

  if (!clean) return

  if (!sessionExists(clean)) {
    console.warn(`[BACKUP:${clean}] ⚠ Local session directory does not exist`)
  }
}

async function pushImmediate(phone) {
  const clean = cleanPhone(phone)

  if (!clean) return false

  if (!sessionExists(clean)) {
    console.warn(`[BACKUP:${clean}] ⚠ Local session directory does not exist`)
    return false
  }

  return true
}

async function pushUserNow(phone) {
  return pushImmediate(phone)
}

async function pushAll() {
  if (!fs.existsSync(SESS_ROOT)) {
    return 0
  }

  let count = 0

  for (const entry of fs.readdirSync(SESS_ROOT)) {
    if (entry.startsWith("_")) continue

    const full = path.join(SESS_ROOT, entry)

    try {
      if (
        fs.statSync(full).isDirectory() &&
        sessionExists(entry)
      ) {
        count++
      }
    } catch {}
  }

  console.log(`[BACKUP] ✔ Local VPS sessions available: ${count}`)

  return count
}

async function pushNow() {
  return pushAll()
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE
//
// IMPORTANT:
// Do NOT overwrite existing Baileys authentication files at startup.
// They are already the authoritative local copy.
//
// We only report the sessions that are already present locally.
// ─────────────────────────────────────────────────────────────────────────────

async function restoreAll() {
  if (!fs.existsSync(SESS_ROOT)) {
    console.log("[BACKUP] ℹ Local sessions directory does not exist")
    return 0
  }

  let restored = 0

  for (const entry of fs.readdirSync(SESS_ROOT)) {
    if (entry.startsWith("_")) continue

    const full = path.join(SESS_ROOT, entry)

    try {
      if (
        fs.statSync(full).isDirectory() &&
        sessionExists(entry)
      ) {
        restored++
      }
    } catch {}
  }

  console.log(
    `[BACKUP] ✔ Local VPS session store ready: ${restored} session(s)`
  )

  return restored
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
//
// Removing a real WhatsApp session is handled by index.js/removeSession().
// This function deliberately does NOT delete local auth here because callers
// may use it as a backup cleanup operation.
// ─────────────────────────────────────────────────────────────────────────────

async function deleteSession(phone) {
  const clean = cleanPhone(phone)

  if (!clean) return false

  console.log(
    `[BACKUP:${clean}] ℹ Local session is managed by the main session manager`
  )

  return true
}

module.exports = {
  enabled,
  schedulePush,
  pushImmediate,
  pushUserNow,
  pushAll,
  pushNow,
  restoreAll,
  deleteSession,
}
