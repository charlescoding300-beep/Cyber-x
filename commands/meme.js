const https = require('https')

function fetchBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('too many redirects'))
        https.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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

async function getMeme(subreddit) {
    const url = subreddit
        ? `https://meme-api.com/gimme/${encodeURIComponent(subreddit)}`
        : `https://meme-api.com/gimme`

    const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json()
    if (json.code === 404) throw new Error('subreddit not found or private')
    return json
}

const run = async ({ sock, from, message, args }) => {
    const subreddit = (args[0] || '').toLowerCase().trim() || null

    await sock.sendMessage(from, { react: { text: '😂', key: message.key } }).catch(() => {})

    let meme
    try {
        meme = await getMeme(subreddit)
    } catch (err) {
        return sock.sendMessage(from, {
            text: `❌ *Couldn't fetch a meme:* _${err.message}_\n\nTry \`.meme\` with no subreddit, or a different one.\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
        }, { quoted: message })
    }

    const caption = `😂 *${meme.title}*\n\n📌 r/${meme.subreddit} · 👍 ${meme.ups}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

    try {
        const buf = await fetchBuffer(meme.url)
        await sock.sendMessage(from, { image: buf, caption }, { quoted: message })
    } catch (err) {
        console.error('[MEME] image send failed:', err.message)
        try {
            await sock.sendMessage(from, { image: { url: meme.url }, caption }, { quoted: message })
        } catch (err2) {
            await sock.sendMessage(from, { text: caption }, { quoted: message })
        }
    }
}

module.exports = {
    name: 'meme',
    aliases: ['meme', 'dankmeme'],
    category: 'fun',
    desc: 'Get a random meme from Reddit',
    usage: '.meme [subreddit]',
    run
}
