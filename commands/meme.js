'use strict'

const API_TIMEOUT_MS = 8_000
const IMAGE_TIMEOUT_MS = 10_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

function validHttpsUrl(value) {
    try {
        const url = new URL(value)
        return url.protocol === 'https:' && !url.username && !url.password
    } catch {
        return false
    }
}

function imageCandidates(meme) {
    const previews = Array.isArray(meme.preview) ? [...meme.preview].reverse() : []
    return [...new Set([...previews, meme.url].filter(validHttpsUrl))].slice(0, 3)
}

async function fetchImage(url) {
    const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        headers: {
            'User-Agent': 'ZENX-WhatsApp-Bot/1.0',
            Accept: 'image/jpeg,image/png,image/webp,image/gif,*/*;q=0.5'
        }
    })

    if (!response.ok) throw new Error(`image server returned HTTP ${response.status}`)

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!contentType.startsWith('image/')) throw new Error('meme URL did not return an image')

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        throw new Error('image is too large; trying a smaller preview')
    }

    if (!response.body) throw new Error('image response was empty')
    const reader = response.body.getReader()
    const chunks = []
    let total = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > MAX_IMAGE_BYTES) {
                await reader.cancel().catch(() => {})
                throw new Error('image is too large; trying a smaller preview')
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        reader.releaseLock()
    }

    if (!total) throw new Error('image response was empty')
    return Buffer.concat(chunks, total)
}

async function getMeme(subreddit) {
    const endpoint = subreddit
        ? `https://meme-api.com/gimme/${encodeURIComponent(subreddit)}`
        : 'https://meme-api.com/gimme'

    const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: { 'User-Agent': 'ZENX-WhatsApp-Bot/1.0', Accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`meme API returned HTTP ${response.status}`)

    const meme = await response.json()
    if (meme?.code === 404) throw new Error('subreddit not found or private')
    if (!meme || typeof meme !== 'object' || meme.nsfw || meme.over18) {
        throw new Error('the API did not return a safe meme')
    }
    if (!imageCandidates(meme).length) throw new Error('the API returned no usable image')
    return meme
}

const run = async ({ sock, from, message, msg, args = [] }) => {
    const quoted = message || msg
    const subreddit = (args[0] || '').toLowerCase().trim() || null

    // React in the background so a slow acknowledgement never holds up the image request.
    if (quoted?.key) {
        void sock.sendMessage(from, { react: { text: '😂', key: quoted.key } }).catch(() => {})
    }

    let meme
    try {
        meme = await getMeme(subreddit)
    } catch (err) {
        console.error('[MEME] API request failed:', err.message)
        return sock.sendMessage(from, {
            text: `❌ *Couldn't fetch a meme:* ${err.message}\n\nTry .meme with no subreddit, or a different one.\n\n${CREDIT}`
        }, { quoted })
    }

    const title = String(meme.title || 'Random meme').replace(/[\r\n]+/g, ' ').slice(0, 240)
    const community = String(meme.subreddit || subreddit || 'memes').replace(/[\r\n]/g, '').slice(0, 60)
    const score = Number.isFinite(Number(meme.ups)) ? Number(meme.ups).toLocaleString('en-US') : '—'
    const caption = `😂 *${title}*\n\n📌 r/${community} · 👍 ${score}\n\n${CREDIT}`

    let image
    let imageError
    for (const url of imageCandidates(meme)) {
        try {
            image = await fetchImage(url)
            break
        } catch (err) {
            imageError = err
        }
    }

    if (!image) {
        console.error('[MEME] image download failed:', imageError?.message || 'no image candidates')
        const link = validHttpsUrl(meme.postLink) ? meme.postLink : (validHttpsUrl(meme.url) ? meme.url : '')
        return sock.sendMessage(from, {
            text: `⚠️ I found the meme but couldn't download its picture.${link ? `\n${link}` : ''}\n\n${CREDIT}`
        }, { quoted })
    }

    try {
        // Upload immediately after the image bytes are ready; quote the command that requested it.
        return await sock.sendMessage(from, { image, caption }, { quoted })
    } catch (err) {
        console.error('[MEME] WhatsApp image send failed:', err.message)
        const link = validHttpsUrl(meme.postLink) ? meme.postLink : (validHttpsUrl(meme.url) ? meme.url : '')
        return sock.sendMessage(from, {
            text: `⚠️ The meme picture was ready, but WhatsApp could not send it.${link ? `\n${link}` : ''}\n\n${CREDIT}`
        }, { quoted })
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
