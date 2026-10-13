'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_MAX_AGE_MS = 3 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

function cleanupTempFiles(tempDir, options = {}) {
  const directory = path.resolve(tempDir || path.join(process.cwd(), 'temp'))
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : DEFAULT_MAX_AGE_MS
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  let cleaned = 0

  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[CLEANUP] Could not scan temp directory:', error.message)
    return cleaned
  }

  for (const entry of entries) {
    // Only unlink regular files. Never recurse into directories or follow symlinks.
    if (!entry.isFile()) continue
    const filePath = path.join(directory, entry.name)
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || now - stat.mtimeMs <= maxAgeMs) continue
      fs.unlinkSync(filePath)
      cleaned++
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[CLEANUP] Could not remove temp file:', error.message)
    }
  }

  if (cleaned) console.log(`[CLEANUP] Removed ${cleaned} stale temp file(s)`)
  return cleaned
}

function startTempCleanup(tempDir, options = {}) {
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : DEFAULT_MAX_AGE_MS
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : CLEANUP_INTERVAL_MS
  cleanupTempFiles(tempDir, { maxAgeMs })
  const timer = setInterval(() => cleanupTempFiles(tempDir, { maxAgeMs }), intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

module.exports = { cleanupTempFiles, startTempCleanup }
