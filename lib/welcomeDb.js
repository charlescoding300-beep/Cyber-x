// ─────────────────────────────────────────────────────────────────────────────
// lib/welcomeDb.js  —  CYBER X
//
// Per-group JSON persistence for welcome/goodbye settings, one file per group
// at data/welcome/<groupId>.json — same pattern as lib/settings.js's
// data/users/<phone>.json.
//
// Sync API (no await needed), matching how commands/welcome.js and
// commands/goodbye.js already call it:
//
//   welcomeDb.get(from, "welcome", false)
//   welcomeDb.set(from, "welcomeText", "...")
//
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const DATA_DIR = path.join(__dirname, "..", "data", "welcome")
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

// Sanitize group JID into a safe filename (strip @g.us etc, keep digits/dashes)
function fileFor(groupId) {
  const safe = String(groupId).replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(DATA_DIR, `${safe}.json`)
}

// In-memory cache so repeated get() calls in the same tick don't re-read disk
const cache = new Map()

function load(groupId) {
  if (cache.has(groupId)) return cache.get(groupId)
  const file = fileFor(groupId)
  let data = {}
  try {
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[welcomeDb] ✗ failed to read ${file}: ${e.message}`)
    data = {}
  }
  cache.set(groupId, data)
  return data
}

function save(groupId, data) {
  const file = fileFor(groupId)
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
    cache.set(groupId, data)
  } catch (e) {
    console.error(`[welcomeDb] ✗ failed to write ${file}: ${e.message}`)
  }
}

function get(groupId, key, defaultValue) {
  const data = load(groupId)
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaultValue
}

function set(groupId, key, value) {
  const data = load(groupId)
  data[key] = value
  save(groupId, data)
}

module.exports = { get, set }
