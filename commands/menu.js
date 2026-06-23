'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Auto-categorizes commands from their own category: field
//  ✅ Add a new command with category: "owner" → appears under Owner
//  ✅ No manual menu edits ever needed again
//  ✅ Instant 🤖 reaction on trigger
//  ✅ Quoted reply + rotating image
// ════════════════════════════════════════════════════════════════════

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]
const rotator = new Map()

// Commands to hide from menu entirely
const HIDDEN = new Set([
  'slot','pokedex','buy','mycard','active','battle',
  'accept','forfeit','pokemon','pikachu',
])

// Category display order + labels
// Any category not listed here will still appear — auto-added at the end
const CATEGORY_ORDER = [
  'general',
  'owner',
  'group',
  'media',
  'fun',
  'ai',
  'utility',
]

const CATEGORY_LABELS = {
  general:  '🌐 GENERAL',
  owner:    '👑 OWNER',
  group:    '👥 GROUP',
  media:    '🎵 MEDIA',
  fun:      '🎮 FUN',
  ai:       '🤖 AI',
  utility:  '🛠️ UTILITY',
}

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

  run: async ({ sock, from, msg, sender, commands, cmdDetails, settings }) => {

    // ── 1. React instantly ─────────────────────────────────────────
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

    // ── 2. Group commands by category ──────────────────────────────
    // Use cmdDetails (array of {pattern, category}) if available,
    // otherwise fall back to commands Map with no category info.
    const grouped = new Map()   // category -> [commandName, ...]
    let totalCmds = 0

    if (Array.isArray(cmdDetails) && cmdDetails.length) {
      for (const cmd of cmdDetails) {
        const name = (cmd.pattern || '').replace(/^\./, '')
        if (HIDDEN.has(name)) continue
        const cat = (cmd.category || 'general').toLowerCase()
        if (!grouped.has(cat)) grouped.set(cat, [])
        grouped.get(cat).push(name)
        totalCmds++
      }
    } else if (commands instanceof Map) {
      // fallback — no category info, dump everything under general
      for (const [key] of commands) {
        if (HIDDEN.has(key)) continue
        if (!grouped.has('general')) grouped.set('general', [])
        grouped.get('general').push(key)
        totalCmds++
      }
    }

    // Sort each category's commands alphabetically
    for (const [, cmds] of grouped) cmds.sort()

    // Build ordered list of categories — known order first, then any extras
    const allCats = [...new Set([
      ...CATEGORY_ORDER.filter(c => grouped.has(c)),
      ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
    ])]

    // ── 3. Build category sections ─────────────────────────────────
    const sections = allCats.map(cat => {
      const label = CATEGORY_LABELS[cat] || `📁 ${cat.toUpperCase()}`
      const cmds  = grouped.get(cat) || []
      const lines = cmds.map(c => `║  ◈ *${prefix}${c}*`).join('\n')
      return `╠══〔 ${label} 〕══╣\n${lines}`
    }).join('\n')

    // ── 4. Build full caption ──────────────────────────────────────
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
${sections}
╠══════════════════════════╣
║  💡 *Type* ${prefix}*command* *to use*
║  📌 *Total:* ${totalCmds} commands
╚══════════════════════════╝
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™* *All rights reserved*`

    // ── 5. Rotate image ────────────────────────────────────────────
    const idx = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)

    // ── 6. Send ────────────────────────────────────────────────────
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
