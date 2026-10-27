'use strict'
// ═══════════════════════════════════════════════════════════════════════════
//  lib/gcSuspend.js  —  ZENX | reversible group suspension engine
//
//  "Suspend" here means the only thing WhatsApp actually supports:
//    • announcement mode   → only admins can send messages
//    • locked settings     → only admins can edit group info
//    • admin-only adds     → members cannot add people
//    • frozen subject/desc → group is clearly marked as suspended
//    • pinned notice       → members see why the group is quiet
//
//  It does NOT remove, kick, ban or re-add participants. Suspension is fully
//  reversible with .gcunsuspend, and the previous subject/description/add-mode
//  are saved so they can be restored exactly.
//
//  Every operation is attempted in layers:
//    1. announcement via the supported Baileys API
//    2. announcement via raw w:g2 IQ (fallback / redundancy)
//    3. locked settings via API
//    4. locked settings via raw IQ
//    5. admin-only member adds
//    6. subject freeze
//    7. description freeze
//    8. pinned notice
//    9. metadata verification sweep
//   10. final enforcement pass for anything that did not stick
//
//  Each layer retries with backoff and treats WhatsApp rate limits specially.
//
//  State file: <project>/data/gcsuspend.json  (override GCSUSPEND_DATA_DIR)
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { rawSocketOf } = require('./quotedCommandSocket')

const DATA_DIR = process.env.GCSUSPEND_DATA_DIR || path.join(__dirname, '..', 'data')
const FILE = path.join(DATA_DIR, 'gcsuspend.json')

const MAX_TIMEOUT_MS = 2147483647 // setTimeout's 32-bit ceiling (~24.8 days)
const LAYER_ATTEMPTS = 3
const LAYER_BACKOFF_MS = 700
const RATE_LIMIT_WAIT_MS = 5000
const CONFIRM_DELAY_MS = 400

const SUSPENDED_SUBJECT = '⛔ Group Suspended'
const SUSPENDED_DESC =
  'This group has been suspended by an admin. Only admins can send messages. ' +
  'Use .gcunsuspend to reopen it.'
const SUSPENDED_NOTICE =
  '⛔ *GROUP SUSPENDED*\n\n' +
  'Only admins can send messages in this group right now.\n' +
  'An admin can reopen it with *.gcunsuspend*.'

// ─────────────────────────────────────────────────────────────────────────────
//  small helpers
// ─────────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function norm(jid) {
  return String(jid || '').trim().replace(/:\d+(?=@)/, '')
}

function isGroupJid(jid) {
  return /@g\.us$/i.test(norm(jid))
}

function toGroupJid(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const jid = norm(raw)
  if (isGroupJid(jid)) return jid
  if (/^\d{5,}$/.test(jid)) return `${jid}@g.us`
  return null
}

function isRateLimit(error) {
  return /rate|429|too many|flood|slow down/i.test(error?.message || '')
}

// "30s" / "10m" / "2h" / "1h30m" / plain number = minutes
function parseDuration(str) {
  if (str === undefined || str === null || str === '') return null
  const value = String(str).toLowerCase().trim()
  let ms = 0
  const pattern = /(\d+)(h|m|s)/g
  let match
  while ((match = pattern.exec(value)) !== null) {
    const n = parseInt(match[1], 10)
    if (match[2] === 'h') ms += n * 3600000
    if (match[2] === 'm') ms += n * 60000
    if (match[2] === 's') ms += n * 1000
  }
  if (ms === 0 && /^\d+$/.test(value)) ms = parseInt(value, 10) * 60000
  return ms > 0 ? ms : null
}

function formatDuration(ms) {
  if (!ms || ms < 0) return 'forever'
  const totalSeconds = Math.round(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s) parts.push(`${s}s`)
  return parts.join(' ') || '0s'
}

// ─────────────────────────────────────────────────────────────────────────────
//  state persistence (atomic write + .bak, same pattern as antistatusStore)
// ─────────────────────────────────────────────────────────────────────────────
let db = { version: 1, groups: {} }

