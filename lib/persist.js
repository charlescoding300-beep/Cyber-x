"use strict"
const fs = require("fs")
const path = require("path")
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const DATA_DIR = path.join(__dirname, "..", "data")
const REDIS_KEY = "cyberx:data:backup"

async function redisSet(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) return false
  const https = require("https")
  const body = JSON.stringify(["SET", key, value])
  return new Promise((resolve) => {
    const url = new URL(REDIS_URL)
    const req = https.request({ hostname: url.hostname, path: "/pipeline", method: "POST", headers: { "Authorization": `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, res => { res.resume(); resolve(res.statusCode === 200) })
    req.on("error", () => resolve(false))
    req.write(body); req.end()
  })
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null
  const https = require("https")
  return new Promise((resolve) => {
    const url = new URL(REDIS_URL)
    const req = https.request({ hostname: url.hostname, path: `/get/${encodeURIComponent(key)}`, method: "GET", headers: { "Authorization": `Bearer ${REDIS_TOKEN}` } }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)?.result || null) } catch { resolve(null) } }) })
    req.on("error", () => resolve(null)); req.end()
  })
}

function scanDataDir(dir, base = DATA_DIR) {
  const result = {}
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(base, fullPath)
    if (entry.isDirectory()) Object.assign(result, scanDataDir(fullPath, base))
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      try { result[relPath] = JSON.parse(fs.readFileSync(fullPath, "utf8")) } catch {}
    }
  }
  return result
}

async function pushAllData() {
  if (!REDIS_URL || !REDIS_TOKEN) { console.log("[PERSIST] ⚠ Redis not configured"); return false }
  try {
    const snapshot = scanDataDir(DATA_DIR)
    const keys = Object.keys(snapshot)
    if (!keys.length) { console.log("[PERSIST] ℹ No data files found"); return true }
    const ok = await redisSet(REDIS_KEY, JSON.stringify(snapshot))
    console.log(ok ? `[PERSIST] ✅ Pushed ${keys.length} file(s) to Redis` : "[PERSIST] ✗ Push failed")
    return ok
  } catch (e) { console.error("[PERSIST] ✗", e.message); return false }
}

async function restoreAllData() {
  if (!REDIS_URL || !REDIS_TOKEN) { console.log("[PERSIST] ⚠ Redis not configured"); return { restored: 0, skipped: 0 } }
  try {
    const raw = await redisGet(REDIS_KEY)
    if (!raw) { console.log("[PERSIST] ℹ No backup found in Redis"); return { restored: 0, skipped: 0 } }
    const snapshot = JSON.parse(raw)
    let restored = 0, skipped = 0
    for (const [relPath, data] of Object.entries(snapshot)) {
      const fullPath = path.join(DATA_DIR, relPath)
      try { fs.mkdirSync(path.dirname(fullPath), { recursive: true }); fs.writeFileSync(fullPath, JSON.stringify(data, null, 2)); restored++ }
      catch { skipped++ }
    }
    console.log(`[PERSIST] ✅ Restored ${restored} file(s) (${skipped} failed)`)
    return { restored, skipped }
  } catch (e) { console.error("[PERSIST] ✗", e.message); return { restored: 0, skipped: 0 } }
}

let saveTimer = null
function startAutoSave(intervalMs = 60000) {
  if (!fs.existsSync(DATA_DIR)) return
  pushAllData()
  fs.watch(DATA_DIR, { recursive: true }, (event, filename) => {
    if (!filename || !filename.endsWith(".json")) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { console.log(`[PERSIST] 🔄 ${filename} changed — pushing...`); pushAllData() }, 3000)
  })
  setInterval(pushAllData, intervalMs)
  console.log(`[PERSIST] 💾 Persistence engine active`)
}

module.exports = { pushAllData, restoreAllData, startAutoSave }
