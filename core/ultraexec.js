// ULTRA EXECUTOR + WATCHDOG
"use strict"

const fs = require("fs")
const path = require("path")

const int = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : d
}

const cfg = () => ({
  watchdogMs: int(process.env.ULTRA_WATCHDOG_MS, 20000),
  stuckMs: int(process.env.ULTRA_STUCK_MS, 90000),
  cooldownMs: int(process.env.ULTRA_REVIVE_COOLDOWN_MS, 120000),
  cmdTimeout: int(process.env.CMD_TIMEOUT_MS, 120000),
  slowMs: int(process.env.SLOW_CMD_MS, 3000),
  lagWarnMs: int(process.env.LAG_WARN_MS, 400),
  prewarm: process.env.PREWARM_GROUPS !== "0",
})

function ensure(state) {
  if (!state.__ultra) {
    state.__ultra = {
      cmds: 0,
      errors: 0,
      timeouts: 0,
      slow: 0,
      totalMs: 0,
      maxMs: 0,
      lastCmdAt: 0,
      lastEventAt: 0,
      lastOpenAt: 0,
      lastCloseAt: 0,
      openSince: 0,
      notConnectedSince: 0,
      deadTicks: 0,
      revives: 0,
      lastRevive: 0,
    }
  }

  return state.__ultra
}

const TIMED_OUT = Symbol("timed-out")

async function guardCommand(state, sock, from, msg, rawCmd, run) {
  const w = ensure(state)
  const c = cfg()
  const t0 = Date.now()

  w.cmds++
  w.lastCmdAt = t0

  const p = Promise.resolve().then(run)
  p.catch(() => {})

  let timer = null
  let result

  try {
    if (c.cmdTimeout > 0) {
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve(TIMED_OUT), c.cmdTimeout)
      })

      result = await Promise.race([p, timeout])
    } else {
      result = await p
    }
  } catch (e) {
    w.errors++
    throw e
  } finally {
    if (timer) clearTimeout(timer)

    const dt = Date.now() - t0

    w.totalMs += dt
    if (dt > w.maxMs) w.maxMs = dt

    if (dt >= c.slowMs && result !== TIMED_OUT) {
      w.slow++
      console.warn(`[ULTRA:${state.phone}] 🐢 .${rawCmd} took ${dt}ms`)
    }
  }

  if (result === TIMED_OUT) {
    w.timeouts++

    console.error(
      `[WATCHDOG:${state.phone}] ⏱ .${rawCmd} still running after ` +
      `${c.cmdTimeout}ms — released (not retried)`
    )

    try {
      await sock.sendMessage(
        from,
        {
          text: `⏱️ *${rawCmd}* is taking too long and was released. Try again.`,
        },
        { quoted: msg }
      )
    } catch {}

    return undefined
  }

  return result
}

const presenceBusy = new Map()
const PRESENCE_MAX_MS = 70 * 1000

function firePresence(state, from, fn) {
  const key = `${state.phone}:${from}`
  const now = Date.now()
  const until = presenceBusy.get(key)

  if (until && until > now) return

  presenceBusy.set(key, now + PRESENCE_MAX_MS)

  setImmediate(() => {
    Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() => presenceBusy.delete(key))
  })
}

const refreshing = new Set()

function refreshGroup(state, sock, jid) {
  if (!state.groupCache) state.groupCache = {}

  const key = `${state.phone}:${jid}`

  if (refreshing.has(key)) return

  refreshing.add(key)

  Promise.resolve()
    .then(() => sock.groupMetadata(jid))
    .then(meta => {
      if (meta) {
        state.groupCache[jid] = {
          ...meta,
          _cachedAt: Date.now(),
        }
      }
    })
    .catch(() => {})
    .finally(() => refreshing.delete(key))
}

