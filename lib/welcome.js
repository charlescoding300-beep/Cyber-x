'use strict'
// ════════════════════════════════════════════════════════════════════
//  lib/welcome.js  —  ZEN X  |  Welcome Engine
//
//  index.js only needs to detect the join event and call sendWelcome().
//  Everything about HOW the welcome looks (gray-quote + bold styling,
//  the detail box, the profile picture) lives here.
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const STORE_PATH = path.join(__dirname, '..', 'data', 'welcome-settings.json')

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

// Every line gets WhatsApp's gray quote bar (>) AND bold (*) at the same
// time — the "gray-bold" look. Empty lines just get a bare '>' so the
// quote block stays visually continuous instead of breaking.
function grayBold(raw) {
    return raw
        .split('\n')
        .map(line => (line.length ? `> *${line}*` : '>'))
        .join('\n')
}

// Aligns "Label :" columns so the box reads cleanly.
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
    const date = now.toLocaleDateString('en-GB', tz)                                     // dd/mm/yyyy
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
 * Builds and sends the full welcome message for a new group member.
 * @param sock            active Baileys socket for this session
 * @param opts.groupId    group JID
 * @param opts.participantJid  new member's JID
 * @param opts.pushName    new member's WhatsApp display name (optional)
 */
async function sendWelcome(sock, { groupId, participantJid, pushName }) {
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
    const W = 10 // label column width

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

    const text     = grayBold(raw)
    const mentions = [participantJid]

    try {
        if (ppUrl) {
            await sock.sendMessage(groupId, { image: { url: ppUrl }, caption: text, mentions })
        } else {
            await sock.sendMessage(groupId, { text, mentions })
        }
    } catch (e) {
        console.error('[welcome] send failed:', e?.message || e)
    }
}

// ─── Group metadata cache, set once by index.js at startup ────────────
// index.js already calls:
//   require("./lib/welcome").setStore({ groupMetadata: groupCache })
// Using the cache (when available) avoids an extra sock.groupMetadata()
// round-trip on every join/leave.
let _store = null
function setStore(store) { _store = store }

async function getGroupMeta(sock, groupId) {
    const cached = _store?.groupMetadata?.[groupId]
    if (cached) return cached
    try { return await sock.groupMetadata(groupId) } catch { return null }
}

/**
 * Auto-wired dispatcher. index.js already does:
 *   sock.ev.on("group-participants.update", async update => {
 *     if (typeof lib.handleGroupUpdate === "function")
 *       lib.handleGroupUpdate(sock, update).catch(() => {})
 *   })
 * This is the single entry point for both welcome (action "add") and
 * goodbye (action "remove") — no other index.js wiring is needed.
 */
async function handleGroupUpdate(sock, update) {
    const { id: groupId, participants = [], action } = update || {}
    if (!groupId || !Array.isArray(participants) || !action) return

    const phone = (sock.user?.id || '').split(':')[0]

    for (const participantJid of participants) {
        try {
            if (action === 'add') {
                if (!isEnabled(phone, groupId)) continue
                await sendWelcome(sock, { groupId, participantJid })
            } else if (action === 'remove') {
                const goodbyeLib = require('./goodbye')
                if (!goodbyeLib.isEnabled(phone, groupId)) continue
                await goodbyeLib.sendGoodbye(sock, { groupId, participantJid })
            }
        } catch (e) {
            console.error('[group-update] error:', e?.message || e)
        }
    }
}

module.exports = { sendWelcome, isEnabled, setEnabled, grayBold, setStore, handleGroupUpdate }
