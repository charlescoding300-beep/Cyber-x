'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/botpp.js  —  CYBER X  |  Set Bot Menu Profile Picture
//  Per-session: each linked number has its own menu picture
//  Usage: Reply to an image + .botpp
//  Owner only | Category: owner
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

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

function saveBotPP(phone, data) {
    try {
        const file = getBotPPFile(phone)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(data, null, 2))
    } catch (e) {
        console.error(`[BOTPP:${phone}] save error:`, e.message)
    }
}

module.exports = {
    pattern:  'botpp',
    desc:     'Set this session\'s menu picture (reply to an image)',
    usage:    '.botpp — reply to image | .botpp remove — clear',
    category: 'owner',

    async run({ sock, from, msg, args, isOwner, settings }) {
        if (!isOwner) {
            await sock.sendMessage(from, { text: '❌ *Owner only command.*' }, { quoted: msg })
            return
        }

        // ── Get this session's phone number ───────────────────────
        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        if (!phone) {
            await sock.sendMessage(from, { text: '❌ *Could not detect session phone number.*' }, { quoted: msg })
            return
        }

        // ── .botpp remove ─────────────────────────────────────────
        if ((args[0] || '').toLowerCase() === 'remove') {
            const data = loadBotPP(phone)
            if (!data.imageBase64) {
                await sock.sendMessage(from, {
                    text: '⚠️ *No custom picture is set for this session.*'
                }, { quoted: msg })
                return
            }
            saveBotPP(phone, {})
            await sock.sendMessage(from, {
                text: [
                    `✅ *Bot picture removed for session ${phone}!*`,
                    '',
                    'Menu will now use the fallback image.',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
                ].join('\n'),
            }, { quoted: msg })
            return
        }

        // ── Must reply to an image ────────────────────────────────
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
        const imgMsg    = quotedMsg?.imageMessage

        if (!imgMsg) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║  🖼️  *B O T  P I C T U R E*       ║',
                    '╚══════════════════════════════════╝',
                    '',
                    '❌ *Reply to an image to set the bot picture.*',
                    '',
                    '📌 *Usage:*',
                    '  Reply to any image + `.botpp`',
                    '  `.botpp remove` — clear picture for this session',
                    '',
                    `📱 *Session:* ${phone}`,
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
                ].join('\n'),
            }, { quoted: msg })
            return
        }

        // ── React while processing ────────────────────────────────
        await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } })

        // ── Download image via Baileys ────────────────────────────
        try {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
            const stream = await downloadContentFromMessage(imgMsg, 'image')
            const chunks = []
            for await (const chunk of stream) chunks.push(chunk)
            const buf    = Buffer.concat(chunks)
            const base64 = buf.toString('base64')
            const mime   = imgMsg.mimetype || 'image/jpeg'

            // ── Save to data/botpp_<phone>.json ───────────────────
            saveBotPP(phone, { imageBase64: base64, mimetype: mime, setAt: Date.now() })

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } })
            await sock.sendMessage(from, {
                text: [
                    '✅ *Bot picture updated!*',
                    '',
                    `📱 *Session:* ${phone}`,
                    'This picture is only for this session\'s menu.',
                    'It will survive Render restarts.',
                    'Use `.botpp remove` to clear it.',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
                ].join('\n'),
            }, { quoted: msg })

        } catch (e) {
            console.error(`[BOTPP:${phone}] download error:`, e.message)
            await sock.sendMessage(from, { react: { text: '❌', key: msg.key } })
            await sock.sendMessage(from, {
                text: '❌ *Failed to download image. Please try again.*',
            }, { quoted: msg })
        }
    },
}