function schedulePrewarm(state, sock) {
  if (!cfg().prewarm) return

  const delay = 1500 + Math.floor(Math.random() * 8000)

  const t = setTimeout(async () => {
    if (!state.connected || state.sock !== sock) return

    try {
      const groups = await sock.groupFetchAllParticipating()
      let n = 0

      if (!state.groupCache) state.groupCache = {}

      for (const [id, g] of Object.entries(groups || {})) {
        const prev = state.groupCache[id]

        if (
          !prev ||
          Date.now() - (prev._cachedAt || 0) > 60 * 1000
        ) {
          state.groupCache[id] = {
            ...g,
            _cachedAt: Date.now(),
          }

          n++
        }
      }

      console.log(
        `[ULTRA:${state.phone}] ⚡ Pre-warmed ${n} group(s)`
      )
    } catch (e) {
      console.warn(
        `[ULTRA:${state.phone}] pre-warm skipped: ${e.message}`
      )
    }
  }, delay)

  t.unref?.()
}

const STALE_EVENTS = [
  "connection.update",
  "messages.upsert",
  "messages.update",
  "messages.reaction",
  "call",
  "group-participants.update",
  "groups.upsert",
  "groups.update",
]

function detach(sock) {
  for (const ev of STALE_EVENTS) {
    try {
      sock.ev.removeAllListeners(ev)
    } catch {}
  }
}

function attachSession(state, sock) {
  const w = ensure(state)

  const prev = state.__ultraSock

  if (prev && prev !== sock) {
    detach(prev)
  }

  state.__ultraSock = sock

  sock.ev.on("connection.update", u => {
    const now = Date.now()

    w.lastEventAt = now

    if (u.connection === "open") {
      w.lastOpenAt = now
      w.openSince = now
      w.notConnectedSince = 0
      w.deadTicks = 0

      schedulePrewarm(state, sock)
    } else if (u.connection === "close") {
      w.lastCloseAt = now
      w.openSince = 0
    }
  })

  sock.ev.on("messages.upsert", () => {
    w.lastEventAt = Date.now()
  })
}

let ctx = null

const loop = {
  lag: 0,
  max: 0,
  lastWarn: 0,
}

function isWsOpen(sock) {
  const ws = sock?.ws

  if (!ws) return true

  if (typeof ws.isOpen === "boolean") {
    return ws.isOpen
  }

  if (typeof ws.readyState === "number") {
    return ws.readyState === 1
  }

  return true
}

function isRegistered(state) {
  if (state.sock?.authState?.creds?.registered) {
    return true
  }

  try {
    return !!(
      state.sessDir &&
      fs.existsSync(path.join(state.sessDir, "creds.json"))
    )
  } catch {
    return false
  }
}

function revive(phone, state, reason) {
  const w = ensure(state)
  const now = Date.now()

  w.revives++
  w.lastRevive = now
  w.notConnectedSince = now
  w.deadTicks = 0

  ctx.revives++

  console.warn(
    `[WATCHDOG:${phone}] ♻ reviving session — ${reason}`
  )

  const old = state.sock

  if (old) {
    detach(old)

    try {
      old.end(undefined)
    } catch {}

    try {
      old.ws?.close?.()
    } catch {}
  }

  state.connected = false
  state.startingUp = false

  Promise.resolve()
    .then(() => ctx.startBot(phone))
    .catch(e => {
      console.error(
        `[WATCHDOG:${phone}] revive failed:`,
        e?.message || e
      )
    })
}

function checkSession(phone, state) {
  const w = ensure(state)
  const c = cfg()
  const now = Date.now()

  if (!isRegistered(state)) {
    w.notConnectedSince = 0
    return
  }

  if (state.connected) {
    w.notConnectedSince = 0

    if (
      w.openSince &&
      now - w.openSince > 5 * 60 * 1000
    ) {
      w.revives = 0
    }

    if (!isWsOpen(state.sock)) {
      w.deadTicks++

      if (w.deadTicks >= 2) {
        revive(
          phone,
          state,
          "socket reports connected but websocket is closed"
        )
      }
    } else {
      w.deadTicks = 0
    }

    return
  }

  if (!w.notConnectedSince) {
    w.notConnectedSince = now
    return
  }

  if (now - w.notConnectedSince < c.stuckMs) {
    return
  }

  const backoff =
    c.cooldownMs *
    Math.min(
      2 ** Math.max(0, w.revives - 1),
      8
    )

  if (
    w.lastRevive &&
    now - w.lastRevive < backoff
  ) {
    return
  }

  const secs = Math.round(
    (now - w.notConnectedSince) / 1000
  )

  revive(
    phone,
    state,
    `offline for ${secs}s${state.startingUp ? " (stuck in 'starting up')" : ""}`
  )
}

