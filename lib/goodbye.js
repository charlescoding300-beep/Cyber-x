'use strict'
// ════════════════════════════════════════════════════════════════════
//  lib/goodbye.js  —  ZEN X  |  Goodbye Engine
//
//  Mirrors lib/welcome.js exactly — same gray-bold styling, same real
//  data box, same profile picture attachment. index.js only needs to
//  detect the leave event and call sendGoodbye().
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const STORE_PATH = path.join(__dirname, '..', 'data', 'goodbye-settings.json')

function ensureStore() {
    const dir = path.dirname(STORE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, '{}')
}
function loadStore() {
    ensureStore()
    try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) } catch { return {} }
}
function saveStore(data) {
    ensureStore()
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2))
}
function storeKey(phone, groupId) {
    return `${phone}_${groupId}`
}
function isEnabled(phone, groupId) {
    const store = loadStore()
    return !!store[storeKey(phone, groupId)]?.enabled
}
function setEnabled(phone, groupId, enabled) {
    const store = loadStore()
    const k = storeKey(phone, groupId)
    store[k] = { ...(store[k] || {}), enabled }
    saveStore(store)
    return enabled
}

// Shares the same cache welcome.js's setStore() populates (index.js only
// needs to call setStore once — welcome.js does it, this just reads it).
let _store = null
function setStore(store) { _store = store }
async function getGroupMeta(sock, groupId) {
    const cached = _store?.groupMetadata?.[groupId]
    if (cached) return cached
    try { return await sock.groupMetadata(groupId) } catch { return null }
}

// Same gray-quote (>) + bold (*) treatment as welcome — every line at once.
function grayBold(raw) {
    return raw
        .split('\n')
        .map(line => (line.length ? `> *${line}*` : '>'))
        .join('\n')
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

// Note: by the time this runs the member has already left, so they won't
// show up in fresh group metadata — role reflects their last known status
// if the caller has it, otherwise defaults to Member.
async function getRole(sock, groupId, jid, meta) {
    try {
        const m = meta || (await sock.groupMetadata(groupId))
        const p = m?.participants?.find(pt => pt.id === jid)
        if (p?.admin === 'superadmin') return 'Super Admin'
        if (p?.admin === 'admin') return 'Admin'
    } catch {}
    return 'Member'
}

function getDateParts() {
    const now = new Date()
    const tz  = { timeZone: 'Africa/Lagos' }
    const date = now.toLocaleDateString('en-GB', tz)
    const time = now.toLocaleTimeString('en-US', { ...tz, hour: '2-digit', minute: '2-digit', hour12: true })
    const day  = now.toLocaleDateString('en-US', { ...tz, weekday: 'long' })
    return { date, time, day }
}

async function getProfilePictureSafe(sock, jid, { retries = 2, delayMs = 800 } = {}) {
    for (let i = 0; i <= retries; i++) {
        try {
            const url = await sock.profilePictureUrl(jid, 'image')
            if (url) return url
        } catch {}
        if (i < retries) await new Promise(r => setTimeout(r, delayMs))
    }
    return null
}

/**
 * Builds and sends the full goodbye message for a member who left.
 * @param sock            active Baileys socket for this session
 * @param opts.groupId    group JID
 * @param opts.participantJid  departing member's JID
 * @param opts.pushName    departing member's WhatsApp display name (optional)
 */
async function sendGoodbye(sock, { groupId, participantJid, pushName }) {
    const meta = await getGroupMeta(sock, groupId)
    const groupName   = meta?.subject || 'this group'
    const memberCount = meta?.participants?.length || 0

    const memberPhone = participantJid.split('@')[0]

    const [bio, role, ppUrl] = await Promise.all([
        getBio(sock, participantJid),
        getRole(sock, groupId, participantJid, meta),
        getProfilePictureSafe(sock, participantJid),
    ])

    const { date, time, day } = getDateParts()
    const name = pushName || memberPhone
    const W = 10

    const raw =
`╭━━━〔 𓃦 ZΞN X 〕━━━╮
┃  👋 GOODBYE MEMBER
╰━━━━━━━━━━━━━━━━━━╯

👤 ${pad('Name', W)}: @${name}
🏷️ ${pad('Tag', W)}: @${memberPhone}
📝 ${pad('Bio', W)}: ${bio}
📱 ${pad('Number', W)}: +${memberPhone}

📅 ${pad('Left', W)}: ${date}
⏰ ${pad('Time', W)}: ${time}
📆 ${pad('Day', W)}: ${day}

👥 ${pad('Group', W)}: ${groupName}
🔢 ${pad('Members', W)}: ${memberCount}
🛡️ ${pad('Role', W)}: ${role}

━━━━━━━━━━━━━━━━━━━━
👋 Goodbye, @${name}!
💙 We wish you all the best.

© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

    const text     = grayBold(raw)
    const mentions = [participantJid]

    try {
        if (ppUrl) {
            await sock.sendMessage(groupId, { image: { url: ppUrl }, caption: text, mentions })
        } else {
            await sock.sendMessage(groupId, { text, mentions })
        }
    } catch (e) {
        console.error('[goodbye] send failed:', e?.message || e)
    }
}

module.exports = { sendGoodbye, isEnabled, setEnabled, grayBold, setStore }
