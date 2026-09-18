'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/welcome.js  —  ZEN X  |  Welcome
//
//  index.js's WATCHDOG calls this directly:
//      const welcomeCmd = require('./commands/welcome.js')
//      const greetData  = welcomeCmd.loadGreet(phone, groupId)
//      const settings   = greetData.welcome
//  That is the ENTIRE reason .welcome on wasn't working before — this
//  file must export loadGreet()/saveGreet() with this exact shape, on
//  top of the normal pattern/run command interface.
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const GREET_DIR = path.join(__dirname, '..', 'data', 'greet')
if (!fs.existsSync(GREET_DIR)) fs.mkdirSync(GREET_DIR, { recursive: true })

function safePhone(phone) {
    return (phone || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
}
function filePath(phone) {
    return path.join(GREET_DIR, `${safePhone(phone)}.json`)
}
function load(phone) {
    const file = filePath(phone)
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        console.error(`[GREET] load error for ${phone}:`, e.message)
    }
    return { groups: {} }
}
function save(phone, data) {
    try {
        fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2))
    } catch (e) {
        console.error(`[GREET] save error for ${phone}:`, e.message)
    }
}

/**
 * Called directly by index.js's WATCHDOG. Returns BOTH welcome and
 * goodbye settings for this group — goodbye.js calls this same function
 * (it requires this file) so both stay in sync from one data file.
 */
function loadGreet(phone, groupId) {
    const data = load(phone)
    const g = data.groups[groupId] || {}
    return {
        welcome: g.welcome || { enabled: false, message: null },
        goodbye: g.goodbye || { enabled: false, message: null },
    }
}

function saveGreet(phone, groupId, type, updates) {
    const data = load(phone)
    if (!data.groups[groupId]) data.groups[groupId] = {}
    if (!data.groups[groupId][type]) data.groups[groupId][type] = {}
    Object.assign(data.groups[groupId][type], updates)
    save(phone, data)
    return data.groups[groupId][type]
}

// ── Rich gray-bold welcome box (optional upgrade — see index.js note) ──
function grayBold(raw) {
    return raw.split('\n').map(l => (l.length ? `> *${l}*` : '>')).join('\n')
}
function pad(label, width) {
    return label + ' '.repeat(Math.max(1, width - label.length))
}
async function getBio(sock, jid) {
    try {
        const res = await sock.fetchStatus(jid)
        if (res?.status) return res.status
    } catch {}
    return 'No bio set'
}
function getDateParts() {
    const now = new Date()
    const tz  = { timeZone: 'Africa/Lagos' }
    return {
        date: now.toLocaleDateString('en-GB', tz),
        time: now.toLocaleTimeString('en-US', { ...tz, hour: '2-digit', minute: '2-digit', hour12: true }),
        day:  now.toLocaleDateString('en-US', { ...tz, weekday: 'long' }),
    }
}
function getRole(meta, jid) {
    const p = meta?.participants?.find(pt => pt.id === jid)
    if (p?.admin === 'superadmin') return 'Super Admin'
    if (p?.admin === 'admin') return 'Admin'
    return 'Member'
}

/**
 * Builds the full detailed gray-bold welcome text. index.js's WATCHDOG
 * can call this instead of its plain {tag}/{group}/{members} template —
 * see the small patch note below for the one line that needs to change.
 */
async function buildRichWelcomeText(sock, { groupId, participantJid, pushName, groupName, memberCount, meta }) {
    const memberPhone = participantJid.split('@')[0]
    const [bio, role] = await Promise.all([
        getBio(sock, participantJid),
        Promise.resolve(getRole(meta, participantJid)),
    ])
    const { date, time, day } = getDateParts()
    const name = pushName || memberPhone
    const W = 10

    const raw =
`╭━━━〔 𓃦 ZΞN X 〕━━━╮
┃  👋 WELCOME NEW MEMBER
╰━━━━━━━━━━━━━━━━━━╯

👤 ${pad('Name', W)}: @${name}
🏷️ ${pad('Tag', W)}: @${memberPhone}
📝 ${pad('Bio', W)}: ${bio}
📱 ${pad('Number', W)}: +${memberPhone}

📅 ${pad('Joined', W)}: ${date}
⏰ ${pad('Time', W)}: ${time}
📆 ${pad('Day', W)}: ${day}

👥 ${pad('Group', W)}: ${groupName}
🔢 ${pad('Members', W)}: ${memberCount}
🛡️ ${pad('Role', W)}: ${role}

━━━━━━━━━━━━━━━━━━━━
✨ Welcome to the group!

© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

    return grayBold(raw)
}

module.exports = {
    loadGreet,
    saveGreet,
    buildRichWelcomeText,

    pattern:  'welcome',
    alias:    [],
    category: 'group',
    desc:     'Enable or disable the join welcome message for this group',
    usage:    '.welcome on | .welcome off',

    run: async ({ sock, from, msg, args }) => {
        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return sock.sendMessage(from, { text: '*This command only works inside a group.*' }, { quoted: msg })
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        const sub = (args?.[0] || '').toLowerCase()

        if (sub !== 'on' && sub !== 'off') {
            const state = loadGreet(phone, from).welcome.enabled ? 'ON ✅' : 'OFF ❌'
            return sock.sendMessage(from, {
                text: `*Welcome is currently: ${state}*\n\nUse *.welcome on* or *.welcome off*`,
            }, { quoted: msg })
        }

        saveGreet(phone, from, 'welcome', { enabled: sub === 'on' })
        const reply = sub === 'on'
            ? '*Welcome Command Enabled successfully ✅*'
            : '*Welcome Command Disabled successfully ❌*'

        await sock.sendMessage(from, { text: reply }, { quoted: msg })
    },
}