function load() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}
  for (const file of [FILE, `${FILE}.bak`]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed.groups === 'object' && parsed.groups !== null) {
        db = { version: 1, groups: parsed.groups }
        return
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`) } catch {}
        console.warn(`[GCSUSPEND] ${path.basename(file)} unreadable: ${error.message}`)
      }
    }
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${FILE}.tmp-${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    try { fs.copyFileSync(FILE, `${FILE}.bak`) } catch {}
    fs.renameSync(tmp, FILE)
  } catch (error) {
    console.error(`[GCSUSPEND] could not persist state: ${error.message}`)
  }
}

load()

function getState(jid) {
  return db.groups[norm(jid)] || null
}

function setState(jid, state) {
  db.groups[norm(jid)] = state
  save()
}

function clearState(jid) {
  if (db.groups[norm(jid)]) {
    delete db.groups[norm(jid)]
    save()
  }
}

function listStates() {
  return Object.entries(db.groups).map(([jid, state]) => ({ jid, ...state }))
}

// ─────────────────────────────────────────────────────────────────────────────
//  auto-resume timers (process lifetime; persisted endsAt lets a restart be
//  cleaned up by sweepExpired() on the next command)
// ─────────────────────────────────────────────────────────────────────────────
const timers = new Map()

function clearTimer(jid) {
  const key = norm(jid)
  const timer = timers.get(key)
  if (timer) {
    clearTimeout(timer)
    timers.delete(key)
  }
}

function scheduleAutoResume(sock, jid, durationMs) {
  clearTimer(jid)
  if (!durationMs || durationMs <= 0) return

  const key = norm(jid)
  const state = getState(key)
  const remaining = state?.endsAt ? state.endsAt - Date.now() : durationMs
  const delay = Math.max(0, Math.min(remaining, MAX_TIMEOUT_MS))

  const timer = setTimeout(async () => {
    timers.delete(key)
    const current = getState(key)
    if (!current) return
    if (current.endsAt && Date.now() < current.endsAt - 1000) {
      scheduleAutoResume(sock, key, current.endsAt - Date.now())
      return
    }
    try {
      const result = await resumeGroup(sock, key, { reason: 'timer' })
      console.log(`[GCSUSPEND] auto-resume ${key}: ${result.coreOk ? 'ok' : 'partial'}`)
    } catch (error) {
      console.error(`[GCSUSPEND] auto-resume failed for ${key}: ${error.message}`)
    }
  }, delay)

  if (typeof timer.unref === 'function') timer.unref()
  timers.set(key, timer)
}

// ─────────────────────────────────────────────────────────────────────────────
//  low-level group operations
// ─────────────────────────────────────────────────────────────────────────────
function rawSock(sock) {
  return rawSocketOf(sock) || sock
}

async function fetchMeta(sock, jid) {
  return rawSock(sock).groupMetadata(jid)
}

function settingIq(sock, jid, tag, content) {
  const child = { tag, attrs: {} }
  if (content !== undefined) child.content = content
  return rawSock(sock).query({
    tag: 'iq',
    attrs: { to: jid, type: 'set', xmlns: 'w:g2' },
    content: [child],
  })
}

async function attemptLayer(label, fn, attempts = LAYER_ATTEMPTS) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await fn(attempt)
      return { ok: true, attempts: attempt, value }
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        const wait = isRateLimit(error) ? RATE_LIMIT_WAIT_MS : LAYER_BACKOFF_MS * attempt
        await sleep(wait)
      }
    }
  }
  return { ok: false, attempts, error: lastError }
}

async function refreshMeta(ctx) {
  ctx.meta = await fetchMeta(ctx.sock, ctx.jid)
  return ctx.meta
}

async function applyAndConfirm(ctx, label, apply, check) {
  return attemptLayer(label, async () => {
    await apply()
    await sleep(CONFIRM_DELAY_MS)
    const meta = await refreshMeta(ctx)
    if (!check(meta)) throw new Error(`${label}: change not reflected in group metadata`)
  })
}

function coreStateConfirmed(meta) {
  return meta?.announce === true && meta?.restrict === true && meta?.memberAddMode === false
}

function missingCoreLayers(meta) {
  const missing = []
  if (meta?.announce !== true) missing.push('announcement')
  if (meta?.restrict !== true) missing.push('locked-settings')
  if (meta?.memberAddMode !== false) missing.push('admin-only-add')
  return missing
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUSPEND — 10 layers
// ─────────────────────────────────────────────────────────────────────────────
function buildSuspendLayers() {
  return [
    {
      id: 1,
      name: 'announcement (API)',
      run: ctx => applyAndConfirm(
        ctx, 'announcement-api',
        () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'announcement'),
        meta => meta.announce === true,
      ),
    },
    {
      id: 2,
      name: 'announcement (raw IQ)',
      run: ctx => applyAndConfirm(
        ctx, 'announcement-iq',
        () => settingIq(ctx.sock, ctx.jid, 'announcement'),
        meta => meta.announce === true,
      ),
    },
    {
      id: 3,
      name: 'locked settings (API)',
      run: ctx => applyAndConfirm(
        ctx, 'locked-api',
        () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'locked'),
        meta => meta.restrict === true,
      ),
    },
    {
      id: 4,
      name: 'locked settings (raw IQ)',
      run: ctx => applyAndConfirm(
        ctx, 'locked-iq',
        () => settingIq(ctx.sock, ctx.jid, 'locked'),
        meta => meta.restrict === true,
      ),
    },
    {
      id: 5,
      name: 'admin-only member adds',
      run: ctx => applyAndConfirm(
        ctx, 'admin-only-add',
        () => rawSock(ctx.sock).groupMemberAddMode(ctx.jid, 'admin_add'),
        meta => meta.memberAddMode === false,
      ),
    },
    {
      id: 6,
      name: 'freeze subject',
      run: ctx => {
        if (ctx.meta?.subject === SUSPENDED_SUBJECT) return { ok: true, attempts: 0 }
        return applyAndConfirm(
          ctx, 'subject',
          () => rawSock(ctx.sock).groupUpdateSubject(ctx.jid, SUSPENDED_SUBJECT),
          meta => meta.subject === SUSPENDED_SUBJECT,
        )
      },
    },
    {
      id: 7,
      name: 'freeze description',
      run: ctx => {
        if (String(ctx.meta?.desc || '') === SUSPENDED_DESC) return { ok: true, attempts: 0 }
        return applyAndConfirm(
          ctx, 'description',
          () => rawSock(ctx.sock).groupUpdateDescription(ctx.jid, SUSPENDED_DESC),
          meta => String(meta.desc || '').trim() === SUSPENDED_DESC,
        )
      },
    },
    {
      id: 8,
      name: 'pinned suspension notice',
      run: async ctx => {
        const sent = await attemptLayer('notice', () =>
          rawSock(ctx.sock).sendMessage(ctx.jid, { text: SUSPENDED_NOTICE }))
        if (!sent.ok) return sent
        const key = sent.value?.key
        if (!key) return { ok: false, attempts: 1, error: new Error('notice has no message key') }
        ctx.noticeKey = key
        const pinned = await attemptLayer('pin-notice', () =>
          rawSock(ctx.sock).sendMessage(ctx.jid, { pin: key, type: 1 }))
        // Pinning is best effort: the notice itself already went out.
        return { ok: true, attempts: pinned.attempts, value: { key, pinned: pinned.ok } }
      },
    },
    {
      id: 9,
      name: 'verification sweep',
      run: async ctx => {
        await refreshMeta(ctx)
        const missing = missingCoreLayers(ctx.meta)
        ctx.missing = missing
        return missing.length
          ? { ok: false, attempts: 1, error: new Error(`not confirmed: ${missing.join(', ')}`) }
          : { ok: true, attempts: 1 }
      },
    },
    {
      id: 10,
      name: 'final enforcement pass',
      run: async ctx => {
        const missing = ctx.missing?.length ? ctx.missing : missingCoreLayers(ctx.meta)
        if (!missing.length) return { ok: true, attempts: 0 }

        if (missing.includes('announcement')) {
          await applyAndConfirm(ctx, 'final-announcement-api',
            () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'announcement'),
            meta => meta.announce === true)
          await applyAndConfirm(ctx, 'final-announcement-iq',
            () => settingIq(ctx.sock, ctx.jid, 'announcement'),
            meta => meta.announce === true)
        }
        if (missing.includes('locked-settings')) {
          await applyAndConfirm(ctx, 'final-locked-api',
            () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'locked'),
            meta => meta.restrict === true)
          await applyAndConfirm(ctx, 'final-locked-iq',
            () => settingIq(ctx.sock, ctx.jid, 'locked'),
            meta => meta.restrict === true)
        }
        if (missing.includes('admin-only-add')) {
          await applyAndConfirm(ctx, 'final-admin-only-add',
            () => rawSock(ctx.sock).groupMemberAddMode(ctx.jid, 'admin_add'),
            meta => meta.memberAddMode === false)
        }

        await refreshMeta(ctx)
        const stillMissing = missingCoreLayers(ctx.meta)
        return stillMissing.length
          ? { ok: false, attempts: 1, error: new Error(`still not confirmed: ${stillMissing.join(', ')}`) }
          : { ok: true, attempts: 1 }
      },
    },
  ]
}

const suspendInFlight = new Set()

async function suspendGroup(sock, jid, options = {}) {
  const target = norm(jid)
  if (!isGroupJid(target)) throw new Error('not a group JID')
  if (suspendInFlight.has(target)) {
    throw new Error('a suspension is already running for this group')
  }

  suspendInFlight.add(target)
  try {
    const before = await fetchMeta(sock, target)
    const existing = getState(target)
    const previous = existing?.prev || {
      subject: before.subject || '',
      desc: before.desc || '',
      memberAddMode: before.memberAddMode === true,
      announce: before.announce === true,
      restrict: before.restrict === true,
    }

    const ctx = { sock, jid: target, meta: before, missing: [], results: [] }

    for (const layer of buildSuspendLayers()) {
      const startedAt = Date.now()
      let result
      try {
        result = await layer.run(ctx)
      } catch (error) {
        result = { ok: false, attempts: 1, error }
      }
      const entry = {
        id: layer.id,
        name: layer.name,
        ok: result.ok === true,
        attempts: result.attempts || 0,
        ms: Date.now() - startedAt,
        error: result.error?.message || null,
      }
      ctx.results.push(entry)
      console.log(
        `[GCSUSPEND] ${target} layer ${entry.id}/10 ${entry.name}: ` +
        `${entry.ok ? 'ok' : 'failed'} (${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}, ${entry.ms}ms)` +
        (entry.error ? ` — ${entry.error}` : ''),
      )
    }

    await refreshMeta(ctx).catch(() => {})
    const coreOk = coreStateConfirmed(ctx.meta)

    const now = Date.now()
    setState(target, {
      suspendedAt: existing?.suspendedAt || now,
      endsAt: options.durationMs ? now + options.durationMs : null,
      by: options.actor || existing?.by || null,
      reason: options.reason || 'manual',
      prev: previous,
      subject: SUSPENDED_SUBJECT,
      desc: SUSPENDED_DESC,
      noticeKey: ctx.noticeKey || existing?.noticeKey || null,
      lastRunAt: now,
      lastRun: ctx.results.map(({ id, name, ok, attempts, error }) => ({ id, name, ok, attempts, error })),
    })

    if (options.durationMs) scheduleAutoResume(sock, target, options.durationMs)
    else clearTimer(target)

    return { jid: target, results: ctx.results, coreOk, meta: ctx.meta, previous, state: getState(target) }
  } finally {
    suspendInFlight.delete(target)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESUME — 10 layers, restores saved subject/description/add-mode
// ─────────────────────────────────────────────────────────────────────────────
function buildResumeLayers() {
  return [
    {
      id: 1,
      name: 'announcement off (API)',
      run: ctx => applyAndConfirm(
        ctx, 'announcement-off-api',
        () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'not_announcement'),
        meta => meta.announce === false,
      ),
    },
    {
      id: 2,
      name: 'announcement off (raw IQ)',
      run: ctx => applyAndConfirm(
        ctx, 'announcement-off-iq',
        () => settingIq(ctx.sock, ctx.jid, 'not_announcement'),
        meta => meta.announce === false,
      ),
    },
    {
      id: 3,
      name: 'unlock settings (API)',
      run: ctx => applyAndConfirm(
        ctx, 'unlock-api',
        () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'unlocked'),
        meta => meta.restrict === false,
      ),
    },
    {
      id: 4,
      name: 'unlock settings (raw IQ)',
      run: ctx => applyAndConfirm(
        ctx, 'unlock-iq',
        () => settingIq(ctx.sock, ctx.jid, 'unlocked'),
        meta => meta.restrict === false,
      ),
    },
    {
      id: 5,
      name: 'restore member-add mode',
      run: ctx => {
        const wanted = ctx.state?.prev?.memberAddMode
        if (typeof wanted !== 'boolean') return { ok: true, attempts: 0, value: 'no saved value' }
        const mode = wanted ? 'all_member_add' : 'admin_add'
        return applyAndConfirm(
          ctx, 'member-add-mode',
          () => rawSock(ctx.sock).groupMemberAddMode(ctx.jid, mode),
          meta => meta.memberAddMode === wanted,
        )
      },
    },
    {
      id: 6,
      name: 'restore subject',
      run: ctx => {
        const previous = ctx.state?.prev?.subject
        if (!previous) return { ok: true, attempts: 0, value: 'no saved subject' }
        // Do not clobber a subject an admin changed after suspension.
        if (ctx.meta?.subject !== ctx.state?.subject) {
          return { ok: true, attempts: 0, value: 'subject was changed after suspension' }
        }
        return applyAndConfirm(
          ctx, 'restore-subject',
          () => rawSock(ctx.sock).groupUpdateSubject(ctx.jid, previous),
          meta => meta.subject === previous,
        )
      },
    },
    {
      id: 7,
      name: 'restore description',
      run: ctx => {
        if (!ctx.state) return { ok: true, attempts: 0, value: 'no saved state' }
        const previous = ctx.state?.prev?.desc || ''
        const current = String(ctx.meta?.desc || '')
        if (current !== String(ctx.state?.desc || '')) {
          return { ok: true, attempts: 0, value: 'description was changed after suspension' }
        }
        return applyAndConfirm(
          ctx, 'restore-description',
          () => rawSock(ctx.sock).groupUpdateDescription(ctx.jid, previous),
          meta => String(meta.desc || '') === previous,
        )
      },
    },
    {
      id: 8,
      name: 'unpin suspension notice',
      run: async ctx => {
        if (!ctx.state?.noticeKey) return { ok: true, attempts: 0, value: 'no saved notice key' }
        return attemptLayer('unpin-notice', () =>
          rawSock(ctx.sock).sendMessage(ctx.jid, { pin: ctx.state.noticeKey, type: 2 }))
      },
    },
    {
      id: 9,
      name: 'verification sweep',
      run: async ctx => {
        await refreshMeta(ctx)
        const missing = []
        if (ctx.meta?.announce !== false) missing.push('announcement still on')
        if (ctx.meta?.restrict !== false) missing.push('settings still locked')
        ctx.missing = missing
        return missing.length
          ? { ok: false, attempts: 1, error: new Error(missing.join(', ')) }
          : { ok: true, attempts: 1 }
      },
    },
    {
      id: 10,
      name: 'final reopen pass',
      run: async ctx => {
        const missing = ctx.missing?.length ? ctx.missing : []
        if (!missing.length) return { ok: true, attempts: 0 }

        if (missing.includes('announcement still on')) {
          await applyAndConfirm(ctx, 'final-announcement-off-api',
            () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'not_announcement'),
            meta => meta.announce === false)
          await applyAndConfirm(ctx, 'final-announcement-off-iq',
            () => settingIq(ctx.sock, ctx.jid, 'not_announcement'),
            meta => meta.announce === false)
        }
        if (missing.includes('settings still locked')) {
          await applyAndConfirm(ctx, 'final-unlock-api',
            () => rawSock(ctx.sock).groupSettingUpdate(ctx.jid, 'unlocked'),
            meta => meta.restrict === false)
          await applyAndConfirm(ctx, 'final-unlock-iq',
            () => settingIq(ctx.sock, ctx.jid, 'unlocked'),
            meta => meta.restrict === false)
        }

        await refreshMeta(ctx)
        const stillMissing = []
        if (ctx.meta?.announce !== false) stillMissing.push('announcement still on')
        if (ctx.meta?.restrict !== false) stillMissing.push('settings still locked')
        return stillMissing.length
          ? { ok: false, attempts: 1, error: new Error(stillMissing.join(', ')) }
          : { ok: true, attempts: 1 }
      },
    },
  ]
}

const resumeInFlight = new Set()

async function resumeGroup(sock, jid, options = {}) {
  const target = norm(jid)
  if (!isGroupJid(target)) throw new Error('not a group JID')
  if (resumeInFlight.has(target)) {
    throw new Error('a resume is already running for this group')
  }

  resumeInFlight.add(target)
  try {
    const state = getState(target)
    const ctx = {
      sock,
      jid: target,
      state,
      meta: await fetchMeta(sock, target),
      missing: [],
      results: [],
    }

    for (const layer of buildResumeLayers()) {
      const startedAt = Date.now()
      let result
      try {
        result = await layer.run(ctx)
      } catch (error) {
        result = { ok: false, attempts: 1, error }
      }
      const entry = {
        id: layer.id,
        name: layer.name,
        ok: result.ok === true,
        attempts: result.attempts || 0,
        ms: Date.now() - startedAt,
        error: result.error?.message || null,
      }
      ctx.results.push(entry)
      console.log(
        `[GCSUSPEND] ${target} resume layer ${entry.id}/10 ${entry.name}: ` +
        `${entry.ok ? 'ok' : 'failed'} (${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}, ${entry.ms}ms)` +
        (entry.error ? ` — ${entry.error}` : ''),
      )
    }

    await refreshMeta(ctx).catch(() => {})
    const coreOk = ctx.meta?.announce === false && ctx.meta?.restrict === false
    const fullyRestored = ctx.results.every(entry => entry.ok)

    if (coreOk && fullyRestored) {
      clearTimer(target)
      clearState(target)
    }

    return {
      jid: target,
      results: ctx.results,
      coreOk,
      fullyRestored,
      meta: ctx.meta,
      state,
      reason: options.reason || 'manual',
    }
  } finally {
    resumeInFlight.delete(target)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Restart cleanup: resume anything whose timer expired while the bot was off.
// ─────────────────────────────────────────────────────────────────────────────
async function sweepExpired(sock) {
  const now = Date.now()
  const expired = listStates().filter(state => state.endsAt && state.endsAt <= now)
  const results = []
  for (const state of expired) {
    try {
      const result = await resumeGroup(sock, state.jid, { reason: 'expired-sweep' })
      results.push({ jid: state.jid, ok: result.coreOk })
    } catch (error) {
      results.push({ jid: state.jid, ok: false, error: error.message })
    }
  }
  return results
}

function isBusy(jid) {
  const key = norm(jid)
  return suspendInFlight.has(key) || resumeInFlight.has(key)
}

module.exports = {
  SUSPENDED_SUBJECT,
  SUSPENDED_DESC,
  SUSPENDED_NOTICE,
  toGroupJid,
  isGroupJid,
  norm,
  parseDuration,
  formatDuration,
  getState,
  listStates,
  suspendGroup,
  resumeGroup,
  sweepExpired,
  isBusy,
  clearTimer,
}
