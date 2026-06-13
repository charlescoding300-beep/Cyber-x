// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Auto 🤖 reaction on trigger
//  ✅ Fast: reaction + image fire in parallel (Promise.all)
//  ✅ Bugmenu 👹 category support
//  ✅ Full expanded category set
//
//  HOW TO CATEGORIZE YOUR COMMANDS:
//  Just add  category: "game"  (or any name) to any command file.
//  The menu reads it automatically — zero config needed here.
//
//  Example in your command file:
//    module.exports = {
//      pattern:  "mycommand",
//      category: "tools",        ← THIS is all you need
//      desc:     "Does stuff",
//      run: async (...) => { ... }
//    }
// ════════════════════════════════════════════════════════════════════

const rotator = new Map()

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]

// ── Category display config ───────────────────────────────────────────
// Add a new category here to give it a custom icon + label.
// If a command uses a category NOT listed here, it gets a default ⚙️ icon.
const CAT_CONFIG = {
  game:    { icon: '🎮', label: 'GAMES'      },
  ai:      { icon: '🤖', label: 'AI'         },
  media:   { icon: '🎵', label: 'MEDIA'      },
  admin:   { icon: '🛡️', label: 'ADMIN'      },
  tools:   { icon: '🔧', label: 'TOOLS'      },
  general: { icon: '🌐', label: 'GENERAL'    },
  owner:   { icon: '👑', label: 'OWNER'      },
  fun:     { icon: '😂', label: 'FUN'        },
  info:    { icon: 'ℹ️',  label: 'INFO'       },
  nsfw:    { icon: '🔞', label: 'NSFW'       },
  music:   { icon: '🎶', label: 'MUSIC'      },
  search:  { icon: '🔍', label: 'SEARCH'     },
  dl:      { icon: '⬇️', label: 'DOWNLOADER' },
  sticker: { icon: '🖼️', label: 'STICKER'    },
  economy: { icon: '💰', label: 'ECONOMY'    },
  social:  { icon: '📲', label: 'SOCIAL'     },
  utility: { icon: '🛠️', label: 'UTILITY'    },
  anime:   { icon: '⛩️', label: 'ANIME'      },
  crypto:  { icon: '💎', label: 'CRYPTO'     },
  weather: { icon: '🌤️', label: 'WEATHER'    },
  bug:     { icon: '👹', label: 'BUGMENU'    },   // ← 👹 Bugmenu
}

// Display order — categories listed here appear first, in this order.
// Any unlisted category auto-appends at the end.
const CAT_ORDER = [
  'game', 'ai', 'media', 'music', 'dl', 'sticker',
  'admin', 'tools', 'utility', 'search', 'social',
  'economy', 'crypto', 'weather', 'anime', 'fun',
  'info', 'general', 'owner', 'nsfw', 'bug',
]

