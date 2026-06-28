'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/wasted.js  —  CYBER X  |  💀 GTA Wasted Effect
//  Usage: .wasted @user  OR  reply to someone + .wasted
//  Fetches profile picture automatically and applies wasted effect
//  Reaction: 💀 | Category: fun
// ════════════════════════════════════════════════════════════════════

module.exports = {
    name:     'wasted',
    aliases:  ['wasted', 'gta'],
    category: 'fun',
    desc:     'GTA wasted effect on someone\'s profile pic',
    usage:    '.wasted @user | reply to message',

    run: async ({ sock, from, msg, sender, args }) => {

        // ── React instantly ────────────────────────────────────
        await sock.sendMessage(from, { react: { text: '💀', key: msg.key } }).catch(() => {})

        // ── Detect target (reply or mention) ────────────────────
        const quoted  = msg.message?.extendedTextMessage?.contextInfo
        const mentioned = quoted?.mentionedJid?.[0] || null
        const replyJid  = quoted?.participant || null

        // Priority: reply target → @mention → self
        let targetJid = replyJid || mentioned || sender
        targetJid = targetJid.replace(/:\d+@/, '@')

        const targetNum = targetJid.split('@')[0]
        const targetTag = `@${targetNum}`

        // ── Fetch target profile picture ───────────────────────
        let ppUrl = null
        try {
            ppUrl = await sock.profilePictureUrl(targetJid, 'image')
        } catch (e) {
            console.log(`[WASTED] No PP for ${targetNum}:`, e.message)
        }

        if (!ppUrl) {
            await sock.sendMessage(from, {
                text: `╔════════════════════════╗\n║  💀 *WASTED* 💀       ║\n╚════════════════════════╝\n\n❌ *${targetTag} has no profile picture!*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
                mentions: [targetJid]
            }, { quoted: msg })
            return
        }

        // ── Thinking message ───────────────────────────────────
        const thinkMsg = await sock.sendMessage(from, {
            text: `💀 *Applying WASTED effect on ${targetTag}...*`
        }, { quoted: msg }).catch(() => null)

        // ── Apply wasted effect via API ────────────────────────
        try {
            const wastedUrl = `https://api.popcat.xyz/wasted?image=${encodeURIComponent(ppUrl)}`

            const res = await fetch(wastedUrl, {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
            })

            if (!res.ok) throw new Error(`API error ${res.status}`)

            const contentType = res.headers.get('content-type') || ''
            if (!contentType.includes('image')) throw new Error('Not an image response')

            const buf = Buffer.from(await res.arrayBuffer())

            // Delete thinking message
            if (thinkMsg) {
                try { await sock.sendMessage(from, { delete: thinkMsg.key }) } catch () {}
            }

            // Send wasted image
            await sock.sendMessage(from, {
                image: buf,
                caption: `💀 *${targetTag} got WASTED!*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
                mimetype: 'image/png',
                mentions: [targetJid]
            }, { quoted: msg })

            await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})

        } catch (err) {
            console.error('[WASTED] popcat error:', err.message)

            // ── Fallback: try other wasted API ─────────────────
            try {
                const fallbackUrl = `https://some-random-api.com/canvas/misc/wasted?avatar=${encodeURIComponent(ppUrl)}`
                const res2 = await fetch(fallbackUrl, {
                    signal: AbortSignal.timeout(15000),
                    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
                })

                if (!res2.ok) throw new Error('fallback failed')

                const buf2 = Buffer.from(await res2.arrayBuffer())

                if (thinkMsg) {
                    try { await sock.sendMessage(from, { delete: thinkMsg.key }) } catch () {}
                }

                await sock.sendMessage(from, {
                    image: buf2,
                    caption: `💀 *${targetTag} got WASTED!*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
                    mimetype: 'image/png',
                    mentions: [targetJid]
                }, { quoted: msg })

                await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})

            } catch (fallbackErr) {
                console.error('[WASTED] all APIs failed:', fallbackErr.message)

                if (thinkMsg) {
                    try { await sock.sendMessage(from, { delete: thinkMsg.key }) } catch () {}
                }

                await sock.sendMessage(from, {
                    text: `╔════════════════════════╗\n║  💀 *WASTED* 💀       ║\n╚════════════════════════╝\n\n❌ *Could not apply wasted effect right now*\n\n🔄 Try again later\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
                    mentions: [targetJid]
                }, { quoted: msg })

                await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
            }
        }
    }
}
