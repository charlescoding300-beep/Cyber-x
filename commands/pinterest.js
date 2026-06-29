'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/pinterest.js  —  CYBER X  |  🩸 Pinterest Image Search
//  Usage: .pinterest <query>
//  Reaction: 🩸 | Category: media
// ════════════════════════════════════════════════════════════════════

async function getPinterestImage(query) {
    const apis = [
        `https://api.popcat.xyz/pinterest?search=${encodeURIComponent(query)}`,
        `https://api.giftedtech.web.id/api/search/pinterest?apikey=gifted&query=${encodeURIComponent(query)}`,
    ]

    for (const url of apis) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(8000),
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            if (!res.ok) continue

            const data = await res.json()
            let results = []

            if (Array.isArray(data)) {
                results = data
            } else if (data?.result && Array.isArray(data.result)) {
                results = data.result
            } else if (data?.data && Array.isArray(data.data)) {
                results = data.data
            }

            if (results.length === 0) continue

            const random = results[Math.floor(Math.random() * results.length)]
            const imageUrl = typeof random === 'string' ? random : (random?.image || random?.url)

            if (imageUrl && imageUrl.startsWith('http')) {
                return imageUrl
            }
        } catch (e) {
            console.log(`[PINTEREST] API failed: ${e.message}`)
        }
    }
    return null
}

const run = async ({ sock, from, message, args, text }) => {
    const query = (text || args.join(' ')).trim()

    if (!query) {
        return sock.sendMessage(from, {
            text: `╔══════════════════════════════╗
║  🩸  *PINTEREST SEARCH*       ║
╚══════════════════════════════╝

❌ *No search query provided!*

📌 *Usage:*
  _.pinterest <search>_
  _.pin <search>_

🔥 *Examples:*
  _.pinterest anime wallpaper_
  _.pinterest aesthetic dark_
  _.pinterest cute cats_

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
        }, { quoted: message })
    }

    await sock.sendMessage(from, { react: { text: '🩸', key: message.key } }).catch(() => {})

    const imageUrl = await getPinterestImage(query)

    if (!imageUrl) {
        await sock.sendMessage(from, {
            text: `╔══════════════════════════════╗
║  🩸  *PINTEREST SEARCH*       ║
╚══════════════════════════════╝

❌ *No results for:* _"${query}"_

💡 Try different keywords

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
        }, { quoted: message })
        return
    }

    const caption = `🩸 *Pinterest* — _${query}_\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

    try {
        const res = await fetch(imageUrl, {
            signal: AbortSignal.timeout(10000),
            headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        if (!res.ok) throw new Error('fetch failed')

        const buf = Buffer.from(await res.arrayBuffer())
        await sock.sendMessage(from, {
            image: buf,
            caption,
            mimetype: 'image/jpeg'
        }, { quoted: message })

        await sock.sendMessage(from, { react: { text: '✅', key: message.key } }).catch(() => {})

    } catch (err) {
        console.error('[PINTEREST]', err.message)

        try {
            await sock.sendMessage(from, {
                image: { url: imageUrl },
                caption,
                mimetype: 'image/jpeg'
            }, { quoted: message })
        } catch {
            await sock.sendMessage(from, {
                text: `❌ *Could not load image*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
                quoted: message
            })
        }
    }
}

module.exports = {
    name: 'pinterest',
    aliases: ['pinterest', 'pin'],
    category: 'media',
    desc: 'Search Pinterest images',
    usage: '.pinterest <query>',
    run
}
