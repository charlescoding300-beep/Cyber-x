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
    punch:     { emoji: '👊', text: (a, b) => `${a} punched ${b}` },
    bite:      { emoji: '😬', text: (a, b) => `${a} bit ${b}` },
    bonk:      { emoji: '🔨', text: (a, b) => `${a} bonked ${b}` },
    yeet:      { emoji: '🚀', text: (a, b) => `${a} yeeted ${b}` },
    baka:      { emoji: '😤', text: (a, b) => `${a} called ${b} a baka!` },
    tickle:    { emoji: '🤣', text: (a, b) => `${a} tickled ${b}` },
    poke:      { emoji: '👉', text: (a, b) => `${a} poked ${b}` },
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

const ACTION_MAP = {
    angry: 'mad'
}

const NO_GIF_AVAILABLE = new Set([
    'kick',
    'bonk',
    'yeet',
    'baka'
])

async function getGifUrl(action, sock, from, msg) {
    if (NO_GIF_AVAILABLE.has(action)) return null

    const apiAction = ACTION_MAP[action] || action
    const debugLines = [`node: ${process.version}`]

    try {
        const res = await fetch(
            `https://api.otakugifs.xyz/gif?reaction=${apiAction}`,
            {
                signal: AbortSignal.timeout(15000),
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            }
        )

        debugLines.push(`otakugifs: HTTP ${res.status}`)

        if (res.ok) {
            const json = await res.json()

            if (json.url) {
                return json.url
            }

            debugLines.push('otakugifs: no url in response')
        }
    } catch (e) {
        debugLines.push(
            `otakugifs: threw ${e.name} - ${e.message}`
        )
    }

    if (sock && from && message) {
        try {
            await sock.sendMessage(
                from,
                {
                    text: `🐛 *DEBUG*\n${debugLines.join('\n')}`
                },
                {
                    quoted: message
                }
            )
        } catch (_) {}
    }

    return null
}

function fetchBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) {
            return reject(new Error('too many redirects'))
        }

        const client = url.startsWith('https') ? https : http

        client.get(
            url,
            {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            },
            (res) => {
                if (
                    res.statusCode >= 300 &&
                    res.statusCode < 400 &&
                    res.headers.location
                ) {
                    fetchBuffer(
                        res.headers.location,
                        redirects + 1
                    )
                        .then(resolve)
                        .catch(reject)

                    return
                }

                if (res.statusCode !== 200) {
                    return reject(
                        new Error(`HTTP ${res.statusCode}`)
                    )
                }

                const chunks = []

                res.on('data', chunk => chunks.push(chunk))

                res.on('end', () => {
                    resolve(Buffer.concat(chunks))
                })

                res.on('error', reject)
            }
        ).on('error', reject)
    })
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(
            'ffmpeg',
            args,
            {
                timeout: 30000
            },
            (err, stdout, stderr) => {
                if (err) {
                    return reject(
                        new Error(
                            stderr?.toString().slice(-500) ||
                            err.message
                        )
                    )
                }

                resolve()
            }
        )
    })
}

async function gifToMp4(gifBuffer) {
    const id = crypto.randomBytes(6).toString('hex')

    const inPath = path.join(
        os.tmpdir(),
        `anime_in_${id}.gif`
    )

    const outPath = path.join(
        os.tmpdir(),
        `anime_out_${id}.mp4`
    )

    try {
        fs.writeFileSync(inPath, gifBuffer)

        await runFfmpeg([
            '-i',
            inPath,
            '-movflags',
            'faststart',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-preset',
            'ultrafast',
            '-an',
            '-y',
            outPath
        ])

        return fs.readFileSync(outPath)
    } finally {
        try {
            fs.unlinkSync(inPath)
        } catch (_) {}

        try {
            fs.unlinkSync(outPath)
        } catch (_) {}
    }
}

/*
 * Extract the quoted WhatsApp participant.
 *
 * When:
 *
 *   Charles replies to John's message
 *   ".anime slap"
 *
 * quoted.participant = John's JID
 *
 * This is the person the reaction is directed at.
 */
function getQuotedContext(message) {
    const m = message?.message

    if (!m) return null

    return (
        m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        m.audioMessage?.contextInfo ||
        m.stickerMessage?.contextInfo ||
        m.buttonsResponseMessage?.contextInfo ||
        m.listResponseMessage?.contextInfo ||
        m.templateButtonReplyMessage?.contextInfo ||
        null
    )
}