function tick() {
  ctx.ticks++

  for (const [phone, state] of ctx.sessions) {
    try {
      checkSession(phone, state)
    } catch (e) {
      console.error(
        `[WATCHDOG:${phone}] check error:`,
        e.message
      )
    }
  }

  if (typeof ctx.ensureCommands === "function") {
    try {
      ctx.ensureCommands()
    } catch {}
  }

  if (ctx.ticks % 30 === 0) {
    loop.max = loop.lag
  }
}

function startLagMonitor() {
  const step = 100
  let last = Date.now()

  const t = setInterval(() => {
    const now = Date.now()

    const lag = Math.max(
      0,
      now - last - step
    )

    last = now
    loop.lag = lag

    if (lag > loop.max) {
      loop.max = lag
    }

    if (
      lag >= cfg().lagWarnMs &&
      now - loop.lastWarn > 15000
    ) {
      loop.lastWarn = now

      console.warn(
        `[ULTRA] ⚠ event loop blocked for ${lag}ms — ` +
        `something synchronous is hogging the CPU`
      )
    }
  }, step)

  t.unref?.()
}

function startWatchdog(opts) {
  if (ctx) {
    ctx.sessions = opts.sessions || ctx.sessions
    return ctx
  }

  const c = cfg()

  ctx = {
    sessions: opts.sessions,
    startBot: opts.startBot,
    ensureCommands: opts.ensureCommands,
    ticks: 0,
    revives: 0,
    startedAt: Date.now(),
    intervalMs: opts.intervalMs || c.watchdogMs,
  }

  ctx.timer = setInterval(() => {
    try {
      tick()
    } catch (e) {
      console.error(
        "[WATCHDOG] tick error:",
        e.message
      )
    }
  }, ctx.intervalMs)

  ctx.timer.unref?.()

  startLagMonitor()

  global.__ultraStatus = status

  console.log(
    `[WATCHDOG] ✔ ACTIVE — guarding every session ` +
    `(current + future) every ${Math.round(ctx.intervalMs / 1000)}s | ` +
    `revive after ${Math.round(c.stuckMs / 1000)}s offline | ` +
    `command timeout ${c.cmdTimeout ? Math.round(c.cmdTimeout / 1000) + "s" : "off"}`
  )

  return ctx
}

function status(phone) {
  const now = Date.now()

  const out = {
    running: !!ctx,
    intervalMs: ctx?.intervalMs || 0,
    uptimeS: ctx
      ? Math.round((now - ctx.startedAt) / 1000)
      : 0,
    ticks: ctx?.ticks || 0,
    revivesTotal: ctx?.revives || 0,
    loop: {
      lagMs: loop.lag,
      maxMs: loop.max,
    },
    sessionsTotal: 0,
    sessionsOnline: 0,
    session: null,
  }

  if (!ctx) return out

  for (const [p, st] of ctx.sessions) {
    out.sessionsTotal++

    if (st.connected) {
      out.sessionsOnline++
    }

    if (phone && p === phone) {
      const w = ensure(st)

      out.session = {
        connected: !!st.connected,
        wsOpen: isWsOpen(st.sock),
        cmds: w.cmds,
        avgMs: w.cmds
          ? Math.round(w.totalMs / w.cmds)
          : 0,
        maxMs: w.maxMs,
        slow: w.slow,
        timeouts: w.timeouts,
        errors: w.errors,
        revives: w.revives,
        lastEventAgoS: w.lastEventAt
          ? Math.round(
              (now - w.lastEventAt) / 1000
            )
          : null,
      }
    }
  }

  return out
}

module.exports = {
  guardCommand,
  firePresence,
  refreshGroup,
  attachSession,
  startWatchdog,
  status,
  __tick: () => tick(),
  __reset: () => {
    if (ctx?.timer) {
      clearInterval(ctx.timer)
    }

    ctx = null
  },
}
