'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/qr.js  —  CYBER X  |  📷 QR Code Generator
//  Usage: .qr <text or link>
//  Reaction: 📷 | Category: utility
// ════════════════════════════════════════════════════════════════════

module.exports = {
    pattern:  'qr',
    alias:    ['qrcode'],
    category: 'utility',
    desc:     'Generate a QR code from any text or link',
    usage:    '.qr <text or link>',

    run: async ({ sock, from, msg, text, args }) => {

        // React instantly
        sock.sendMessage(from, { react: { text: '📷', key: msg.key } }).catch(() => {})

        const input = text?.trim() || args?.join(' ')?.trim() || ''

        if (!input) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║   📷  *C Y B E R  X  —  Q R*   ║',
                    '╚══════════════════════════════════╝',
                    '',
                    '🤖 *What is a QR Code?*',
                    'A QR code is a scannable image that stores',
                    'text, links, phone numbers, or any data.',
                    'Anyone can scan it with their phone camera',
                    'to instantly open the link or read the text.',
                    '',
                    '✨ *What this command can do:*',
                    '┌─────────────────────────────────',
                    '│ 🔗 Turn any link into a QR code',
                    '│ 💬 Turn any text into a QR code',
                    '│ 📞 Turn a phone number into a QR code',
                    '│ 📧 Turn an email address into a QR code',
                    '│ 📍 Turn a location link into a QR code',
                    '└─────────────────────────────────',
                    '',
                    '📌 *How to use it:*',
                    '  Just type `.qr` followed by whatever',
                    '  you want to turn into a QR code.',
                    '',
                    '🔥 *Examples:*',
                    '  `.qr https://cyber-x-y8yv.onrender.com/pair`',
                    '  `.qr Hello World`',
                    '  `.qr +2348012345678`',
                    '  `.qr info@example.com`',
                    '',
                    '📱 *How to scan the QR code:*',
                    '  Open your phone camera app, point it',
                    '  at the QR image and tap the link that',
                    '  pops up. It will open in your browser.',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        // ── API chain ──────────────────────────────────────────
        // 1. api.qrserver.com — most reliable, no key needed
        // 2. quickchart.io — fallback
        // 3. goqr.me — second fallback

        const apis = [
            `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(input)}&format=png&color=000000&bgcolor=ffffff&qzone=2`,
            `https://quickchart.io/qr?text=${encodeURIComponent(input)}&size=512&format=png`,
            `https://api.goqr.me/qr.png?data=${encodeURIComponent(input)}&size=512x512`,
        ]

        let qrBuf = null
        for (const url of apis) {
            try {
                const res = await fetch(url, {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
                })
                if (!res.ok) continue
                const ct = res.headers.get('content-type') || ''
                if (!ct.includes('image')) continue
                qrBuf = Buffer.from(await res.arrayBuffer())
                break
            } catch {}
        }

        if (!qrBuf) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║   📷  *C Y B E R  X  —  Q R*   ║',
                    '╚══════════════════════════════════╝',
                    '',
                    '❌ *Failed to generate QR code*',
                    '',
                    '🔄 Please try again later',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        // Trim display text if too long
        const display = input.length > 60 ? input.slice(0, 57) + '...' : input

        await sock.sendMessage(from, {
            image: qrBuf,
            caption: [
                '╔══════════════════════════════════╗',
                '║   📷  *C Y B E R  X  —  Q R*   ║',
                '╚══════════════════════════════════╝',
                '',
                `📝 *Content:* ${display}`,
                '',
                '📱 *Scan with your camera to open*',
                '',
                '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
            ].join('\n'),
            mimetype: 'image/png'
        }, { quoted: msg })
    }
}
