'use strict'

// ZEN X — Per-session executor stats (owner only)
// Usage: .execstats

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

module.exports = {
  pattern: 'execstats',
  alias: ['execstat', 'executor'],
  desc: 'Show per-session command executor load',
  usage: '.execstats',
  category: 'owner',

  async run({ sock, from, msg, isOwner }) {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ Only the bot owner can use this command.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    if (typeof global.__executorStats !== 'function') {
      return sock.sendMessage(from, {
        text: `❌ Executor statistics are not initialized.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    let all
    try {
      all = global.__executorStats()
    } catch (e) {
      console.error('[EXECSTATS]', e.message)
      return sock.sendMessage(from, {
        text: `❌ Failed to read executor statistics.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    if (!Array.isArray(all) || !all.length) {
      return sock.sendMessage(from, {
        text: `⚡ *Executors*\n\nNo session has run a command yet.\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const load = x =>
      (x.light?.active || 0) + (x.light?.queued || 0) +
      (x.heavy?.active || 0) + (x.heavy?.queued || 0)

    all.sort((a, b) =>
      load(b) - load(a) || (b.executed || 0) - (a.executed || 0)
    )

    const totals = all.reduce((t, x) => ({
      executed: t.executed + (x.executed || 0),
      failed: t.failed + (x.failed || 0),
      timedOut: t.timedOut + (x.timedOut || 0),
      dropped: t.dropped + (x.dropped || 0),
    }), { executed: 0, failed: 0, timedOut: 0, dropped: 0 })

    const lines = all.slice(0, 10).map((x, i) =>
      `${i + 1}. *${x.phone || 'unknown'}*\n` +
      `   🟢 light ${x.light?.active || 0}/${x.light?.max ?? '?'} ` +
      `(+${x.light?.queued || 0} queued)  ` +
      `🔶 heavy ${x.heavy?.active || 0}/${x.heavy?.max ?? '?'} ` +
      `(+${x.heavy?.queued || 0} queued)\n` +
      `   ⏱ avg ${x.avgMs ?? 0}ms · max ${x.maxMs ?? 0}ms · ` +
      `✅ ${x.executed || 0} · ❌ ${x.failed || 0} · ` +
      `⌛ ${x.timedOut || 0} · 🚫 ${x.dropped || 0}`
    )

    return sock.sendMessage(from, {
      text:
        `⚡ *Per-session executors*\n` +
        `Sessions with activity: ${all.length}\n` +
        `Total ✅ ${totals.executed} · ❌ ${totals.failed} · ` +
        `⌛ ${totals.timedOut} · 🚫 ${totals.dropped}\n\n` +
        `${lines.join('\n\n')}\n\n${CREDIT}`,
    }, { quoted: msg })
  },
}
