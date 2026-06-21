// ─────────────────────────────────────────────────────────────────────────────
// lib/greetStore.js  —  CYBER X
//
// Standalone storage, used ONLY by lib/greetListener.js + commands/greetwelcome.js
// + commands/greetgoodbye.js. One JSON file per group, under data/greet/.
// Does not touch welcomeDb.js or any other storage system in this project.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const DATA_DIR = path.join(__dirname, "..", "data", "greet")
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function fileFor(groupId) {
  const safe = String(groupId).replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(DATA_DIR, `${safe}.json`)
}

function load(groupId) {
  const file = fileFor(groupId)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[greetStore] ✗ read ${file}: ${e.message}`)
  }
  return {}
}

function save(groupId, data) {
  const file = fileFor(groupId)
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[greetStore] ✗ write ${file}: ${e.message}`)
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