// ── Pattern-based fallback (only used if command has NO category field) ─
function guessCategory(pattern) {
  const p = (pattern || '').toLowerCase().replace(/^\./, '')
  if (['slot','pokedex','buy','mycard','active','battle','accept','forfeit','pokemon'].some(k => p.includes(k))) return 'game'
  if (['play','video','song','dl','tiktok','insta','fb','audio','ytdl','download','yt'].some(k => p.includes(k)))   return 'dl'
  if (['antilink','antistatus','warn','kick','ban','promote','demote','mute','unmute','open','close','tagall','add','remove','gban'].some(k => p.includes(k))) return 'admin'
  if (['sticker','toimg','topng','towbep'].some(k => p.includes(k)))                                               return 'sticker'
  if (['translate','tts','tomp3','vv','qr','base64','encode','decode'].some(k => p.includes(k)))                   return 'tools'
  if (['ai','gpt','gemini','chat','ask','imagine','dalle'].some(k => p.includes(k)))                               return 'ai'
  if (['anime','manga','waifu','neko'].some(k => p.includes(k)))                                                   return 'anime'
  if (['weather','rain','forecast','temp'].some(k => p.includes(k)))                                               return 'weather'
  if (['crypto','btc','eth','coin','price'].some(k => p.includes(k)))                                              return 'crypto'
  if (['balance','daily','rob','pay','wallet','bank','economy'].some(k => p.includes(k)))                          return 'economy'
  if (['bug','crash','glitch','exploit','test'].some(k => p.includes(k)))                                          return 'bug'
  return 'general'
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

  run: async ({ sock, from, msg, sender, cmdDetails, commands, cmdList, settings }) => {

    // ── 1. React 🤖 INSTANTLY — fire-and-forget, no await ──────────
    sock.sendMessage(from, {
      react: { text: '🤖', key: msg.key }
    }).catch(() => {})

    const prefix  = settings?.prefix  || '.'
    const botName = settings?.botName || '𝕮𝖄𝕭𝕰𝕽 𝖃'
    const user    = (sender || '').replace(/@.+/, '')

    const now  = new Date()
    const time = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true })
    const date = now.toLocaleDateString('en-US',  { weekday:'short', month:'short', day:'numeric', year:'numeric' })

    const upSec  = Math.floor(process.uptime())
    const upPct  = Math.min(100, Math.round((upSec / 86400) * 100))
    const mem    = process.memoryUsage()
    const ramMB  = (mem.heapUsed  / 1024 / 1024).toFixed(1)
    const totMB  = (mem.heapTotal / 1024 / 1024).toFixed(1)
    const ramPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100))

    // ── Game stats strip (optional) ───────────────────────────────
    let gameStats = ''
    try {
      if (global.pokemonDB) {
        const trainers = Object.keys(global.pokemonDB.users || {}).length
        const cards    = Object.values(global.pokemonDB.users || {}).reduce((a, u) => a + (u.cards?.length || 0), 0)
        gameStats += `║  🎮 Trainers: *${trainers}*  │  Cards: *${cards}*\n`
      }
      if (global.slotData) {
        gameStats += `║  🎰 Spins: *${global.slotData.totalSpins || 0}*  │  🚨 Jackpots: *${global.slotData.totalJackpots || 0}*\n`
      }
    } catch { /* ignore */ }

    // ── Collect ALL commands ──────────────────────────────────────
    let rawCmds = []
    if (commands instanceof Map && commands.size) {
      rawCmds = [...commands.values()]
    }

    const detailMap = {}
    if (Array.isArray(cmdDetails)) {
      for (const c of cmdDetails) detailMap[(c.pattern || '').replace(/^\./, '')] = c
    }

    // ── Build category buckets ────────────────────────────────────
    const buckets = {}
    const seen = new Set()

    for (const raw of rawCmds) {
      const pat = (raw.pattern || '').replace(/^\./, '').toLowerCase().trim()
      if (!pat || seen.has(pat)) continue
      seen.add(pat)
      const cat = (raw.category || detailMap[pat]?.category || guessCategory(pat)).toLowerCase().trim()
      if (!buckets[cat]) buckets[cat] = []
      buckets[cat].push(pat)
    }

    // Fallback: if rawCmds empty, use cmdDetails / cmdList
    if (!rawCmds.length) {
      const fallback = Array.isArray(cmdDetails) && cmdDetails.length
        ? cmdDetails
        : (Array.isArray(cmdList) ? cmdList.map(p => ({ pattern: p })) : [])

      for (const c of fallback) {
        const pat = (c.pattern || '').replace(/^\./, '').toLowerCase().trim()
        if (!pat || seen.has(pat)) continue
        seen.add(pat)
        const cat = (c.category || guessCategory(pat)).toLowerCase().trim()
        if (!buckets[cat]) buckets[cat] = []
        buckets[cat].push(pat)
      }
    }

    // ── Build sections in defined order ───────────────────────────
    const orderedCats = [
      ...CAT_ORDER.filter(c => buckets[c]?.length),
      ...Object.keys(buckets).filter(c => !CAT_ORDER.includes(c) && buckets[c]?.length),
    ]

    function buildSection(cat) {
      const list = buckets[cat]
      if (!list?.length) return ''
      const cfg  = CAT_CONFIG[cat] || { icon: '⚙️', label: cat.toUpperCase() }
      const rows = list.sort().map(p => `║  ◈ *${prefix}${p}*`).join('\n')
      return `╠══〔 ${cfg.icon} *${cfg.label}* 〕══╣\n${rows}`
    }

    const sections = orderedCats.map(buildSection).filter(Boolean).join('\n')
    const total    = seen.size

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
║  ╰─ ${ramMB} MB / ${totMB} MB${gameStats ? '\n╠══〔 📈 *GAME STATS* 〕══╣\n' + gameStats.trimEnd() : ''}
${sections}
╠══════════════════════════╣
║  💡 *Type* ${prefix}*command* *to use*
║  📌 *Total:* ${total} commands
╚══════════════════════════╝
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™* *All rights reserved*`

    // ── 2. Pick rotating image ─────────────────────────────────────
    const idx = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)

    // ── 3. Send image+caption immediately (no pre-typing delay) ───
    try {
      await sock.sendMessage(from, {
        image:    { url: IMAGES[idx] },
        caption,
        mimetype: 'image/jpeg',
        mentions: [sender],
      }, { quoted: msg })
    } catch {
      // Fallback: plain text if image delivery fails
      await sock.sendMessage(from, {
        text:     caption,
        mentions: [sender],
      }, { quoted: msg })
    }
  },
}
