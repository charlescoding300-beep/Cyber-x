'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/news.js  —  CYBER X  |  📰 Latest News
//  Usage: .news <country>
//  Reaction: 📰 | Category: general
// ════════════════════════════════════════════════════════════════════

const GNEWS_KEY   = process.env.GNEWS_API_KEY || ''
const NEWSAPI_KEY = process.env.NEWSAPI_KEY   || ''

async function fetchGNews(query) {
    const key = GNEWS_KEY || '0d39b2898e16cf5bb48cdfbcf7e7d6f0'
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=5&sortby=publishedAt&apikey=${key}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`GNews ${res.status}`)
    const data = await res.json()
    return data?.articles || []
}

async function fetchNewsAPI(query) {
    if (!NEWSAPI_KEY) throw new Error('No NewsAPI key')
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=5&sortBy=publishedAt&apiKey=${NEWSAPI_KEY}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`NewsAPI ${res.status}`)
    const data = await res.json()
    return (data?.articles || []).map(a => ({
        title:       a.title,
        description: a.description,
        url:         a.url,
        source:      { name: a.source?.name },
        publishedAt: a.publishedAt,
        image:       a.urlToImage,
    }))
}

async function getNews(query) {
    for (const fn of [fetchGNews, fetchNewsAPI]) {
        try {
            const articles = await fn(query)
            if (articles?.length) return articles
        } catch {}
    }
    return null
}

function timeAgo(dateStr) {
    try {
        const diff = Date.now() - new Date(dateStr).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        const hrs = Math.floor(mins / 60)
        if (hrs < 24) return `${hrs}h ago`
        return `${Math.floor(hrs / 24)}d ago`
    } catch { return '' }
}

module.exports = {
    pattern:  'news',
    alias:    ['headlines'],
    category: 'general',
    desc:     'Get latest news by country',
    usage:    '.news <country>',

    run: async ({ sock, from, msg, text, args }) => {

        // React instantly
        sock.sendMessage(from, { react: { text: '📰', key: msg.key } }).catch(() => {})

        const query = text?.trim() || args?.join(' ')?.trim() || ''

        // ── No country provided ────────────────────────────────
        if (!query) {
            await sock.sendMessage(from, {
                text: [
                    '╔═══════════════════════════╗',
                    '║  📰  *C Y B E R  X  NEWS*  ║',
                    '╚═══════════════════════════╝',
                    '',
                    '❌ *No country provided!*',
                    '',
                    '┌─────────────────────────────',
                    '│ 📌 *Usage:*',
                    '│  `.news <country>`',
                    '└─────────────────────────────',
                    '',
                    '🔥 *Examples:*',
                    '  `.news Nigeria`',
                    '  `.news USA`',
                    '  `.news South Africa`',
                    '  `.news Ghana`',
                    '  `.news UK`',
                    '  `.news Japan`',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        // ── Fetch news ─────────────────────────────────────────
        const articles = await getNews(query)

        if (!articles || articles.length === 0) {
            await sock.sendMessage(from, {
                text: [
                    '╔═══════════════════════════╗',
                    '║  📰  *C Y B E R  X  NEWS*  ║',
                    '╚═══════════════════════════╝',
                    '',
                    `❌ *No news found for "${query}"*`,
                    '',
                    '💡 Try a different country name',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        // ── Build message ──────────────────────────────────────
        const lines = [
            '╔═══════════════════════════╗',
            '║  📰  *C Y B E R  X  NEWS*  ║',
            '╚═══════════════════════════╝',
            '',
            `🌍 *Latest News: ${query}*`,
            '',
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ]

        articles.slice(0, 5).forEach((a, i) => {
            const ago    = timeAgo(a.publishedAt)
            const source = a.source?.name || 'Unknown'
            lines.push(`*${i + 1}. ${a.title || 'No title'}*`)
            lines.push(`📡 ${source}  •  🕒 ${ago}`)
            if (a.description) {
                const desc = a.description.length > 120
                    ? a.description.slice(0, 117) + '...'
                    : a.description
                lines.push(`_${desc}_`)
            }
            if (a.url) lines.push(`🔗 ${a.url}`)
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        })

        lines.push('')
        lines.push('> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™')

        const caption = lines.join('\n')

        // ── Try image from first article ───────────────────────
        const firstImage = articles[0]?.image || null
        if (firstImage) {
            try {
                const imgRes = await fetch(firstImage, {
                    signal: AbortSignal.timeout(8000),
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                })
                if (imgRes.ok) {
                    const buf = Buffer.from(await imgRes.arrayBuffer())
                    await sock.sendMessage(from, {
                        image: buf,
                        caption,
                        mimetype: 'image/jpeg'
                    }, { quoted: msg })
                    return
                }
            } catch {}
        }

        // Fallback text only
        await sock.sendMessage(from, { text: caption }, { quoted: msg })
    }
}
