'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  CYBER X  |  📋 Bot Menu
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const MENU_IMAGES = [
    'https://i.ibb.co/67Ns2ZFX/file-00000000c7c871f4907821a07242d4fc.png',
    'https://i.ibb.co/dwzq819L/file-0000000092b871f493f4dd4a3cd36d7e.png',
]

const HIDDEN = new Set([
    'slot', 'pokedex', 'buy', 'mycard', 'active', 'battle',
    'accept', 'forfeit', 'pokemon', 'pikachu',
])

const CATEGORY_ORDER = [
    'ai', 'download', 'search', 'group/admin', 'utility', 'sticker',
    'fun', 'media', 'security', 'general', 'owner', 'settings', 'system',
]

const CATEGORY_LABELS = {
    ai:            '🤖 AI',
    download:      '📥 Download',
    search:        '🔍 Search',
    'group/admin': '👥 Group/Admin',
    utility:       '🛠️ Tools',
    sticker:       '🎨 Sticker',
    fun:           '🎮 Fun',
    media:         '📷 Media',
    security:      '🔐 Security',
    general:       '⚡ Utilities',
    owner:         '👑 Owner',
    settings:      '⚙️ Settings',
    system:        '📊 System',
}

const VERSION = process.env.BOT_VERSION || 'v5.0.0'
let imgIdx = 0

// ── Matches botpp.js exactly: data/botpp_<phone>.json ───────────────
function getBotPPFile(phone) {
    return path.join(__dirname, '..', 'data', `botpp_${phone}.json`)
}

function loadBotPP(phone) {
    try {
        const file = getBotPPFile(phone)
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
    return {}
}

function formatUptime(totalSec) {
    const d = Math.floor(totalSec / 86400)
    const h = Math.floor((totalSec % 86400) / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = Math.floor(totalSec % 60)
    const parts = []
    if (d > 0) parts.push(`${d}d`)
    if (h > 0) parts.push(`${h}h`)
    if (m > 0) parts.push(`${m}m`)
    parts.push(`${s}s`)
    return parts.join(' ')
}

module.exports = {
    pattern:  'menu',
    alias:    ['help'],
    category: 'general',
    desc:     'CYBER X command menu',
    usage:    '.menu',

    run: async ({ sock, from, msg, sender, commands, cmdDetails, settings }) => {

        sock.sendMessage(from, {
            react: { text: '🧑🏻‍💻', key: msg.key }
        }).catch(() => {})

        const phone    = (sock.user?.id || '').split(':')[0].split('@')[0]
        const ownerJid = phone ? `${phone}@s.whatsapp.net` : null

        const mode      = (settings?.get('mode') || 'public')
        const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1)

        const upSec     = Math.floor(process.uptime())
        const mem       = process.memoryUsage()
        const ramUsedMB = Math.round(mem.rss / 1024 / 1024)
        const ramMaxMB  = parseInt(process.env.MAX_RAM_MB || '512', 10)

        const ping = Math.floor(Math.random() * 40 + 5)

        const senderJid  = sender || from
        const senderNum  = senderJid.split('@')[0].replace(/:\d+$/, '')
        const senderName = senderNum

        const grouped = new Map()
        if (Array.isArray(cmdDetails)) {
            for (const cmd of cmdDetails) {
                const name = (cmd.pattern || '').replace(/^\./, '')
                if (HIDDEN.has(name)) continue
                let cat = (cmd.category || 'general').toLowerCase()
                if (cat === 'group') cat = 'group/admin'
                if (!grouped.has(cat)) grouped.set(cat, [])
                grouped.get(cat).push(name)
            }
        }
        for (const [, cmds] of grouped) cmds.sort()

        const allCats = [...new Set([
            ...CATEGORY_ORDER.filter(c => grouped.has(c)),
            ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort(),
        ])]

        const sections = allCats.map(cat => {
            const label = CATEGORY_LABELS[cat] || cat.toUpperCase()
            const cmds  = grouped.get(cat) || []
            const list  = cmds.join('\n')
            return `*_${label}_*\n${list}`
        }).join('\n\n')

        const caption = `╭━━━〔 ⚡ *𝘾𝙔𝘽𝙀𝙍 𝙓* ⚡ 〕━━━⬣
┃
┃ 👤 *User*    : ${senderName}
┃ ⚙️ *Version* : ${VERSION}
┃ 🚀 *Mode*    : ${modeLabel}
┃ 📡 *Ping*    : ${ping}ms
┃ 💾 *RAM*     : ${ramUsedMB}MB / ${ramMaxMB}MB
┃ ⏳ *Uptime*  : ${formatUptime(upSec)}
╰━━━━━━━━━━━━━━━━━━━━━━⬣

${sections}

> © *𝕮𝖄𝕭𝙀𝙍 𝖃*`

        const mentions = [senderJid]
        if (ownerJid) mentions.push(ownerJid)

        // ── 1. Per-session custom pic (via .botpp) takes priority ──
        const botpp = loadBotPP(phone)
        if (botpp.imageBase64) {
            try {
                await sock.sendMessage(from, {
                    image:    Buffer.from(botpp.imageBase64, 'base64'),
                    caption,
                    mimetype: botpp.mimetype || 'image/jpeg',
                    mentions,
                }, { quoted: msg })
                return
            } catch (e) {
                console.error(`[MENU:${phone}] botpp send failed:`, e.message)
            }
        }

        // ── 2. Rotates through MENU_IMAGES list above ───────────────
        const imgUrl = MENU_IMAGES[imgIdx % MENU_IMAGES.length]
        imgIdx++

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
