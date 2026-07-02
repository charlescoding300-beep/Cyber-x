const https = require('https')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')

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

// otakugifs.xyz confirmed working from Render (unlike nekos.best/waifu.pics,
// which block/reject datacenter IPs — that was the real root cause).
// Maps your action names to otakugifs' supported reaction names where they differ.
const ACTION_MAP = { angry: 'mad' }

// These 5 have no equivalent on otakugifs.xyz — kept in the menu/REACTIONS
// list so the emoji+text reply still works, they just won't have a GIF.
const NO_GIF_AVAILABLE = new Set(['kick', 'bonk', 'yeet', 'baka'])

async function getGifUrl(action, sock, from, message) {
    if (NO_GIF_AVAILABLE.has(action)) return null

    const apiAction = ACTION_MAP[action] || action
    const debugLines = [`node: ${process.version}`]

    try {
        const res = await fetch(`https://api.otakugifs.xyz/gif?reaction=${apiAction}`, {
            signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        debugLines.push(`otakugifs: HTTP ${res.status}`)
        if (res.ok) {
            const json = await res.json()
            if (json.url) return json.url
            debugLines.push('otakugifs: no url in response')
        }
    } catch (e) {
        debugLines.push(`otakugifs: threw ${e.name} - ${e.message}`)
    }

    if (sock && from && message) {
        try {
            await sock.sendMessage(from, {
                text: `🐛 *DEBUG*\n${debugLines.join('\n')}`
            }, { quoted: message })
        } catch (_) {}
    }
    return null
}

function fetchBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('too many redirects'))
        const client = url.startsWith('https') ? https : http
        client.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchBuffer(res.headers.location, redirects + 1).then(resolve).catch(reject)
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

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile('ffmpeg', args, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr?.toString().slice(-500) || err.message))
            resolve()
        })
    })
}

// Converts a GIF buffer into an MP4 buffer via ffmpeg. WhatsApp does not
// reliably render raw GIF-encoded bytes sent as `image:` — that mismatch
// is why nothing displayed before. Sending as `video:` with gifPlayback:true
// is what makes it autoplay/loop in the chat like a real GIF.
async function gifToMp4(gifBuffer) {
    const id = crypto.randomBytes(6).toString('hex')
    const inPath = path.join(os.tmpdir(), `anime_in_${id}.gif`)
    const outPath = path.join(os.tmpdir(), `anime_out_${id}.mp4`)

    try {
        fs.writeFileSync(inPath, gifBuffer)
        await runFfmpeg([
            '-i', inPath,
            '-movflags', 'faststart',
            '-pix_fmt', 'yuv420p',
            '-vf', "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            '-an',
            '-y',
            outPath
        ])
        return fs.readFileSync(outPath)
    } finally {
        try { fs.unlinkSync(inPath) } catch (_) {}
        try { fs.unlinkSync(outPath) } catch (_) {}
    }
}

const run = async ({ sock, from, message, args }) => {
    console.log('[ANIME-TEST] command triggered, node version:', process.version)
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

    // senderJid / targetJid are real WhatsApp JIDs (number@s.whatsapp.net).
    // Tagging like this is what makes WhatsApp render the saved contact
    // name client-side instead of a raw number — this part was already correct.
    const senderJid = message.key.participant || message.key.remoteJid
    const senderTag = `@${senderJid.split('@')[0]}`
    const quoted = message.message?.extendedTextMessage?.contextInfo
    const targetJid = quoted?.participant || quoted?.remoteJid || null
    const targetTag = targetJid ? `@${targetJid.split('@')[0]}` : 'the air 🌬️'

    const actionText = reaction.text(senderTag, targetTag)

    await sock.sendMessage(from, { react: { text: reaction.emoji, key: message.key } }).catch(() => {})

    const gifUrl = await getGifUrl(action, sock, from, message)

    const mentions = [senderJid]
    if (targetJid) mentions.push(targetJid)

    const caption = `${reaction.emoji} *${actionText}*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

    if (!gifUrl) {
        return sock.sendMessage(from, { text: caption, mentions }, { quoted: message })
    }

    let gifBuffer
    try {
        gifBuffer = await fetchBuffer(gifUrl)
    } catch (err) {
        console.error('[ANIME] fetchBuffer failed:', err.message)
        return sock.sendMessage(from, { image: { url: gifUrl }, caption, mentions }, { quoted: message }).catch(async () => {
            await sock.sendMessage(from, { text: caption, mentions }, { quoted: message })
        })
    }

    try {
        const mp4Buffer = await gifToMp4(gifBuffer)
        await sock.sendMessage(from, {
            video: mp4Buffer,
            gifPlayback: true,
            caption,
            mentions,
        }, { quoted: message })
    } catch (err) {
        console.error('[ANIME] gif conversion failed:', err.message)
        try {
            await sock.sendMessage(from, { text: `🐛 *DEBUG* mp4 conversion failed:\n${err.message}` }, { quoted: message })
        } catch (_) {}
        try {
            await sock.sendMessage(from, { image: gifBuffer, caption, mentions }, { quoted: message })
        } catch (err2) {
            console.error('[ANIME] image fallback also failed:', err2.message)
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
