'use strict'
const { sendOwnerRestricted } = require('../lib/groupAdminNotice')

// ─────────────────────────────────────────────────────────────────────────────
// commands/execstats.js  —  ZEN X  |  Per-session executor stats (owner only)
//
// USAGE:   .execstats
//
// Shows the busiest sessions: running / queued commands in the light and
// heavy lanes, average + max runtime, failures, timeouts and drops.
// Data comes from global.__executorStats() (set in index.js).
// ─────────────────────────────────────────────────────────────────────────────

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

module.exports = {
  pattern:  'execstats',
  alias:    ['execstat', 'executor'],
  desc:     'Show per-session command executor load',
  usage:    '.execstats',
  category: 'owner',

  async run({ sock, from, msg, isOwner }) {
    if (!isOwner) return sendOwnerRestricted(sock, msg?.key?.remoteJid, msg)

    if (typeof global.__executorStats !== 'function') {
      return sock.sendMessage(from, {
        text: `❌ Executor stats are not available. Is the ultra patch applied to index.js?\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const all = global.__executorStats()
    if (!all.length) {
      return sock.sendMessage(from, {
        text: `⚡ *Executors*\n\nNo session has run a command yet.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // busiest first: queued + running, then total commands run
    all.sort((a, b) => {
      const load = x => x.light.active + x.light.queued + x.heavy.active + x.heavy.queued
      return load(b) - load(a) || b.executed - a.executed
    })

    const totals = all.reduce((t, x) => ({
      executed: t.executed + x.executed,
      failed:   t.failed + x.failed,
      timedOut: t.timedOut + x.timedOut,
      dropped:  t.dropped + x.dropped,
    }), { executed: 0, failed: 0, timedOut: 0, dropped: 0 })

    // Node runs every session on ONE thread; high lag here = that thread is saturated
    const loop = typeof global.__loopStats === 'function' ? global.__loopStats() : null
    const loopLine = loop
      ? `🧵 Event loop (last 10s): p50 ${loop.p50}ms · p99 ${loop.p99}ms · max ${loop.max}ms\n`
      : ''
    const pool = typeof global.__heavyPoolStats === 'function' ? global.__heavyPoolStats() : null
    const poolLine = pool
      ? `🌐 Shared heavy pool: ${pool.active}/${pool.max} active · ${pool.waitingSessions} session(s) waiting\n`
      : ''

    const lines = all.slice(0, 10).map((x, i) =>
      `${i + 1}. *${x.phone}*\n` +
      `   🟢 light ${x.light.active}/${x.light.max} (+${x.light.queued} queued)  ` +
      `🔶 heavy ${x.heavy.active}/${x.heavy.max} (+${x.heavy.queued})\n` +
      `   ⏱ avg ${x.avgMs}ms · max ${x.maxMs}ms · ✅ ${x.executed} · ❌ ${x.failed} · ⌛ ${x.timedOut} · 🚫 ${x.dropped}`
    )

    await sock.sendMessage(from, {
      text:
        `⚡ *Per-session executors*\n` +
        `Sessions with activity: ${all.length}\n` +
        `Total ✅ ${totals.executed} · ❌ ${totals.failed} · ⌛ ${totals.timedOut} · 🚫 ${totals.dropped}\n` +
        `${loopLine}${poolLine}\n` +
        `${lines.join('\n\n')}\n\n${CREDIT}`,
    }, { quoted: msg })
  },
}
