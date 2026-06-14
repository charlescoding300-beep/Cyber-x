'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Instant 🤖 reaction on trigger
//  ✅ Flat alphabetical command list — no categories
//  ✅ Zero network calls — reads directly from registry
//  ✅ Quoted reply + image with caption
// ════════════════════════════════════════════════════════════════════

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]
const rotator = new Map()

// Commands to hide from menu (removed games)
const HIDDEN = new Set([
  'slot','pokedex','buy','mycard','active','battle',
  'accept','forfeit','pokemon','pikachu',
])

function bar(pct, len = 12) {
  const f = Math.round((pct / 100) * len)
  return '▰'.repeat(f) + '▱'.repeat(len - f) + `  ${pct}%`
}

function formatUp(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

module.exports = {
  pattern:  'menu',
  category: 'general',
  desc:     'CYBER X command menu',
  usage:    '.menu',

  run: async ({ sock, from, msg, sender, commands, settings }) => {

    // ── 1. React instantly — fire and forget ──────────────────────
    sock.sendMessage(from, {
      react: { text: '🤖', key: msg.key }
    }).catch(() => {})

    const prefix  = settings?.prefix  || '.'
    const botName = settings?.botName || '𝕮𝖄𝕭𝕰𝕽 𝖃'
    const user    = (sender || '').replace(/@.+/, '')

    const now  = new Date()
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    const date = now.toLocaleDateString('en-US',  { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

    const upSec  = Math.floor(process.uptime())
    const upPct  = Math.min(100, Math.round((upSec / 86400) * 100))
    const mem    = process.memoryUsage()
    const ramMB  = (mem.heapUsed  / 1024 / 1024).toFixed(1)
    const totMB  = (mem.heapTotal / 1024 / 1024).toFixed(1)
    const ramPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100))

    // ── 2. Collect all commands alphabetically ─────────────────────
    const cmds = []
    if (commands instanceof Map) {
      for (const [key] of commands) {
        if (!HIDDEN.has(key)) cmds.push(key)
      }
    }
    cmds.sort()

    const cmdLines = cmds.map(c => `║  ◈ *${prefix}${c}*`).join('\n')

    // ── 3. Build caption ───────────────────────────────────────────
    const caption =
`╔══════════════════════════╗
║   ⚡ *${botName}* ⚡
║   𝘾𝙔𝘽𝙀𝙍 𝙓 — *𝑩𝑶𝑻 𝑴𝑬𝑵𝑼*
╠══════════════════════════╣
║  👤  *User*   »  @${user}
║  🕐  *Time*   »  ${time}
║  📅  *Date*   »  ${date}
║  🔑  *Prefix* »  [ ${prefix} ]
╠══〔 📊 *SYSTEM* 〕══╣
║  ⏱️  *Uptime*
║  ${bar(upPct)}
║  ╰─ ${formatUp(upSec)}
║  🧠  *RAM*
║  ${bar(ramPct)}
║  ╰─ ${ramMB} MB / ${totMB} MB
╠══〔 📋 *COMMANDS* 〕══╣
${cmdLines}
╠══════════════════════════╣
║  💡 *Type* ${prefix}*command* *to use*
║  📌 *Total:* ${cmds.length} commands
╚══════════════════════════╝
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™* *All rights reserved*`

    // ── 4. Rotate image ────────────────────────────────────────────
    const idx = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)

    // ── 5. Send image + caption quoted ────────────────────────────
    try {
      await sock.sendMessage(from, {
        image:    { url: IMAGES[idx] },
        caption,
        mimetype: 'image/jpeg',
        mentions: [sender],
      }, { quoted: msg })
    } catch {
      await sock.sendMessage(from, {
        text:     caption,
        mentions: [sender],
      }, { quoted: msg })
    }
  },
}
