'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/pinterest.js  —  CYBER X  |  🩸 Pinterest Image Search
//  Usage: .pinterest <query>
//  Reaction: 🩸 | Category: media
// ════════════════════════════════════════════════════════════════════

async function tryPinterestAPI1(query) {
    const res = await fetch(
        `https://api.popcat.xyz/pinterest?search=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'CYBER-X-Bot/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const random = data[Math.floor(Math.random() * data.length)]
    return typeof random === 'string' ? random : random?.image || null
}

async function tryPinterestAPI2(query) {
    const res = await fetch(
        `https://api.giftedtech.web.id/api/search/pinterest?apikey=gifted&query=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'CYBER-X-Bot/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const results = data?.result || data?.data || []
    if (!Array.isArray(results) || results.length === 0) return null
    const random = results[Math.floor(Math.random() * results.length)]
    return typeof random === 'string' ? random : random?.url || random?.image || null
}

async function tryPinterestAPI3(query) {
    const res = await fetch(
        `https://some-random-api.com/search/pinterest?q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'CYBER-X-Bot/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const results = data?.data || data?.results || []
    if (!Array.isArray(results) || results.length === 0) return null
    const random = results[Math.floor(Math.random() * results.length)]
    return typeof random === 'string' ? random : random?.url || random?.image || null
}

async function getPinterestImage(query) {
    for (const fn of [tryPinterestAPI1, tryPinterestAPI2, tryPinterestAPI3]) {
        try {
            const url = await fn(query)
            if (url && url.startsWith('http')) return url
        } catch {}
    }
    return null
}

module.exports = {
    pattern:  'pinterest',
    alias:    ['pin'],
    category: 'download',
    desc:     'Search Pinterest images',
    usage:    '.pinterest <query>',

    run: async ({ sock, from, msg, args, text }) => {
        const query = text?.trim() || args?.join(' ')?.trim() || ''

        if (!query) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════╗',
                    '║  🩸  *C Y B E R  X  PINTEREST*  ║',
                    '╚══════════════════════════════╝',
                    '',
                    '❌ *No search query provided!*',
                    '',
                    '┌─────────────────────────────',
                    '│ 📌 *Usage:*',
                    '│  `.pinterest <search>`',
                    '│  `.pin <search>`',
                    '└─────────────────────────────',
                    '',
                    '🔥 *Examples:*',
                    '  `.pinterest anime wallpaper`',
                    '  `.pinterest aesthetic dark`',
                    '  `.pinterest cute cats`',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        // React 🩸
        sock.sendMessage(from, { react: { text: '🩸', key: msg.key } }).catch(() => {})

        const imageUrl = await getPinterestImage(query)

        if (!imageUrl) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════╗',
                    '║  🩸  *C Y B E R  X  PINTEREST*  ║',
                    '╚══════════════════════════════╝',
                    '',
                    `❌ *No results found for:* _"${query}"_`,
                    '',
                    '💡 Try different keywords',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        const caption = [
            `🩸 *Pinterest* — _${query}_`,
            '',
            '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
        ].join('\n')

        // Try buffer first, fallback to URL
        try {
            const res = await fetch(imageUrl, {
                signal: AbortSignal.timeout(12000),
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            if (!res.ok) throw new Error('fetch failed')
            const buf = Buffer.from(await res.arrayBuffer())
            await sock.sendMessage(from, {
                image: buf,
                caption,
                mimetype: 'image/jpeg'
            }, { quoted: msg })
        } catch {
            try {
                await sock.sendMessage(from, {
                    image: { url: imageUrl },
                    caption,
                    mimetype: 'image/jpeg'
                }, { quoted: msg })
            } catch {
                await sock.sendMessage(from, {
                    text: [
                        '╔══════════════════════════════╗',
                        '║  🩸  *C Y B E R  X  PINTEREST*  ║',
                        '╚══════════════════════════════╝',
                        '',
                        `❌ *Could not load image for:* _"${query}"_`,
                        '',
                        '🔄 Please try again',
                        '',
                        '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                    ].join('\n')
                }, { quoted: msg })
            }
        }
    }
}
