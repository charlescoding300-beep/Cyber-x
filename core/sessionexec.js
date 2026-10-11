'use strict'

const DEFAULTS = Object.freeze({
  maxQueue: 60,
  cooldownMs: 700,
  timeoutMs: 120000,
})

const HEAVY = new Set([
  'play', 'song', 'video', 'ytmp3', 'ytmp4',
  'sticker', 'toimg', 'tomp4', 'anime', 'wasted',
  'gcstatus', 'backup', 'restore',
])

class SessionExecutor {
  constructor(phone = 'unknown') {
    this.phone = phone
    this.queue = []
    this.running = false
    this.closed = false
    this.cooldowns = new Map()
    this.stats = {
      submitted: 0,
      completed: 0,
      failed: 0,
      dropped: 0,
      timedOut: 0,
      queued: 0,
      active: 0,
    }
  }

  submit(task = {}) {
    if (this.closed) {
      this.stats.dropped++
      task.onDrop?.('shutdown')
      return Promise.resolve(false)
    }

    if (typeof task.fn !== 'function') {
      return Promise.reject(new TypeError('Executor task requires fn'))
    }

    const sender = String(task.sender || task.chat || 'unknown')
    const name = String(task.name || 'command').toLowerCase()
    const key = sender + ':' + name
    const now = Date.now()

    if (!task.isOwner && !task.skipCooldown) {
      const last = this.cooldowns.get(key) || 0
      if (now - last < DEFAULTS.cooldownMs) {
        this.stats.dropped++
        task.onDrop?.('cooldown')
        return Promise.resolve(false)
      }
      this.cooldowns.set(key, now)
    }

    if (this.queue.length >= DEFAULTS.maxQueue) {
      this.stats.dropped++
      task.onDrop?.('queue_full')
      return Promise.resolve(false)
    }

    this.stats.submitted++

    return new Promise((resolve, reject) => {
      const item = {
        ...task,
        resolve,
        reject,
        enqueuedAt: now,
        priority: task.isOwner ? 0 : (HEAVY.has(name) ? 2 : 1),
      }

      // Owner commands first; otherwise preserve order within the same priority.
      const index = this.queue.findIndex(x => x.priority > item.priority)
      if (index < 0) this.queue.push(item)
      else this.queue.splice(index, 0, item)

      this.stats.queued = this.queue.length
      this._drain()
    })
  }

  async _drain() {
    if (this.running || this.closed) return
    const item = this.queue.shift()
    this.stats.queued = this.queue.length
    if (!item) return

    this.running = true
    this.stats.active = 1
    let timer
    let timedOut = false

    // A timeout reports the problem but does not pretend to cancel JavaScript
    // or network work that the command itself cannot cancel.
    const work = Promise.resolve().then(item.fn)
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        this.stats.timedOut++
        try { item.onDrop?.('timeout') } catch {}
        reject(new Error('Command exceeded executor timeout; underlying work may continue'))
      }, DEFAULTS.timeoutMs)
    })

    try {
      const result = await Promise.race([work, timeout])
      this.stats.completed++
      item.resolve(result)
    } catch (err) {
      this.stats.failed++
      item.reject(err)
    } finally {
      clearTimeout(timer)

      // Do not run another command concurrently if a timed-out task is still
      // executing. This prevents a timeout from silently multiplying work.
      if (timedOut) {
        work.catch(() => {}).finally(() => {
          this.running = false
          this.stats.active = 0
          this._drain()
        })
      } else {
        this.running = false
        this.stats.active = 0
        this._drain()
      }
    }
  }

  shutdown() {
    this.closed = true
    for (const item of this.queue.splice(0)) {
      this.stats.dropped++
      try { item.onDrop?.('shutdown') } catch {}
      item.resolve(false)
    }
    this.stats.queued = 0
  }

  snapshot() {
    return {
      phone: this.phone,
      ...this.stats,
      queued: this.queue.length,
      active: this.running ? 1 : 0,
      closed: this.closed,
    }
  }
}

const executors = new WeakMap()
const allExecutors = new Set()

function forState(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    throw new TypeError('forState requires a session state object')
  }

  let executor = executors.get(state)
  if (!executor) {
    executor = new SessionExecutor(state.phone || state.id || 'unknown')
    executors.set(state, executor)
    allExecutors.add(executor)
    state.executor = executor
  }
  return executor
}

function statsAll(sessions) {
  const rows = []
  if (sessions && typeof sessions[Symbol.iterator] === 'function') {
    for (const state of sessions) {
      const executor = state && typeof state === 'object'
        ? executors.get(state)
        : null
      if (executor) rows.push(executor.snapshot())
    }
  }

  // Include executors even if the caller's session collection has another shape.
  if (!rows.length) {
    for (const executor of allExecutors) rows.push(executor.snapshot())
  }
  return rows
}

module.exports = { SessionExecutor, forState, statsAll, CFG: DEFAULTS, HEAVY }
