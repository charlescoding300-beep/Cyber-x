'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Auto-categorizes commands from their own category: field
//  ✅ Add a new command with category: "owner" → appears under Owner
//  ✅ No manual menu edits ever needed again
//  ✅ Instant 🤖 reaction on trigger
//  ✅ Quoted reply + rotating image
//  ✅ Header card style — Run/Mode/Prefix/RAM/Time/User/Pair/Owner fields
//  ✅ ├◈ bullet category boxes
// ════════════════════════════════════════════════════════════════════

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]
const rotator = new Map()

// Commands to hide from menu entirely
const HIDDEN = new Set([
  'slot', 'pokedex', 'buy', 'mycard', 'active', 'battle',
  'accept', 'forfeit', 'pokemon', 'pikachu',
])

// Category display order + labels
// Any category not listed here will still appear — auto-added at the end
const CATEGORY_ORDER = [
  'general',
  'owner',
  'group/admin',
  'media',
  'fun',
  'ai',
  'utility',
]

const CATEGORY_LABELS = {
  general: '🌐 GENERAL',
  owner:   '👑 OWNER',
  group:   '👥 GROUP/ADMIN👮',
  media:   '🎵 MEDIA',
  fun:     '🎮 FUN',
  ai:      '🤖 AI',
  utility: '🛠️ UTILITY',
}

const PAIR_URL = process.env.PAIR_URL || 'https://cyber-x-y8yv.onrender.com/pair'

function formatUp(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

module.exports = {
  pattern:  'menu',
  category: 'general',
  desc:     'CYBER X command menu',
  usage:    '.menu',

  run: async ({ sock, from, msg, sender, commands, cmdDetails, settings, isOwner }) => {

    // ── 1. React instantly ─────────────────────────────────────────
    sock.sendMessage(from, {
      react: { text: '🤖', key: msg.key }
    }).catch(() => {})

    const prefix  = settings?.prefix  || '.'
    const botName = settings?.botName || 'CYBER X'
    const mode     = (settings?.mode || 'public').toUpperCase()

    const now  = new Date()
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

    const upSec = Math.floor(process.uptime())
    const mem   = process.memoryUsage()
    const ramUsedGB  = (mem.heapUsed  / 1024 / 1024 / 1024).toFixed(2)
    const ramTotalGB = (mem.heapTotal / 1024 / 1024 / 1024).toFixed(2)

    // ── 2. Group commands by category ──────────────────────────────
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
      for (const [key] of commands) {
        if (HIDDEN.has(key)) continue
        if (!grouped.has('general')) grouped.set('general', [])
        grouped.get('general').push(key)
        totalCmds++
      }
    }

    for (const [, cmds] of grouped) cmds.sort()

    const allCats = [...new Set([
      ...CATEGORY_ORDER.filter(c => grouped.has(c)),
      ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
    ])]

    // ── 3. Build category sections — ├◈ bullet box style ────────────
    const sections = allCats.map(cat => {
      const label = CATEGORY_LABELS[cat] || cat.toUpperCase()
      const cmds  = grouped.get(cat) || []
      const lines = cmds.map((c, i) => {
        const isLast = i === cmds.length - 1
        return ` *${isLast ? '┕' : '├'}◈ ${c}*`
      }).join('\n')
      return ` *╭────❒ ${label} ❒*\n${lines}\n *┕──────────────────❒*`
    }).join('\n\n')

    // ── 4. Build header card ────────────────────────────────────────
    const header =
`*╭══ ✕-${botName} ⚡*
*┃🌸 ʀᴜɴ     :* ${formatUp(upSec)}
*┃🛡️ ᴍᴏᴅᴇ    :* ${mode}
*┃👀 ᴘʀᴇғɪx  :* ${prefix}
*┃🚀 ʀᴀᴍ     :* ${ramUsedGB} / ${ramTotalGB} GB
*┃🌨️ ᴛɪᴍᴇ    :* ${time}
*┃🫂 ᴜsᴇʀ    :* ${botName}
*┃🕊️ ᴘᴀɪʀ   :* ${PAIR_URL}
*┃🛡️ ᴏᴡɴᴇʀ   :* ${isOwner ? 'You' : '1'}
*╰═════════════════⊷*`

    const caption =
`${header}

*♡︎•━━━━━${botName}━━━━━•♡*

${sections}

*~_${botName} — every command, one menu_~*`

    // ── 5. Rotate image ────────────────────────────────────────────
    const idx = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)

    // ── 6. Send ────────────────────────────────────────────────────
    try {
      await sock.sendMessage(from, {
        image:    { url: IMAGES[idx] },
        caption,
        mimetype: 'image/jpeg',
      }, { quoted: msg })
    } catch {
      await sock.sendMessage(from, {
        text: caption,
      }, { quoted: msg })
    }
  },
}
