const https = require('https')
const http = require('http')

const REACTIONS = {
    hug:       { emoji: '🤗', text: (a, b) => `${a} hugged ${b}` },
    kiss:      { emoji: '💋', text: (a, b) => `${a} kissed ${b}` },
    cuddle:    { emoji: '🥰', text: (a, b) => `${a} cuddled ${b}` },
    pat:       { emoji: '🫶', text: (a, b) => `${a} patted ${b}` },
    handhold:  { emoji: '🤝', text: (a, b) => `${a} held hands with ${b}` },
    slap:      { emoji: '🫲🏻', text: (a, b) => `${a} slapped ${b}` },
    kick:      { emoji: '🦵🏻', text: (a, b) => `${a} kicked ${b}` },
    punch:     { emoji: '👊',   text: (a, b) => `${a} punched ${b}` },
    bite:      { emoji: '😬',   text: (a, b) => `${a} bit ${b}` },
    bonk:      { emoji: '🔨',   text: (a, b) => `${a} bonked ${b}` },
    yeet:      { emoji: '🚀',   text: (a, b) => `${a} yeeted ${b}` },
    baka:      { emoji: '😤',   text: (a, b) => `${a} called ${b} a baka!` },
    tickle:    { emoji: '🤣',   text: (a, b) => `${a} tickled ${b}` },
    poke:      { emoji: '👉',   text: (a, b) => `${a} poked ${b}` },
    cry:       { emoji: '😢', text: (a, b) => `${a} is crying` },
    laugh:     { emoji: '😂', text: (a, b) => `${a} is laughing` },
    blush:     { emoji: '😳', text: (a, b) => `${a} is blushing` },
    smile:     { emoji: '😊', text: (a, b) => `${a} smiled at ${b}` },
    wink:      { emoji: '😉', text: (a, b) => `${a} winked at ${b}` },
    smug:      { emoji: '😏', text: (a, b) => `${a} is being smug` },
    pout:      { emoji: '😤', text: (a, b) => `${a} is pouting` },
    angry:     { emoji: '😡', text: (a, b) => `${a} is angry at ${b}` },
    dance:     { emoji: '💃', text: (a, b) => `${a} is dancing` },
    wave:      { emoji: '👋', text: (a, b) => `${a} waved at ${b}` },
    clap:      { emoji: '👏', text: (a, b) => `${a} clapped at ${b}` },
    nom:       { emoji: '😋', text: (a, b) => `${a} is nomming` },
    sleep:     { emoji: '😴', text: (a, b) => `${a} fell asleep` },
    yawn:      { emoji: '🥱', text: (a, b) => `${a} yawned` },
}

async function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http
        client.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchBuffer(res.headers.location).then(resolve).catch(reject)
                return
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
            const chunks = []
            res.on('data', c => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks)))
            res.on('error', reject)
        }).on('error', reject)
    })
}

async function getGifUrl(action) {
    const apis = [
        `https://api.waifu.pics/sfw/${action}`,
        `https://nekos.best/api/v2/${action}`,
    ]

    for (const apiUrl of apis) {
        try {
            const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) })
            if (!res.ok) continue
            const json = await res.json()
            const gifUrl = json.url || json.results?.[0]?.url
            if (gifUrl) return gifUrl
        } catch (e) {
            console.log(`[ANIME] API failed (${apiUrl}):`, e.message)
        }
    }
    return null
}

const run = async ({ sock, from, message, args }) => {
    const action = (args[0] || '').toLowerCase().trim()
    const reaction = REACTIONS[action]

    if (!action) {
        const cmds = Object.keys(REACTIONS).join('  ')
        return sock.sendMessage(from, {
            text: `╔═══════════════════════════════════╗\n║  🎌 *CYBER X — ANIME*            ║\n╚═══════════════════════════════════╝\n\n📌 *Usage:* _.anime <action>_\nReply to someone for best effect!\n\n🔥 *Available:*\n${cmds}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
        }, { quoted: message })
    }

    if (!reaction) {
        const all = Object.keys(REACTIONS).join(', ')
        return sock.sendMessage(from, {
            text: `❌ *Unknown:* _${action}_\n\n${all}`
        }, { quoted: message })
    }

    const senderJid = message.key.participant || message.key.remoteJid
    const senderTag = `@${senderJid.split('@')[0]}`
    const quoted = message.message?.extendedTextMessage?.contextInfo
    const targetJid = quoted?.participant || quoted?.remoteJid || null
    const targetTag = targetJid ? `@${targetJid.split('@')[0]}` : 'the air 🌬️'

    const actionText = reaction.text(senderTag, targetTag)

    await sock.sendMessage(from, { react: { text: reaction.emoji, key: message.key } }).catch(() => {})

    const gifUrl = await getGifUrl(action)

    const mentions = [senderJid]
    if (targetJid) mentions.push(targetJid)

    const caption = `${reaction.emoji} *${actionText}*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

    if (!gifUrl) {
        return sock.sendMessage(from, { text: caption }, { quoted: message })
    }

    try {
        const buf = await fetchBuffer(gifUrl)
        // ── Send as image, not mislabeled video/mp4 ──
        // waifu.pics/nekos.best return real .gif bytes, and WhatsApp
        // can't decode gif-bytes wrapped as video/mp4 — that mismatch
        // is exactly why nothing was rendering before.
        await sock.sendMessage(from, {
            image: buf,
            caption,
            mentions,
        }, { quoted: message })
    } catch (err) {
        console.error('[ANIME]', err.message)
        try {
            await sock.sendMessage(from, {
                image: { url: gifUrl },
                caption,
                mentions,
            }, { quoted: message })
        } catch (err2) {
            console.error('[ANIME] fallback also failed:', err2.message)
            await sock.sendMessage(from, { text: caption, mentions }, { quoted: message })
        }
    }
}

module.exports = {
    name: 'anime',
    aliases: ['anime', 'reaction'],
    category: 'fun',
    desc: 'Send anime reaction GIFs',
    usage: '.anime <reaction>',
    run
}
