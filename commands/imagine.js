'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — IMAGINE COMMAND
//  Usage: .imagine <description>
//  1. Groq writes vivid scene description
//  2. Builds detailed AI image prompt
//  3. Generates actual image via Pollinations.ai (no key needed)
//  Anyone can use | Category: ai
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const https = require('https')
const http  = require('http')

const CREDIT =
`*╭══ ✕-CYBER X ⚡*
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

async function askGroq(userInput) {
    const GROQ_KEY = process.env.GROQ_API_KEY
    if (!GROQ_KEY) throw new Error('GROQ_API_KEY not set')

    const body = JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        max_tokens:  1000,
        temperature: 0.9,
        messages: [
            {
                role:    'system',
                content: `You are a creative AI assistant and expert image prompt engineer.
When given a scene idea, you must respond with EXACTLY this JSON format and nothing else:
{
  "scene": "A vivid, immersive 3-4 sentence description of the scene written like a short story. Make it dramatic, beautiful and imaginative.",
  "prompt": "A detailed Midjourney/DALL-E/Stable Diffusion image prompt under 200 words. Include: art style, lighting, colors, mood, camera angle, quality tags like (masterpiece, ultra-detailed, 8k, photorealistic)"
}
Only return valid JSON. No extra text, no markdown, no explanation.`
            },
            {
                role:    'user',
                content: userInput,
            }
        ]
    })

    const data = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.groq.com',
            path:     '/openai/v1/chat/completions',
            method:   'POST',
            headers: {
                'Content-Type':   'application/json',
                'Authorization':  `Bearer ${GROQ_KEY}`,
                'Content-Length': Buffer.byteLength(body),
            }
        }, res => {
            let d = ''
            res.on('data', c => d += c)
            res.on('end',  () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
        })
        req.on('error', reject)
        req.setTimeout(30000, () => req.destroy())
        req.write(body)
        req.end()
    })

    const raw = data?.choices?.[0]?.message?.content
    if (!raw) throw new Error('Groq returned empty response')

    try {
        const clean = raw.replace(/```json|```/g, '').trim()
        return JSON.parse(clean)
    } catch {
        throw new Error('Could not parse AI response')
    }
}

async function generateImage(prompt) {
    const encoded = encodeURIComponent(prompt)
    const url     = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`

    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: 60000 }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                const redirectUrl = res.headers.location
                if (!redirectUrl) return reject(new Error('Redirect with no location'))
                const lib    = redirectUrl.startsWith('https') ? https : http
                const redReq = lib.get(redirectUrl, { timeout: 60000 }, redRes => {
                    const chunks = []
                    redRes.on('data', c => chunks.push(c))
                    redRes.on('end',  () => resolve(Buffer.concat(chunks)))
                    redRes.on('error', reject)
                })
                redReq.on('error', reject)
                return
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
            const chunks = []
            res.on('data',  c => chunks.push(c))
            res.on('end',   () => resolve(Buffer.concat(chunks)))
            res.on('error', reject)
        })
        req.on('error',   reject)
        req.on('timeout', () => req.destroy())
    })
}

const run = async ({ sock, from, message, text, args }) => {

    const input = (text || args.join(' ')).trim()

    if (!input) {
        return sock.sendMessage(from, {
            text:
`╔═══════════════════════════╗
║  🎨 *CYBER X — IMAGINE*   ║
╚═══════════════════════════╝

✨ *Bring any idea to life!*

I will:
1️⃣ Write a vivid scene description
2️⃣ Build a detailed AI image prompt
3️⃣ Generate an actual image 🖼️

📌 *Usage:*
  _.imagine <your idea>_

🔥 *Examples:*
  _.imagine a dragon flying over Lagos at sunset_
  _.imagine a cyberpunk city in the rain_
  _.imagine a samurai warrior in space_
  _.imagine underwater kingdom with glowing fish_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            quoted: message
        })
    }

    await sock.sendMessage(from, {
        react: { text: '🎨', key: message.key }
    }).catch(() => {})

    const thinkMsg = await sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🎨 *CYBER X — IMAGINE*   ║
╚═══════════════════════════╝

✨ *Imagining:* _"${input}"_

⏳ *Step 1:* Writing your scene...
🖊️ *Step 2:* Building image prompt...
🖼️ *Step 3:* Generating image...

Please wait! 🔥`,
    }, { quoted: message })

    try {
        let aiResult
        try {
            aiResult = await askGroq(input)
        } catch (e) {
            throw new Error(`AI failed: ${e.message}`)
        }

        const scene  = aiResult?.scene  || 'A breathtaking scene unfolds before your eyes...'
        const prompt = aiResult?.prompt || input

        let imgBuffer = null
        try {
            imgBuffer = await generateImage(prompt)
        } catch (e) {
            console.warn('[IMAGINE] Image generation failed:', e.message)
        }

        sock.sendMessage(from, { delete: thinkMsg.key }).catch(() => {})

        const caption =
`╔═══════════════════════════╗
║  🎨 *CYBER X — IMAGINE*   ║
╚═══════════════════════════╝

✨ *"${input}"*

━━━━━━━━━━━━━━━━━━━━━━━━━━
🖊️ *SCENE*
${scene}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *IMAGE PROMPT*
_${prompt}_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`

        if (imgBuffer && imgBuffer.length > 1000) {
            await sock.sendMessage(from, {
                image:    imgBuffer,
                caption,
                mimetype: 'image/jpeg',
            }, { quoted: message })
        } else {
            await sock.sendMessage(from, {
                text: caption + '\n\n⚠️ _Image generation unavailable — use the prompt above on Midjourney or DALL-E!_',
            }, { quoted: message })
        }

        await sock.sendMessage(from, {
            react: { text: '✅', key: message.key }
        }).catch(() => {})

    } catch (err) {
        console.error('[IMAGINE]', err.message)
        sock.sendMessage(from, { delete: thinkMsg.key }).catch(() => {})

        await sock.sendMessage(from, {
            react: { text: '❌', key: message.key }
        }).catch(() => {})

        await sock.sendMessage(from, {
            text:
`❌ *Failed to imagine that.*
_${err.message}_

Try rephrasing your description and try again!

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            quoted: message
        })
    }
}

module.exports = {
    name:     'imagine',
    aliases:  ['img', 'generate', 'draw'],
    category: 'ai',
    desc:     'Imagine anything — AI describes it, builds a prompt, and generates the image',
    usage:    '.imagine <description>',
    run
}
