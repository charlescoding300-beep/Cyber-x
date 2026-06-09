// commands/menu.js — CYBER X MENU
const rotator = new Map()

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]

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

function getCategory(pattern) {
  const p = (pattern || '').toLowerCase().replace(/^\./, '')
  if (['play','video','song','dl','tiktok','insta','fb','audio'].some(k => p.includes(k))) return 'media'
  if (['antilink','antistatus','warn','kick','ban','promote','demote','mute','unmute','open','close','add','remove','tagall'].some(k => p.includes(k))) return 'admin'
  if (['vv','sticker','toimg','tomp3','translate'].some(k => p.includes(k))) return 'tools'
  if (['ai','gpt','gemini','chat','ask'].some(k => p.includes(k))) return 'ai'
  return 'general'
}

module.exports = {
  pattern: 'menu',
  desc:    'CYBER X command menu',
  usage:   '.menu',
  noGroup: true,

  run: async ({ sock, from, msg, sender, cmdDetails, commands, cmdList, settings }) => {

    const prefix  = settings?.prefix  || '.'
    const botName = settings?.botName || '𝕮𝖄𝕭𝕰𝕽 𝖃'
    const user    = (sender || '').replace(/@.+/, '')

    const now  = new Date()
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

    const upSec  = Math.floor(process.uptime())
    const uptime = formatUp(upSec)
    const upPct  = Math.min(100, Math.round((upSec / 86400) * 100))

    const mem    = process.memoryUsage()
    const ramMB  = (mem.heapUsed  / 1024 / 1024).toFixed(1)
    const totMB  = (mem.heapTotal / 1024 / 1024).toFixed(1)
    const ramPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100))

    // ── Collect commands from ALL possible sources ──
    let allCmds = []

    if (Array.isArray(cmdDetails) && cmdDetails.length) {
      allCmds = cmdDetails
    } else if (commands instanceof Map && commands.size) {
      allCmds = [...commands.values()].map(c => ({
        pattern: c.pattern,
        desc:    c.desc  || '',
        usage:   c.usage || '',
      }))
    } else if (Array.isArray(cmdList) && cmdList.length) {
      allCmds = cmdList.map(p => ({ pattern: p, desc: '', usage: '' }))
    }

    // Categorize
    const cats = { ai: [], general: [], media: [], admin: [], tools: [] }
    for (const c of allCmds) {
      const p   = (c.pattern || '').replace(/^\./, '')
      const cat = getCategory(p)
      if (!cats[cat]) cats[cat] = []
      cats[cat].push(p)
    }

    function buildSection(icon, label, list) {
      if (!list || !list.length) return ''
      return (
`╠══〔 ${icon} *${label}* 〕══╣
` + list.sort().map(p => `║  ◈ *${prefix}${p}*`).join('\n')
      )
    }

    const aiSec      = buildSection('🤖', 'AI',      cats.ai)
    const generalSec = buildSection('🌐', 'GENERAL', cats.general)
    const mediaSec   = buildSection('🎵', 'MEDIA',   cats.media)
    const adminSec   = buildSection('🛡️', 'ADMIN',   cats.admin)
    const toolsSec   = buildSection('🔧', 'TOOLS',   cats.tools)

    const sections = [aiSec, generalSec, mediaSec, adminSec, toolsSec]
      .filter(Boolean).join('\n')

    const total = allCmds.length

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
║  ╰─ ${uptime}
║  🧠  *RAM*
║  ${bar(ramPct)}
║  ╰─ ${ramMB} MB / ${totMB} MB
${sections}
╠══════════════════════════╣
║  💡 *Type* ${prefix}*command* *to use*
║  📌 *Total:* ${total} commands
╚══════════════════════════╝
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

    // Rotating image
    const idx      = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)
    const imageUrl = IMAGES[idx]

    try {
      await sock.sendMessage(from, {
        image:    { url: imageUrl },
        caption,
        mimetype: 'image/jpeg',
        mentions: [sender],
      }, { quoted: msg })
    } catch {
      // Image failed — send text only
      await sock.sendMessage(from, {
        text:     caption,
        mentions: [sender],
      }, { quoted: msg })
    }
  },
}
