'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/menu.js  —  ZEN X  |  Bot Menu
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')
const os   = require('os')

// Set this to your bot's image URL/path — sent as the menu's picture
const MENU_IMAGE = process.env.MENU_IMAGE_URL || 'https://i.imgur.com/BdycOtx.jpeg'

const HIDDEN = new Set([
    'slot', 'pokedex', 'buy', 'mycard', 'active', 'battle',
    'accept', 'forfeit', 'pokemon', 'pikachu',
])

const VERSION  = process.env.BOT_VERSION || 'v1.0.0'

const CATEGORY_ORDER = [
    'general', 'owner', 'group/admin', 'download', 'fun', 'ai',
    'utility', 'media', 'settings', 'system',
]

const CATEGORY_LABELS = {
    general:       'GENERAL',
    owner:         'OWNER',
    'group/admin': 'GROUP/ADMIN',
    download:      'DOWNLOAD',
    fun:           'FUN',
    ai:            'AI',
    utility:       'UTILITY',
    media:         'MEDIA',
    settings:      'SETTINGS',
    system:        'SYSTEM',
}

// Zero-width spaces have no visible width but count toward WhatsApp's
// message-length threshold — this is the actual mechanism people use to
// force WhatsApp's native "Read more" to appear even on a short-looking
// message. No button, no second command, no typing required from the user.
const ZWSP           = '\u200B'
const READ_MORE_WALL = ZWSP.repeat(4000)

// Maps normal A-Z to the Zen X stylized monospace font automatically —
// so ANY command name (existing or newly added later) renders in the
// same design without ever hand-styling it again.
const STYLE_MAP = {
    A: '𝙰', B: '𝙱', C: '𝙲', D: '𝙳', E: 'Ξ', F: '𝙵', G: '𝙶',
    H: '𝙷', I: '𝙸', J: '𝙹', K: '𝙺', L: '𝙻', M: '𝙼', N: '𝙽',
    O: 'Ø', P: '𝙿', Q: '𝚀', R: '𝚁', S: '𝚂', T: '𝚃', U: '𝚄',
    V: '𝚅', W: '𝚆', X: '𝚇', Y: '𝚈', Z: '𝚉',
}

function stylize(text) {
    return text
        .toUpperCase()
        .split('')
        .map(ch => STYLE_MAP[ch] || ch)
        .join('')
}

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

// Live system RAM — read fresh every time the menu is opened, not hardcoded
function getLiveRam() {
    const totalBytes = os.totalmem()
    const freeBytes  = os.freemem()
    const usedBytes  = totalBytes - freeBytes

    const totalMB = Math.round(totalBytes / 1024 / 1024)
    const usedMB  = Math.round(usedBytes / 1024 / 1024)
    const totalGB = (totalBytes / 1024 / 1024 / 1024).toFixed(1)
    const usedGB  = (usedBytes / 1024 / 1024 / 1024).toFixed(1)
    const pct     = Math.round((usedBytes / totalBytes) * 100)

    return { usedMB, totalMB, usedGB, totalGB, pct }
}

module.exports = {
    pattern:  'menu',
    alias:    ['help'],
    category: 'general',
    desc:     'Zen X command menu',
    usage:    '.menu',

    run: async ({ sock, from, msg, sender, commands, cmdDetails, settings }) => {

        sock.sendMessage(from, {
            react: { text: '𓃦', key: msg.key }
        }).catch(() => {})

        const phone    = (sock.user?.id || '').split(':')[0].split('@')[0]
        const ownerJid = phone ? `${phone}@s.whatsapp.net` : null
        const ownerTag = ownerJid ? `@${phone}` : 'Unknown'

        const prefix    = settings?.get('prefix') || '.'
        const mode      = (settings?.get('mode') || 'public')
        const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1)

        const upSec = Math.floor(process.uptime())
        const ram   = getLiveRam()
        const ping  = Math.floor(Math.random() * 40 + 5)

        const senderJid  = sender || from
        const senderNum  = senderJid.split('@')[0].replace(/:\d+$/, '')
        const senderTag  = `@${senderNum}`
        // Real WhatsApp display name (what shows in their contact card),
        // not the raw phone number — falls back to the number if WhatsApp
        // hasn't sent a push name for some reason.
        const senderName = msg.pushName || senderNum

        // Grouped by category for the hidden section below the wall.
        const grouped = new Map()
        if (Array.isArray(cmdDetails)) {
            for (const cmd of cmdDetails) {
                const name = (cmd.pattern || '').replace(/^\./, '')
                if (!name || HIDDEN.has(name)) continue
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
            const lines = cmds.map(name => `┃ 𓃦 .${stylize(name)}`).join('\n')
            return `┣━━━〔 ${stylize(label)} 〕━━━┫\n┃\n${lines}\n┃`
        }).join('\n\n')

        // Visible part — this is all a person sees before tapping Read more.
        const head = `╭━━━〔 𓃦 𝚉Ξ𝙽 𝚇 𓃦 〕━━━╮
┃
┃  ⚡ ${stylize('WELCOME')}
┃
┃  👤 ${stylize('USER')} : *${senderName}*
┃  🤖 ${stylize('BOT')} : 𝚉Ξ𝙽 𝚇
┃  💾 ${stylize('RAM')} : ${ram.usedGB}GB / ${ram.totalGB}GB (${ram.pct}%)
┃  ⏱️ ${stylize('UPTIME')} : ${formatUptime(upSec)}
┃
╰━━━━━━━━━━━━━━━━━━╯`

        // Hidden part — only visible after WhatsApp's native Read more expands it.
        const hidden = `╭━━━〔 𓃦 𝙵𝚄𝙻𝙻 𝙼Ξ𝙽𝚄 𓃦 〕━━━╮
┃
${sections}
╰━━━━━━━━━━━━━━━━━━╯

© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

        const rawCaption = `${head}${READ_MORE_WALL}\n\n${hidden}`

        // Every line gets WhatsApp's native "> " gray quote treatment —
        // header, box borders, command list, footer, all of it.
        const caption = rawCaption
            .split('\n')
            .map(line => line.length ? `> ${line}` : '>')
            .join('\n')

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

        try {
            await sock.sendMessage(from, {
                image:    { url: MENU_IMAGE },
                caption,
                mimetype: 'image/jpeg',
                mentions,
            }, { quoted: msg })
        } catch {
            await sock.sendMessage(from, { text: caption, mentions }, { quoted: msg })
        }
    },
}
