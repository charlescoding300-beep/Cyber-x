'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/sessionexec.js  —  ZEN X  |  Per-session command executors
//
//  EVERY WhatsApp session gets its OWN executor (stored on state.executor).
//  Nothing is shared between sessions: one user flooding commands, running
//  heavy downloads, or hanging a command can never slow another user's bot.
//
//  Each executor has two independent lanes:
//    • LIGHT lane — normal commands, high concurrency
//    • HEAVY lane — ffmpeg / yt-dlp / image-processing commands, low
//                   concurrency, so they can never block quick commands
//
//  Per executor you also get:
//    • owner priority        — owner commands jump the queue
//    • sender cooldown       — stops one person spamming (owner exempt)
//    • queue cap             — "server busy" instead of unbounded memory growth
//    • hard timeout          — a hung command frees its slot
//    • live stats            — queue depth, avg/max runtime, failures
//
//  TUNING (all optional, via .env):
//    EXEC_LIGHT_CONCURRENCY   default max(6, cpus*2)
//    EXEC_HEAVY_CONCURRENCY   default 2 per session
//    EXEC_GLOBAL_HEAVY_CONCURRENCY default half of available CPUs across sessions
//    EXEC_MAX_QUEUE           default 100 (per lane)
//    EXEC_SENDER_COOLDOWN_MS  default 0 = no cooldown (set e.g. 300 to throttle spammers)
//    EXEC_TIMEOUT_MS          default 120000
//    EXEC_HEAVY_TIMEOUT_MS    default 300000
//    EXEC_HEAVY_COMMANDS      extra heavy command names, comma separated
// ════════════════════════════════════════════════════════════════════

const cpuCount = (require('os').cpus() || []).length || 2

function envInt(name, def) {
  const v = parseInt(process.env[name], 10)
  return Number.isFinite(v) ? v : def
}

const CFG = {
  lightConcurrency: envInt('EXEC_LIGHT_CONCURRENCY', Math.max(6, cpuCount * 2)),
  heavyConcurrency: envInt('EXEC_HEAVY_CONCURRENCY', 2),
  maxQueue:         envInt('EXEC_MAX_QUEUE', 100),
  cooldownMs:       envInt('EXEC_SENDER_COOLDOWN_MS', 0),
  timeoutMs:        envInt('EXEC_TIMEOUT_MS', 120000),
  heavyTimeoutMs:   envInt('EXEC_HEAVY_TIMEOUT_MS', 300000),
  noticeGapMs:      10000,   // min gap between "busy" notices to the same sender
}

const DEFAULT_HEAVY = [
  'play', 'song', 'ytplay', 'ytmp3', 'ytmp4', 'video', 'yt', 'ytv',
  's', 'sticker', 'toimg', 'tovideo', 'togif', 'convert', 'tovid',
  'removebg', 'remini', 'upscale', 'blur',
  'wasted', 'waste', 'gta', 'gtawasted',
]

const GLOBAL_HEAVY_MAX = envInt('EXEC_GLOBAL_HEAVY_CONCURRENCY', Math.max(1, Math.floor(cpuCount / 2)))
let globalHeavyActive = 0
const globalHeavyWaiters = new Set()

function pumpGlobalHeavy() {
  if (globalHeavyActive >= GLOBAL_HEAVY_MAX || !globalHeavyWaiters.size) return
  const waiting = [...globalHeavyWaiters]
  globalHeavyWaiters.clear()
  for (const executor of waiting) {
    if (globalHeavyActive >= GLOBAL_HEAVY_MAX) {
      globalHeavyWaiters.add(executor)
      continue
    }
    executor._pump(executor.heavy)
  }
}

