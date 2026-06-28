'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/wasted.js  —  CYBER X  |  💀 GTA Wasted Effect
//  Usage: .wasted @user  OR  reply to someone + .wasted
//  Reaction: 💀 | Category: fun
// ════════════════════════════════════════════════════════════════════

module.exports = {
    pattern:  'wasted',
    alias:    ['gta'],
    category: 'fun',
    desc:     'GTA wasted effect on someone\'s profile pic',
    usage:    '.wasted @user',

    run: async ({ sock, from, msg, sender, args, isOwner }) => {

        // ── React instantly ────────────────────────────────────
        sock.sendMessage(from, { react: { text: '💀', key: msg.key } }).catch(() => {})

        // ── Detect target ──────────────────────────────────────
        const quoted  = msg.message?.extendedTextMessage?.contextInfo
        const mentioned = quoted?.mentionedJid?.[0] || null
        const replyJid  = quoted?.participant || quoted?.remoteJid || null

        // Priority: reply target → @mention → self
        let targetJid = replyJid || mentioned || sender
        targetJid = targetJid.replace(/:\d+@/, '@')

        const targetNum = targetJid.split('@')[0]
        const targetTag = `@${targetNum}`

        // ── Fetch target profile picture ───────────────────────
        let ppUrl = null
        try {
            ppUrl = await sock.profilePictureUrl(targetJid, 'image')
        } catch {
            // No profile picture
        }

        if (!ppUrl) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════╗',
                    '║  💀  *C Y B E R  X  WASTED*  ║',
                    '╚══════════════════════════╝',
                    '',
                    `❌ *${targetTag} has no profile picture!*`,
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n'),
                mentions: [targetJid]
            }, { quoted: msg })
            return
        }

        // ── Apply wasted effect via API ────────────────────────
        // Uses nekos.best or popcat wasted API
        const wastedUrl = `https://api.popcat.xyz/wasted?image=${encodeURIComponent(ppUrl)}`

        try {
            const res = await fetch(wastedUrl, {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
            })

            if (!res.ok) throw new Error(`API error ${res.status}`)

            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('image')) throw new Error('Not an image response')

            const buf = Buffer.from(await res.arrayBuffer())

            await sock.sendMessage(from, {
                image: buf,
                caption: [
                    `💀 *${targetTag} got WASTED!*`,
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n'),
                mimetype: 'image/png',
                mentions: [targetJid]
            }, { quoted: msg })

        } catch (err) {
            console.error('[CYBER X] wasted error:', err.message)

            // Fallback: try canvacord-style API
            try {
                const fallbackUrl = `https://some-random-api.com/canvas/misc/wasted?avatar=${encodeURIComponent(ppUrl)}`
                const res2 = await fetch(fallbackUrl, {
                    signal: AbortSignal.timeout(15000),
                    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
                })
                if (!res2.ok) throw new Error('fallback failed')
                const buf2 = Buffer.from(await res2.arrayBuffer())
                await sock.sendMessage(from, {
                    image: buf2,
                    caption: [
                        `💀 *${targetTag} got WASTED!*`,
                        '',
                        '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                    ].join('\n'),
                    mimetype: 'image/png',
                    mentions: [targetJid]
                }, { quoted: msg })
            } catch {
                await sock.sendMessage(from, {
                    text: [
                        '╔══════════════════════════╗',
                        '║  💀  *C Y B E R  X  WASTED*  ║',
                        '╚══════════════════════════╝',
                        '',
                        '❌ *Could not apply wasted effect right now*',
                        '',
                        '🔄 Try again later',
                        '',
                        '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                    ].join('\n')
                }, { quoted: msg })
            }
        }
    }
}
