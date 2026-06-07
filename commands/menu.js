// ── Rotating images ───────────────────────────────────────────────────────────
// IMPORTANT: Must be DIRECT image URLs, not album pages.
// Imgur album:  https://imgur.com/a/HxiNX9U        ← WRONG (page, not image)
// Imgur direct: https://i.imgur.com/xxxxxxx.jpg    ← CORRECT
//
// To get your direct links:
//   1. Open https://imgur.com/a/HxiNX9U
//   2. Click image 1 → right-click → Copy image address → paste below
//   3. Click image 2 → right-click → Copy image address → paste below

const IMAGES = [
  'https://i.ibb.co/mChxd40m/menu.jpg',   // e.g. https://i.imgur.com/abc1234.jpg
  'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',   // e.g. https://i.imgur.com/xyz5678.jpg
]

const rotator = new Map()

function bar(pct, len = 10) {
  const f = Math.round((pct / 100) * len)
  return '█'.repeat(f) + '░'.repeat(len - f) + ` ${pct}%`
}

module.exports = {
  pattern: 'menu',
  desc:    '𝘾𝙔𝘽𝙀𝙍 𝙓 command menu',
  usage:   '.menu',

  run: async ({ sock, from, msg, sender, cmdDetails, settings, isOwner }) => {

    const prefix  = settings.prefix  || '.'
    const botName = settings.botName || '𝕮𝖄𝕭𝕰𝕽 𝖃'
    const user    = sender.replace(/@.+/, '')
    const now     = new Date()
    const time    = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    const date    = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

    const upSec  = Math.floor(process.uptime())
    const uptime = `${Math.floor(upSec/3600)}h ${Math.floor((upSec%3600)/60)}m ${upSec%60}s`
    const upPct  = Math.min(100, Math.round((upSec / 86400) * 100))

    const mem    = process.memoryUsage()
    const ramMB  = (mem.heapUsed  / 1024 / 1024).toFixed(1)
    const totMB  = (mem.heapTotal / 1024 / 1024).toFixed(1)
    const ramPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100))

    const idx = (rotator.get(from) ?? 0) % IMAGES.length
    rotator.set(from, idx + 1)
    const imageUrl = IMAGES[idx]

    const cmds = (cmdDetails || [])
      .filter(c => c.pattern)
      .sort((a, b) => a.pattern.localeCompare(b.pattern))

    const cmdLines = cmds
      .map(c => `║ ► ${c.pattern}${c.usage && c.usage !== c.pattern ? '  ' + c.usage.replace(c.pattern, '').trim() : ''}`)
      .join('\n')

    const caption =
`🌐 *${botName} — MENU* 🌐

╔═══════════════════════════╗
║  👤  User    :  @${user}
║  🕐  Time    :  ${time}
║  📅  Date    :  ${date}
║  🔑  Prefix  :  ${prefix}
╠═══════════════════════════╣
║  📶  *Uptime*
║  ${bar(upPct)}
║  ⏱  ${uptime}
╠═══════════════════════════╣
║  🧠  *RAM Usage*
║  ${bar(ramPct)}
║  💾  ${ramMB} MB / ${totMB} MB
╠═══════════════════════════╣
║
║  🌐 *General Commands* 🌐
║
${cmdLines}
║
╚═══════════════════════════╝

┌───────────────────────────┐
│  © ${botName} · All Rights Reserved
│  Unauthorized use prohibited
│  Licensed under ${botName}
└───────────────────────────┘`

    // ── Send — fallback to text if image URL is invalid ───────────
    const isValidUrl = imageUrl && imageUrl.startsWith('http') && !imageUrl.includes('PASTE_')

    if (isValidUrl) {
      try {
        await sock.sendMessage(from, {
          image:    { url: imageUrl },
          caption,
          mimetype: 'image/jpeg',
          mentions: [sender],
        }, { quoted: msg })
      } catch {
        // image failed — send text only, don't crash
        await sock.sendMessage(from, {
          text:     caption,
          mentions: [sender],
        }, { quoted: msg })
      }
    } else {
      await sock.sendMessage(from, {
        text:     caption,
        mentions: [sender],
      }, { quoted: msg })
    }
  },
}
