'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/tts.js  —  CYBER X  |  🔊 Text to Speech
//  Usage: .tts <text>
//  Reaction: 🔊 | Category: utility
// ════════════════════════════════════════════════════════════════════

async function getTTSAudio(text) {
    const apis = [
        `https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`,
        `https://api.popcat.xyz/tts?text=${encodeURIComponent(text)}`,
    ]

    for (const url of apis) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            if (!res.ok) continue

            const data = await res.json()
            let audioUrl = null

            if (typeof data === 'string' && data.startsWith('http')) {
                audioUrl = data
            } else if (data?.data) {
                audioUrl = data.data.URL || data.data.url
                if (!audioUrl && data.data.MP3) audioUrl = `https://ttsmp3.com/created_mp3_ai/${data.data.MP3}`
            } else if (data?.url) {
                audioUrl = data.url
            } else if (data?.buffer) {
                return Buffer.from(data.buffer.data || [])
            }

            if (audioUrl && audioUrl.startsWith('http')) {
                const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(10000) })
                if (audioRes.ok) {
                    return Buffer.from(await audioRes.arrayBuffer())
                }
            }
        } catch (e) {
            console.log(`[TTS] API failed: ${e.message}`)
        }
    }
    return null
}

const run = async ({ sock, from, message, text, args }) => {

    await sock.sendMessage(from, { react: { text: '🔊', key: message.key } }).catch(() => {})

    const input = (text || args.join(' ')).trim()

    if (!input) {
        return sock.sendMessage(from, {
            text: `╔══════════════════════════════════╗
║  🔊  *CYBER X — TTS*            ║
╚══════════════════════════════════╝

🤖 *Text to Speech*
Convert text into real voice audio!

✨ *What you can do:*
  • 💬 Convert any text to audio
  • 📢 Send voice messages
  • 🌐 Works with any language

📌 *Usage:*
  _.tts <your text>_
  _.say <your text>_

🔥 *Examples:*
  _.tts Hello everyone!_
  _.say Welcome to CYBER X_
  _.tts Good morning fam_

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
        }, { quoted: message })
    }

    try {
        const audioBuffer = await getTTSAudio(input)

        if (!audioBuffer) {
            throw new Error('No audio generated')
        }

        const display = input.length > 60 ? input.slice(0, 57) + '...' : input

        await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: 'audio/mpeg',
            ptt: true,
        }, { quoted: message })

        await sock.sendMessage(from, {
            text: `╔══════════════════════════════════╗
║  🔊  *CYBER X — TTS*            ║
╚══════════════════════════════════╝

📝 *Text:* ${display}

✅ *Audio generated!*

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
            quoted: message
        })

        await sock.sendMessage(from, { react: { text: '✅', key: message.key } }).catch(() => {})

    } catch (e) {
        console.error('[TTS]', e.message)

        await sock.sendMessage(from, {
            react: { text: '❌', key: message.key }
        }).catch(() => {})

        await sock.sendMessage(from, {
            text: `❌ *Failed to generate audio*

🔄 Try again later

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
            quoted: message
        })
    }
}

module.exports = {
    name: 'tts',
    aliases: ['tts', 'say'],
    category: 'media',
    desc: 'Convert text to speech audio',
    usage: '.tts <text>',
    run
}
