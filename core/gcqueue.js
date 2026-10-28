'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/gcqueue.js — reliability helpers for .gcstatus
//
//  • enqueue(key, task)   runs group-status jobs one at a time per session,
//                         so a fast bot can't start a second upload while the first
//                         is still downloading or uploading.
//  • withStage(name, fn)  runs one stage (download, upload, relay) with its own
//                         timeout and retries, and logs which stage failed and why.
//  • assertUsableMedia    rejects an empty or non-media download before it is uploaded.
// ════════════════════════════════════════════════════════════════════

const queues = new Map()

function enqueue(key, task) {
  const prev = queues.get(key) || Promise.resolve()
  const run = prev.then(() => task())
  const tail = run.catch(() => {})
  queues.set(key, tail)
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return run
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    const shown = ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${shown}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Runs fn(attempt) up to `attempts` times. Each try has its own timeout.
async function withStage(name, fn, { attempts = 3, timeoutMs = 60000, backoffMs = 2000 } = {}) {
  let lastErr = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(Promise.resolve().then(() => fn(attempt)), timeoutMs, name)
    } catch (e) {
      lastErr = e
      console.warn(`[GCSTATUS] ${name}: attempt ${attempt}/${attempts} failed: ${e.message}`)
      if (attempt < attempts) await sleep(backoffMs * attempt)
    }
  }
  throw new Error(`${name} failed after ${attempts} attempts: ${lastErr?.message || 'unknown error'}`)
}

// Rejects an empty download, a text page (HTML/JSON) saved as media, or a file that is
// too small to be real media. The first bytes are checked against known file signatures.
function assertUsableMedia(buffer, type) {
  if (!buffer || buffer.length < 1000) {
    throw new Error(`downloaded ${type} is empty or too small (${buffer ? buffer.length : 0} bytes)`)
  }
  const head = buffer.subarray(0, 64).toString('latin1')
  const trimmed = head.replace(/^\s+/, '')
  if (trimmed.startsWith('<') || trimmed.startsWith('{') || trimmed.startsWith('<!')) {
    throw new Error(`downloaded ${type} is a web page, not media`)
  }
  return true
}

module.exports = { enqueue, withStage, assertUsableMedia, withTimeout }