const HEAVY = new Set([
  ...DEFAULT_HEAVY,
  ...String(process.env.EXEC_HEAVY_COMMANDS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
])

function makeLane(max) {
  return { max, active: 0, high: [], normal: [] }
}

class SessionExecutor {
  constructor(phone) {
    this.phone     = phone
    this.closed    = false
    this.light     = makeLane(CFG.lightConcurrency)
    this.heavy     = makeLane(CFG.heavyConcurrency)
    this.lastRun   = new Map()   // sender -> last accepted timestamp (cooldown)
    this.lastNote  = new Map()   // sender -> last "busy" notice timestamp
    this.stats     = { executed: 0, failed: 0, timedOut: 0, dropped: 0, totalMs: 0, maxMs: 0, lastAt: 0 }
  }

  // task = { name, chat, sender, isOwner, heavy, fn, onDrop, skipCooldown }
  // Resolves with fn()'s result. Rejects ONLY if fn() throws.
  // Dropped / timed-out tasks resolve (undefined) and call onDrop(reason).
  submit(task) {
    return new Promise((resolve, reject) => {
      if (this.closed) return resolve(undefined)

      const name   = String(task.name || '').toLowerCase()
      const sender = task.sender || task.chat || 'unknown'
      const now    = Date.now()

      // Sender cooldown (owner + retries exempt)
      if (!task.isOwner && !task.skipCooldown && CFG.cooldownMs > 0) {
        const last = this.lastRun.get(sender) || 0
        if (now - last < CFG.cooldownMs) return this._drop(task, 'cooldown', resolve)
        this.lastRun.set(sender, now)
        if (this.lastRun.size > 500) this._purge(this.lastRun, 60000)
      }

      const lane = (task.heavy === true || HEAVY.has(name)) ? this.heavy : this.light

      if (lane.high.length + lane.normal.length >= CFG.maxQueue) {
        return this._drop(task, 'queue_full', resolve)
      }

      const job = { task, name, resolve, reject, heavy: lane === this.heavy }
      ;(task.isOwner ? lane.high : lane.normal).push(job)
      this._pump(lane)
    })
  }

  _drop(task, reason, resolve) {
    this.stats.dropped++
    if (typeof task.onDrop === 'function') {
      // throttle repeated notices to the same sender
      const key  = task.sender || task.chat || 'unknown'
      const now  = Date.now()
      const gap  = reason === 'cooldown' ? 0 : CFG.noticeGapMs
      const last = this.lastNote.get(key + ':' + reason) || 0
      if (now - last >= gap) {
        this.lastNote.set(key + ':' + reason, now)
        if (this.lastNote.size > 500) this._purge(this.lastNote, 60000)
        try { task.onDrop(reason) } catch {}
      }
    }
    resolve(undefined)
  }

  _purge(map, maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs
    for (const [k, t] of map) if (t < cutoff) map.delete(k)
  }

  _pump(lane) {
    while (lane.active < lane.max) {
      const job = lane.high.shift() || lane.normal.shift()
      if (!job) break
      if (lane === this.heavy && globalHeavyActive >= GLOBAL_HEAVY_MAX) {
        ;(job.task.isOwner ? lane.high : lane.normal).unshift(job)
        globalHeavyWaiters.add(this)
        break
      }
      if (lane === this.heavy) globalHeavyActive++
      this._run(lane, job)
    }
  }

  _run(lane, job) {
    lane.active++
    const t0        = Date.now()
    const timeoutMs = job.heavy ? CFG.heavyTimeoutMs : CFG.timeoutMs
    let settled     = false
    let timer       = null

    const finish = (err, value, timedOut) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      lane.active--
      if (job.heavy) {
        globalHeavyActive = Math.max(0, globalHeavyActive - 1)
        globalHeavyWaiters.add(this)
      }

      const ms = Date.now() - t0
      this.stats.lastAt  = Date.now()
      this.stats.totalMs += ms
      if (ms > this.stats.maxMs) this.stats.maxMs = ms

      if (timedOut) {
        this.stats.timedOut++
        if (typeof job.task.onDrop === 'function') { try { job.task.onDrop('timeout') } catch {} }
        job.resolve(undefined)
      } else if (err) {
        this.stats.failed++
        job.reject(err)
      } else {
        this.stats.executed++
        job.resolve(value)
      }

      if (job.heavy) pumpGlobalHeavy()
      else this._pump(lane)
    }

    timer = setTimeout(() => finish(null, undefined, true), timeoutMs)

    let p
    try { p = Promise.resolve(job.task.fn()) } catch (e) { p = Promise.reject(e) }
    p.then(v => finish(null, v, false), e => finish(e || new Error('command failed'), undefined, false))
  }

  snapshot() {
    const done = this.stats.executed + this.stats.failed
    return {
      phone:   this.phone,
      light:   { active: this.light.active, queued: this.light.high.length + this.light.normal.length, max: this.light.max },
      heavy:   { active: this.heavy.active, queued: this.heavy.high.length + this.heavy.normal.length, max: this.heavy.max },
      executed: this.stats.executed,
      failed:   this.stats.failed,
      timedOut: this.stats.timedOut,
      dropped:  this.stats.dropped,
      avgMs:    done ? Math.round(this.stats.totalMs / done) : 0,
      maxMs:    this.stats.maxMs,
    }
  }

  shutdown() {
    this.closed = true
    for (const lane of [this.light, this.heavy]) {
      for (const job of [...lane.high, ...lane.normal]) job.resolve(undefined)
      lane.high.length = 0
      lane.normal.length = 0
    }
    globalHeavyWaiters.delete(this)
    this.lastRun.clear()
    this.lastNote.clear()
  }
}

// One executor per session state — created on first use, lives on the state object
function forState(state) {
  if (!state.executor) state.executor = new SessionExecutor(state.phone)
  return state.executor
}

function heavyStats() {
  return { active: globalHeavyActive, max: GLOBAL_HEAVY_MAX, waitingSessions: globalHeavyWaiters.size }
}

function statsAll(sessions) {
  const out = []
  for (const [, state] of sessions) {
    if (state?.executor) out.push(state.executor.snapshot())
  }
  return out
}

module.exports = { SessionExecutor, forState, statsAll, heavyStats, CFG, HEAVY }
