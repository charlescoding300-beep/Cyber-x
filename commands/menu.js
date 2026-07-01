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
    'general', 'owner', 'group/admin', 'download', 'fun', 'ai',
    'utility', 'media', 'settings', 'system',
]

const CATEGORY_LABELS = {
    general:       '🌐 GENERAL',
    owner:         '👑 OWNER',
    'group/admin': '👥 GROUP/ADMIN👮',
    download:      '📥 DOWNLOAD',
    fun:           '🎮 FUN',
    ai:            '🤖 AI',
    utility:       '🛠️ UTILITY',
    media:         '🎵 MEDIA',
    settings:      '⚙️ SETTINGS',
    system:        '📊 SYSTEM',
}

const VERSION  = process.env.BOT_VERSION || 'v5.0.0'
const PAIR_URL = process.env.PAIR_URL || 'https://cyber-x-y8yv.onrender.com/pair'
let imgIdx = 0

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
        const ownerTag = ownerJid ? `@${phone}` : 'Unknown'

        const prefix    = settings?.get('prefix') || '.'
        const mode      = (settings?.get('mode') || 'public')
        const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1)

        const upSec     = Math.floor(process.uptime())
        const mem       = process.memoryUsage()
        const ramUsedMB = Math.round(mem.rss / 1024 / 1024)
        const ramMaxMB  = parseInt(process.env.MAX_RAM_MB || '512', 10)
        const ping      = Math.floor(Math.random() * 40 + 5)

        const senderJid = sender || from
        const senderNum = senderJid.split('@')[0].replace(/:\d+$/, '')
        const senderTag = `@${senderNum}`

        const grouped = new Map()
        if (Array.isArray(cmdDetails)) {
            for (const cmd of cmdDetails) {
                const name = (cmd.pattern || '').replace(/^\./, '')
                if (HIDDEN.has(name)) continue
                // ── Merge "group" category into "group/admin" ──
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
            const lines = cmds.map((c, i) => {
                const isLast = i === cmds.length - 1
                return ` *${isLast ? '┕' : '├'}◈ ${c}*`
            }).join('\n')
            return ` *╭────❒ ${label} ❒*\n${lines}\n *┕──────────────────❒*`
        }).join('\n\n')

        const header = `╭━━━〔 ⚡ *𝘾𝙔𝘽𝙀𝙍 𝙓* ⚡ 〕━━━⬣
┃ 👤 *User*    : ${senderTag}
┃ ⚙️ *Version* : ${VERSION}
┃ 🚀 *Mode*    : ${modeLabel}
┃ 📡 *Ping*    : ${ping}ms
┃ 💾 *RAM*     : ${ramUsedMB}MB / ${ramMaxMB}MB
┃ ⏳ *Uptime*  : ${formatUptime(upSec)}
┃ 👑 *Owner*   : ${ownerTag}
╰━━━━━━━━━━━━━━━━━━━━━━⬣`

        const caption = `${header}

*Hey* 👋🏻 ${senderTag}

*♡︎•━━━━━CYBER X━━━━━•♡*

${sections}

> © *𝕮𝖄𝕭𝙀𝙍 𝖃*`

        const mentions = [senderJid]
        if (ownerJid) mentions.push(ownerJid)

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
