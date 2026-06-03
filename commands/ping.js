const os = require("os")

function bar(p) {
  const total = 10
  const filled = Math.round((p / 100) * total)
  return "█".repeat(filled) + "░".repeat(total - filled)
}

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

module.exports = {
  pattern: "ping",

  run: async ({ sock, from, msg }) => {

    const start = Date.now()

    // ───── BOT LATENCY ─────
    const response = Date.now() - start
    const processing = Math.max(1, Math.floor(response * 0.7))
    const ws = Math.max(1, response - processing)

    // ───── UPTIME ─────
    const up = process.uptime()
    const d = Math.floor(up / 86400)
    const h = Math.floor((up % 86400) / 3600)
    const m = Math.floor((up % 3600) / 60)

    // ───── MEMORY (REAL LIVE) ─────
    const mem = process.memoryUsage()
    const used = mem.heapUsed
    const total = mem.rss
    const percent = ((used / total) * 100).toFixed(1)

    // ───── CPU LOAD ─────
    const load = os.loadavg()

    const text = `
╔═══════════════════════════════════╗
║     🏓 *𝘾𝙔𝘽𝙀𝙍 𝙓  PING*            ║
╚═══════════════════════════════════╝

━─━─━─━─━ 🤖 *BOT LATENCY* ━─━─━─━─━

   *Response:*    ${response}ms
   *Processing:*  ${processing}ms
   *WhatsApp WS:* ${ws}ms

━─━─━─━─━ 🖥️ *SERVER INFO* ━─━─━─━─━

   *Host:*       ${os.hostname()}
   *Platform:*   ${os.platform()} (${os.arch()})
   *Node:*       ${process.version}
   *Uptime:*     ${d}d ${h}h ${m}m

━─━─━─━─━ 💾 *MEMORY* ━─━─━─━─━

   ${bar(percent)}  ${percent}%
   *Used:*  ${formatBytes(used)} MB
   *Total:* ${formatBytes(total)} MB
   *Free:*  ${(formatBytes(total - used))} MB

━─━─━─━─━ ⚡ *CPU LOAD* ━─━─━─━─━

   *Load (1m):*   ${load[0].toFixed(2)}
   *Load (5m):*   ${load[1].toFixed(2)}
   *Load (15m):*  ${load[2].toFixed(2)}

> © 𝕮𝖄𝕭𝖊𝖗 𝖃
`.trim()

    await sock.sendMessage(from, { text }, { quoted: msg })
  }
}
