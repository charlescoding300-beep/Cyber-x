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

// ── Random shadow/void welcome messages ─────────────────────────────
const WELCOME_MESSAGES = [
`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 𝐭𝐨 𝐭𝐡𝐞 𝐬𝐡𝐚𝐝𝐨𝐰𝐬 🌑
ʏᴏᴜʀ ᴘʀᴇꜱᴇɴᴄᴇ ɪꜱ ɴᴏᴛᴇᴅ
ꜱᴘᴇᴀᴋ...
✦ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ✦
ᴛʜᴇ ᴅᴀʀᴋɴᴇꜱꜱ ɢʀᴇᴇᴛꜱ ʏᴏᴜ
ʜᴏᴡ ᴍᴀʏ ɪ ᴀꜱꜱɪꜱᴛ?`,

`🖤 ʏᴏᴜ ʜᴀᴠᴇ ᴇɴᴛᴇʀᴇᴅ 🖤
ꜱᴛᴀᴛᴇ ʏᴏᴜʀ ᴘᴜʀᴘᴏꜱᴇ
✦ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ✦
ᴛʜᴇ ᴠᴏɪᴅ ɪꜱ ᴡᴀᴛᴄʜɪɴɢ
ʏᴏᴜʀ ᴘʀᴇꜱᴇɴᴄᴇ ɪꜱ ᴋɴᴏᴡɴ`,

`☾ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ☾
ᴛʜᴇ ᴠᴏɪᴅ ᴏᴘᴇɴꜱ ꜰᴏʀ ʏᴏᴜ
⛧ ʏᴏᴜ ᴀʀᴇ ꜱᴇᴇɴ ⛧
ᴡʜᴀᴛ ᴅᴏ ʏᴏᴜ ꜱᴇᴇᴋ?
🌑 ᴇɴᴛᴇʀ... 🌑`,

`✦ ɢʀᴇᴇᴛɪɴɢꜱ, ᴛʀᴀᴠᴇʟᴇʀ ✦
𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention}
ꜱᴛᴇᴘ ɪɴᴛᴏ ᴛʜᴇ ᴅᴀʀᴋ
🖤 ᴛʜᴇ ᴀʙʏꜱꜱ ᴀᴄᴋɴᴏᴡʟᴇᴅɢᴇꜱ ʏᴏᴜ 🖤`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴀᴡᴀɪᴛ ʏᴏᴜʀ ᴡᴏʀᴅꜱ
ꜱᴘᴇᴀᴋ ꜰʀᴇᴇʟʏ
☾ ᴛʜᴇ ɴɪɢʜᴛ ʜᴀꜱ ɴᴏᴛɪᴄᴇᴅ ʏᴏᴜ ☾`,

`⛧ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ⛧
ʏᴏᴜ ᴀʀᴇ ᴇxᴘᴇᴄᴛᴇᴅ
🌑 ᴀ ɴᴇᴡ ꜱʜᴀᴅᴏᴡ ᴊᴏɪɴꜱ 🌑
ᴛʜᴇ ᴄɪʀᴄʟᴇ ᴡᴇʟᴄᴏᴍᴇꜱ ʏᴏᴜ`,

`🖤 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🖤
ᴛʜᴇ ᴠᴏɪᴅ ᴡʜɪꜱᴘᴇʀꜱ ʏᴏᴜʀ ɴᴀᴍᴇ
ᴇɴᴛᴇʀ ᴡɪᴛʜᴏᴜᴛ ꜰᴇᴀʀ
☾ ᴛʜᴇ ɴɪɢʜᴛ ʀᴇᴄᴏɢɴɪᴢᴇꜱ ʏᴏᴜ ☾`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ʏᴏᴜ ʜᴀᴠᴇ ᴄʀᴏꜱꜱᴇᴅ ᴛʜᴇ ᴛʜʀᴇꜱʜᴏʟᴅ
🖤 ᴅᴀʀᴋɴᴇꜱꜱ ᴇᴍʙʀᴀᴄᴇꜱ ʏᴏᴜ 🖤
ꜱᴘᴇᴀᴋ`,

`✦ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ✦
ᴛʜᴇ ᴅᴀʀᴋɴᴇꜱꜱ ɴᴏᴛɪᴄᴇꜱ ʏᴏᴜ
🖤 ᴄᴏᴍᴇ ᴄʟᴏꜱᴇʀ 🖤
ʏᴏᴜ ᴀʀᴇ ᴡᴇʟᴄᴏᴍᴇ ʜᴇʀᴇ`,

`☾ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ☾
ʙʟᴏᴏᴅ ᴍᴏᴏɴ ɢʀᴇᴇᴛꜱ ʏᴏᴜ
⛧ ᴇɴᴛᴇʀ ᴛʜᴇ ᴄɪʀᴄʟᴇ ⛧
ʏᴏᴜ ᴀʀᴇ ᴇxᴘᴇᴄᴛᴇᴅ`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴋɴᴏᴡ ʏᴏᴜʀ ɴᴀᴍᴇ
✦ ᴛʜᴇ ᴠᴏɪᴅ ᴡᴀᴛᴄʜᴇꜱ ✦
ꜱᴛᴇᴘ ɪɴᴛᴏ ᴛʜᴇ ᴅᴀʀᴋ`,

`🖤 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🖤
ʏᴏᴜʀ ᴀᴜʀᴀ ʜᴀꜱ ᴀʀʀɪᴠᴇᴅ
☾ ᴛʜᴇ ɴɪɢʜᴛ ᴀᴄᴋɴᴏᴡʟᴇᴅɢᴇꜱ ʏᴏᴜ ☾
ᴡʜᴀᴛ ʙʀɪɴɢꜱ ʏᴏᴜ ʜᴇʀᴇ?`,

`⛧ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ⛧
🌑 ꜱɪʟᴇɴᴄᴇ ʙʀᴏᴋᴇɴ 🌑
ᴛʜᴇ ᴄɪʀᴄʟᴇ ʜᴀꜱ ɴᴏᴛɪᴄᴇᴅ
ᴡᴇʟᴄᴏᴍᴇ`,

`✦ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ✦
ᴛʜᴇ ᴠᴏɪᴅ ᴄᴀʟʟᴇᴅ
🖤 ʏᴏᴜ ʜᴇᴀʀᴅ ᴛʜᴇ ᴄᴀʟʟ 🖤
ᴇɴᴛᴇʀ ᴀɴᴅ ꜱᴘᴇᴀᴋ`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ᴛʜᴇ ᴅᴀʀᴋ ᴋɴᴏᴡꜱ ʏᴏᴜ ᴀʀᴇ ʜᴇʀᴇ
☾ ᴛʜᴇ ᴍᴏᴏɴ ᴡɪᴛɴᴇꜱꜱᴇꜱ ʏᴏᴜ ☾
ꜱᴘᴇᴀᴋ ʏᴏᴜʀ ᴘᴜʀᴘᴏꜱᴇ`,

`🖤 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🖤
ᴛʜᴇ ᴀʙʏꜱꜱ ᴡᴇʟᴄᴏᴍᴇꜱ ʏᴏᴜ
⛧ ᴛʜᴇ ᴄɪʀᴄʟᴇ ᴏᴘᴇɴꜱ ⛧
ᴡʜᴀᴛ ᴅᴏ ʏᴏᴜ ꜱᴇᴇᴋ?`,

`☾ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ☾
ᴛʜᴇ ɴɪɢʜᴛ ʀᴇᴄᴇɪᴠᴇꜱ ʏᴏᴜ
🌑 ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴍᴏᴠᴇ 🌑
ꜱᴘᴇᴀᴋ ꜰʀᴇᴇʟʏ`,

`⛧ 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} ⛧
ᴛʜᴇ ᴛʜʀᴇꜱʜᴏʟᴅ ɪꜱ ᴄʀᴏꜱꜱᴇᴅ
🖤 ᴛʜᴇ ᴠᴏɪᴅ ᴍᴀᴋᴇꜱ ʀᴏᴏᴍ 🖤
ᴇɴᴛᴇʀ ᴛʜᴇ ᴄɪʀᴄʟᴇ`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴀᴡᴀɪᴛ ʏᴏᴜ
✦ ʏᴏᴜʀ ᴘʀᴇꜱᴇɴᴄᴇ ɪꜱ ɴᴏᴛᴇᴅ ✦
ᴡʜᴀᴛ ᴅᴏ ʏᴏᴜ ᴅᴇꜱɪʀᴇ?`,

`🖤 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🖤
ᴛʜᴇ ᴠᴏɪᴅ ʜᴀꜱ ᴏᴘᴇɴᴇᴅ
☾ ᴛʜᴇ ɴɪɢʜᴛ ɢʀᴇᴇᴛꜱ ʏᴏᴜ ☾
ꜱᴛᴀʏ ᴀɴᴅ ꜱᴘᴇᴀᴋ`,

`🌑 𝐖𝐞𝐥𝐜𝐨𝐦𝐞 {mention} 🌑
ᴛʜᴇ ᴀʙʏꜱꜱ ʜᴀꜱ ꜱᴇᴇɴ ʏᴏᴜ
⛧ ᴛʜᴇ ᴄɪʀᴄʟᴇ ᴀᴄᴄᴇᴘᴛꜱ ʏᴏᴜ ⛧
ᴇɴᴛᴇʀ...`
]

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)]
}

async function buildRichWelcomeText(sock, { participantJid, pushName }) {
    const name = pushName || participantJid.split('@')[0]
    const mention = `@${name}`
    return pickRandom(WELCOME_MESSAGES).replace(/\{mention\}/g, mention)
}

function buildRandomGoodbyeText(pushName, participantJid) {
    const name = pushName || participantJid.split('@')[0]
    const mention = `@${name}`

    const messages = [
`🌑 ғᴀʀᴇᴡᴇʟʟ 🌑
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴄʟᴏꜱᴇ ʙᴇʜɪɴᴅ ʏᴏᴜ
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴍᴀʏ ᴛʜᴇ ᴅᴀʀᴋɴᴇꜱꜱ ᴋᴇᴇᴘ ʏᴏᴜ`,

`🖤 ᴅᴇᴘᴀʀᴛ ɪɴ ꜱɪʟᴇɴᴄᴇ 🖤
ᴛʜᴇ ᴠᴏɪᴅ ᴀᴡᴀɪᴛꜱ
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ɴɪɢʜᴛ ᴡɪʟʟ ʀᴇᴍᴇᴍʙᴇʀ`,

`☾ ꜰᴀʀᴇᴡᴇʟʟ, ᴛʀᴀᴠᴇʟᴇʀ ☾
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴄɪʀᴄʟᴇ ᴄʟᴏꜱᴇꜱ
ʏᴏᴜʀ ᴊᴏᴜʀɴᴇʏ ᴄᴏɴᴛɪɴᴜᴇꜱ`,

`⛧ ʟᴇᴀᴠᴇ ɴᴏᴡ ⛧
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴡᴀᴛᴄʜ
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴜɴᴛɪʟ ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴄᴀʟʟ ᴀɢᴀɪɴ`,

`🌑 ᴜɴᴛɪʟ ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴄᴀʟʟ ᴀɢᴀɪɴ 🌑
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴅɪꜱᴀᴘᴘᴇᴀʀ ɪɴᴛᴏ ᴛʜᴇ ᴅᴀʀᴋ`,

`🖤 ɢᴏ ᴡɪᴛʜ ᴛʜᴇ ɴɪɢʜᴛ 🖤
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴍᴏᴏɴ ʀᴇʟᴇᴀꜱᴇꜱ ʏᴏᴜ
ꜰᴀʀᴇᴡᴇʟʟ`,

`☾ ᴛʜᴇ ᴍᴏᴏɴ ʀᴇʟᴇᴀꜱᴇꜱ ʏᴏᴜ ☾
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ʏᴏᴜʀ ᴘʀᴇꜱᴇɴᴄᴇ ꜰᴀᴅᴇꜱ
ᴜɴᴛɪʟ ɴᴇxᴛ ᴛɪᴍᴇ...`,

`⛧ ʏᴏᴜʀ ᴘᴀᴛʜ ʟᴇᴀᴠᴇꜱ ᴛʜᴇ ᴄɪʀᴄʟᴇ ⛧
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴠᴏɪᴅ ᴡɪʟʟ ʀᴇᴍᴇᴍʙᴇʀ`,

`🌑 ꜱʟᴇᴇᴘ ᴡᴇʟʟ ɪɴ ᴛʜᴇ ᴠᴏɪᴅ 🌑
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴛᴀᴋᴇ ʏᴏᴜ
ꜰᴀʀᴇᴡᴇʟʟ`,

`✦ ᴛʜᴇ ᴅᴀʀᴋɴᴇꜱꜱ ᴛᴀᴋᴇꜱ ʏᴏᴜ ✦
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴡᴀʟᴋ ᴀᴡᴀʏ ɪɴᴛᴏ ɴᴏᴛʜɪɴɢ`,

`🖤 ᴡᴀʟᴋ ᴀᴡᴀʏ ɪɴᴛᴏ ɴᴏᴛʜɪɴɢ 🖤
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴍᴀʏ ᴛʜᴇ ɴɪɢʜᴛ ɢᴜɪᴅᴇ ʏᴏᴜ`,

`☾ ᴛʜᴇ ɴɪɢʜᴛ ɢᴜɪᴅᴇꜱ ʏᴏᴜʀ ᴘᴀᴛʜ ☾
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴄɪʀᴄʟᴇ ᴄʟᴏꜱᴇꜱ`,

`⛧ ᴛʜᴇ ʀɪᴛᴜᴀʟ ᴇɴᴅꜱ ⛧
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴡɪʟʟ ᴡᴀɪᴛ`,

`🌑 ᴜɴᴛɪʟ ᴡᴇ ᴍᴇᴇᴛ ɪɴ ᴅᴀʀᴋɴᴇꜱꜱ 🌑
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
✦ ꜰᴀᴅᴇ ᴀᴡᴀʏ ✦`,

`🖤 ʏᴏᴜʀ ᴇᴄʜᴏ ʀᴇᴍᴀɪɴꜱ 🖤
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴠᴏɪᴅ ᴡɪʟʟ ʀᴇᴍᴇᴍʙᴇʀ`,

`☾ ᴛʜᴇ ʙʟᴏᴏᴅ ᴍᴏᴏɴ ꜱᴇᴛꜱ ☾
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ꜰᴀʀᴇᴡᴇʟʟ`,

`⛧ ᴅᴇᴘᴀʀᴛ, ᴀɴᴅ ʙᴇ ꜰᴏʀɢᴏᴛᴛᴇɴ ⛧
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ɴɪɢʜᴛ ᴄʟᴏꜱᴇꜱ ʙᴇʜɪɴᴅ ʏᴏᴜ`,

`🌑 ᴛʜᴇ ꜱʜᴀᴅᴏᴡꜱ ᴄʟᴏꜱᴇ ʙᴇʜɪɴᴅ ʏᴏᴜ 🌑
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴜɴᴛɪʟ ɴᴇxᴛ ᴛɪᴍᴇ`,

`🖤 ᴛʜᴇ ᴠᴏɪᴅ ʀᴇʟᴇᴀꜱᴇꜱ ʏᴏᴜ 🖤
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴡᴀʟᴋ ɪɴᴛᴏ ᴛʜᴇ ɴɪɢʜᴛ`,

`☾ ᴛʜᴇ ᴍᴏᴏɴ ʀᴇᴍᴇᴍʙᴇʀꜱ ʏᴏᴜ ☾
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴛʜᴇ ᴅᴀʀᴋ ᴡɪʟʟ ᴡᴀɪᴛ`,

`⛧ ᴛʜᴇ ᴄɪʀᴄʟᴇ ʀᴇᴍᴇᴍʙᴇʀꜱ ʏᴏᴜ ⛧
✦ ɢᴏᴏᴅʙʏᴇ {mention} ✦
ᴜɴᴛɪʟ ʏᴏᴜʀ ʀᴇᴛᴜʀɴ`
    ]

    return pickRandom(messages).replace(/\{mention\}/g, mention)
}

module.exports = {
    loadGreet,
    saveGreet,
    buildRichWelcomeText,
    buildRandomGoodbyeText,

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
