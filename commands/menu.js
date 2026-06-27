'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
//
//  ✅ Per-session custom picture (data/botpp_<phone>.json)
//  ✅ Falls back to static URLs if no custom pic set
//  ✅ NO owner WhatsApp profile picture fetching
//  ✅ Session's own linked number shown as bot owner
//  ✅ Greets the person who triggered menu with @tag
//  ✅ Auto-categorizes commands from category: field
//  ✅ Instant 🤖 reaction on trigger
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const FALLBACK_IMAGES = [
    'https://i.ibb.co/mChxd40m/menu.jpg',
    'https://i.ibb.co/8L1msCDW/file-0000000073b471f4815149d72d312c19.png',
]

const HIDDEN = new Set([
    'slot', 'pokedex', 'buy', 'mycard', 'active', 'battle',
    'accept', 'forfeit', 'pokemon', 'pikachu',
])

const CATEGORY_ORDER = [
    'general', 'owner', 'group/admin', 'media', 'fun', 'ai', 'utility',
]

const CATEGORY_LABELS = {
    general:       '🌐 GENERAL',
    owner:         '👑 OWNER',
    'group/admin': '👥 GROUP/ADMIN👮',
    media:         '🎵 MEDIA',
    fun:           '🎮 FUN',
    ai:            '🤖 AI',
    utility:       '🛠️ UTILITY',
}

const PAIR_URL = process.env.PAIR_URL || 'https://cyber-x-y8yv.onrender.com/pair'

let fallbackIdx = 0

// ── Load this session's custom pic ───────────────────────────
function loadCustomPic(phone) {
    try {
        const file = path.join(__dirname, '..', 'data', `botpp_${phone}.json`)
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'))
            if (data.imageBase64) {
                return {
                    buf:      Buffer.from(data.imageBase64, 'base64'),
                    mimetype: data.mimetype || 'image/jpeg',
                }
            }
        }
    } catch {}
    return null
}

// ── Helpers ───────────────────────────────────────────────────
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

    run: async ({ sock, from, msg, sender, commands, cmdDetails, settings }) => {

        // ── 1. React instantly ────────────────────────────────────
        sock.sendMessage(from, {
            react: { text: '🤖', key: msg.key }
        }).catch(() => {})

        // ── 2. Session phone = this session's linked number ───────
        const phone    = (sock.user?.id || '').split(':')[0].split('@')[0]
        const ownerNumber = phone || 'Unknown'

        const prefix  = settings?.get('prefix')  || '.'
        const botName = settings?.get('botName') || 'CYBER X'
        const mode    = (settings?.get('mode') || 'public').toUpperCase()

        const now  = new Date()
        const time = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        })

        const upSec      = Math.floor(process.uptime())
        const mem        = process.memoryUsage()
        const ramUsedGB  = (mem.heapUsed  / 1024 / 1024 / 1024).toFixed(2)
        const ramTotalGB = (mem.heapTotal / 1024 / 1024 / 1024).toFixed(2)

        // ── 3. Sender tag ─────────────────────────────────────────
        const senderJid = sender || from
        const senderNum = senderJid.split('@')[0].replace(/:\d+$/, '')
        const senderTag = `@${senderNum}`

        // ── 4. Group commands by category ─────────────────────────
        const grouped = new Map()

        if (Array.isArray(cmdDetails) && cmdDetails.length) {
            for (const cmd of cmdDetails) {
                const name = (cmd.pattern || '').replace(/^\./, '')
                if (HIDDEN.has(name)) continue
                const cat = (cmd.category || 'general').toLowerCase()
                if (!grouped.has(cat)) grouped.set(cat, [])
                grouped.get(cat).push(name)
            }
        } else if (commands instanceof Map) {
            for (const [key] of commands) {
                if (HIDDEN.has(key)) continue
                if (!grouped.has('general')) grouped.set('general', [])
                grouped.get('general').push(key)
            }
        }

        for (const [, cmds] of grouped) cmds.sort()

        const allCats = [...new Set([
            ...CATEGORY_ORDER.filter(c => grouped.has(c)),
            ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
        ])]

        // ── 5. Build category sections ────────────────────────────
        const sections = allCats.map(cat => {
            const label = CATEGORY_LABELS[cat] || cat.toUpperCase()
            const cmds  = grouped.get(cat) || []
            const lines = cmds.map((c, i) => {
                const isLast = i === cmds.length - 1
                return ` *${isLast ? '┕' : '├'}◈ ${c}*`
            }).join('\n')
            return ` *╭────❒ ${label} ❒*\n${lines}\n *┕──────────────────❒*`
        }).join('\n\n')

        // ── 6. Build header ───────────────────────────────────────
        const header =
`*╭══ ✕-${botName} ⚡*
*┃🌸 ʀᴜɴ       :* ${formatUp(upSec)}
*┃🛡️ ᴍᴏᴅᴇ      :* ${mode}
*┃👀 ᴘʀᴇғɪx    :* ${prefix}
*┃🚀 ʀᴀᴍ       :* ${ramUsedGB} / ${ramTotalGB} GB
*┃🌨️ ᴛɪᴍᴇ      :* ${time}
*┃🫂 ʙᴏᴛ ᴏᴡɴᴇʀ :* ${ownerNumber}
*┃🕊️ ᴘᴀɪʀ      :* ${PAIR_URL}
*┃🛡️ ᴄʀᴇᴅɪᴛ    :* © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

        const caption =
`${header}

*Hey 👋🏻 ${senderTag}*

*♡︎•━━━━━${botName}━━━━━•♡*

${sections}

*~_${botName} — every command, one menu_~*`

        // ── 7. Mentions ───────────────────────────────────────────
        const mentions = [senderJid]

        // ── 8. Send — this session's custom pic first ─────────────
        const custom = loadCustomPic(phone)
        if (custom) {
            try {
                await sock.sendMessage(from, {
                    image:    custom.buf,
                    caption,
                    mimetype: custom.mimetype,
                    mentions,
                }, { quoted: msg })
                return
            } catch (e) {
                console.error(`[MENU:${phone}] custom pic send failed:`, e.message)
            }
        }

        // ── 9. Static fallback ────────────────────────────────────
        const imgUrl = FALLBACK_IMAGES[fallbackIdx % FALLBACK_IMAGES.length]
        fallbackIdx++
        try {
            await sock.sendMessage(from, {
                image:    { url: imgUrl },
                caption,
                mimetype: 'image/jpeg',
                mentions,
            }, { quoted: msg })
        } catch {
            await sock.sendMessage(from, { text: caption, mentions }, { quoted: msg })
        }
    },
}
