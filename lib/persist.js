"use strict"

const fs = require("fs")
const path = require("path")
const persistence = require("../database/persistence")

const DATA_DIR = path.join(__dirname, "..", "data")
const BACKUP_NAMESPACE = "json_file_backup"

function scanDataDir(dir = DATA_DIR, base = DATA_DIR, result = {}) {
  if (!fs.existsSync(dir)) return result

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDataDir(fullPath, base, result)
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      try {
        const relativePath = path.relative(base, fullPath).split(path.sep).join("/")
        result[relativePath] = JSON.parse(fs.readFileSync(fullPath, "utf8"))
      } catch (e) {
        console.error(`[PERSIST] Could not snapshot ${fullPath}:`, e.message)
      }
    }
  }

  return result
}

async function pushAllData() {
  try {
    const snapshot = scanDataDir()
    const keys = new Set(Object.keys(snapshot))
    const previous = persistence.list(BACKUP_NAMESPACE)

    persistence.transaction(() => {
      for (const [relativePath, data] of Object.entries(snapshot)) {
        persistence.set(BACKUP_NAMESPACE, relativePath, data)
      }
      for (const row of previous) {
        if (!keys.has(row.data_key)) persistence.remove(BACKUP_NAMESPACE, row.data_key)
      }
    })

    return true
  } catch (e) {
    console.error("[PERSIST] SQLite snapshot save failed:", e.message)
    return false
  }
}

function resolveBackupPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) return null
  const root = path.resolve(DATA_DIR)
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null
  return target
}

async function restoreAllData() {
  let restored = 0
  let skipped = 0

  try {
    for (const row of persistence.list(BACKUP_NAMESPACE)) {
      const target = resolveBackupPath(row.data_key)
      if (!target) {
        skipped++
        continue
      }

      try {
        const data = JSON.parse(row.data)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, JSON.stringify(data, null, 2), "utf8")
        restored++
      } catch (e) {
        skipped++
        console.error(`[PERSIST] SQLite restore failed for ${row.data_key}:`, e.message)
      }
    }
  } catch (e) {
    console.error("[PERSIST] SQLite snapshot read failed:", e.message)
    return { restored, skipped: skipped + 1 }
  }

  console.log(`[PERSIST] ✔ Local SQLite snapshot restored (${restored} file(s); ${skipped} skipped)`)
  return { restored, skipped }
}

let started = false
let saveTimer = null
let intervalTimer = null
let watcher = null

function startAutoSave(intervalMs = 60000) {
  if (started) return
  started = true
  fs.mkdirSync(DATA_DIR, { recursive: true })

  pushAllData()
  intervalTimer = setInterval(() => { pushAllData() }, Math.max(10000, intervalMs))
  intervalTimer.unref?.()

  try {
    watcher = fs.watch(DATA_DIR, { recursive: true }, (_, filename) => {
      if (!filename || !String(filename).endsWith(".json")) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { pushAllData() }, 1000)
      saveTimer.unref?.()
    })
    watcher.unref?.()
  } catch (e) {
    console.warn("[PERSIST] File watcher unavailable; periodic SQLite snapshots remain active:", e.message)
  }

  console.log("[PERSIST] 💾 Local SQLite snapshot backup active")
}

module.exports = { pushAllData, restoreAllData, startAutoSave }