const run = async ({
    sock,
    from,
    message,
    args
}) => {
    console.log(
        '[ANIME] command triggered, node version:',
        process.version
    )

    const action = (args[0] || '')
        .toLowerCase()
        .trim()

    const reaction = REACTIONS[action]

    if (!action) {
        const cmds = Object.keys(REACTIONS).join('  ')

        return sock.sendMessage(
            from,
            {
                text:
`╔═══════════════════════════════════╗
║  🎌 *ZENX — ANIME*               ║
╚═══════════════════════════════════╝

📌 *Usage:* _.anime <action>_
Reply to someone for best effect!

🔥 *Available:*
${cmds}

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
            },
            {
                quoted: message
            }
        )
    }

    if (!reaction) {
        const all = Object.keys(REACTIONS).join(', ')

        return sock.sendMessage(
            from,
            {
                text:
`❌ *Unknown:* _${action}_

${all}`
            },
            {
                quoted: message
            }
        )
    }

    /*
     * COMMAND SENDER
     *
     * In a group message:
     *   msg.key.participant
     * is the person who sent ".anime slap".
     */
    const senderJid =
        msg.key.participant ||
        msg.key.remoteJid

    const senderTag =
        `@${senderJid.split('@')[0]}`

    /*
     * REPLIED-TO PERSON
     *
     * If the command is sent as a WhatsApp reply,
     * use the participant of the quoted message.
     */
    const quotedContext =
        getQuotedContext(message)

    const targetJid =
        quotedContext?.participant ||
        null

    const targetTag =
        targetJid
            ? `@${targetJid.split('@')[0]}`
            : 'the air 🌬️'

    /*
     * IMPORTANT:
     *
     * Only ONE pair of WhatsApp bold markers.
     *
     * Result:
     *
     * *🫲🏻 @Charles slapped @John*
     *
     * WhatsApp renders the text in its native bold style.
     */
    const actionText =
        reaction.text(
            senderTag,
            targetTag
        )

    const caption =
        `${reaction.emoji} *${actionText}*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

    const mentions = [
        senderJid
    ]

    if (targetJid) {
        mentions.push(targetJid)
    }

    /*
     * React to the command message.
     */
    const reactPromise =
        sock.sendMessage(
            from,
            {
                react: {
                    text: reaction.emoji,
                    key: msg.key
                }
            }
        ).catch(() => {})

    /*
     * Get reaction GIF.
     */
    const gifUrl =
        await getGifUrl(
            action,
            sock,
            from,
            message
        )

    await reactPromise

    /*
     * No GIF available.
     *
     * Still send the correctly formatted
     * WhatsApp bold reaction text.
     */
    if (!gifUrl) {
        return sock.sendMessage(
            from,
            {
                text: caption,
                mentions
            },
            {
                quoted: message
            }
        )
    }

    let gifBuffer

    try {
        gifBuffer =
            await fetchBuffer(gifUrl)
    } catch (err) {
        console.error(
            '[ANIME] fetchBuffer failed:',
            err.message
        )

        return sock.sendMessage(
            from,
            {
                image: {
                    url: gifUrl
                },
                caption,
                mentions
            },
            {
                quoted: message
            }
        ).catch(async () => {
            await sock.sendMessage(
                from,
                {
                    text: caption,
                    mentions
                },
                {
                    quoted: message
                }
            )
        })
    }

    /*
     * Convert GIF → MP4 so WhatsApp
     * plays it like an animated GIF.
     */
    try {
        const mp4Buffer =
            await gifToMp4(gifBuffer)

        await sock.sendMessage(
            from,
            {
                video: mp4Buffer,
                gifPlayback: true,
                caption,
                mentions
            },
            {
                quoted: message
            }
        )
    } catch (err) {
        console.error(
            '[ANIME] gif conversion failed:',
            err.message
        )

        try {
            await sock.sendMessage(
                from,
                {
                    image: gifBuffer,
                    caption,
                    mentions
                },
                {
                    quoted: message
                }
            )
        } catch (err2) {
            console.error(
                '[ANIME] image fallback also failed:',
                err2.message
            )

            await sock.sendMessage(
                from,
                {
                    text: caption,
                    mentions
                },
                {
                    quoted: message
                }
            )
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
