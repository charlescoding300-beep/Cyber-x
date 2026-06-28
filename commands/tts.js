'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/tts.js  —  CYBER X  |  🔊 Text to Speech
//  Usage: .tts <text>
//  Reaction: 🔊 | Category: utility
// ════════════════════════════════════════════════════════════════════

const axios = require('axios')

module.exports = {
    pattern:  'tts',
    alias:    ['say'],
    category: 'utility',
    desc:     'Convert text to speech audio',
    usage:    '.tts <text>',

    run: async ({ sock, from, msg, text, args }) => {

        sock.sendMessage(from, { react: { text: '🔊', key: msg.key } }).catch(() => {})

        const input = text?.trim() || args?.join(' ')?.trim() || ''

        if (!input) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║  🔊  *C Y B E R  X  —  T T S*  ║',
                    '╚══════════════════════════════════╝',
                    '',
                    '🤖 *What is Text to Speech?*',
                    'This command converts any text you type',
                    'into a real voice audio message.',
                    '',
                    '✨ *What you can do:*',
                    '┌─────────────────────────────────',
                    '│ 💬 Convert any sentence to audio',
                    '│ 📢 Send voice messages via text',
                    '│ 🌐 Works with any language',
                    '└─────────────────────────────────',
                    '',
                    '📌 *How to use:*',
                    '  `.tts <your text>`',
                    '  `.say <your text>`',
                    '',
                    '🔥 *Examples:*',
                    '  `.tts Hello everyone!`',
                    '  `.say Welcome to CYBER X`',
                    '  `.tts Good morning fam`',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
            return
        }

        try {
            const apiUrl = `https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(input)}`
            const res = await axios.get(apiUrl, {
                timeout: 30000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            })

            let audioUrl = null

            if (res.data) {
                if (typeof res.data === 'string' && res.data.startsWith('http')) {
                    audioUrl = res.data
                } else if (res.data.data) {
                    const d = res.data.data
                    audioUrl = d.URL || d.url
                    if (!audioUrl && d.MP3) audioUrl = `https://ttsmp3.com/created_mp3_ai/${d.MP3}`
                    if (!audioUrl && d.mp3) audioUrl = `https://ttsmp3.com/created_mp3_ai/${d.mp3}`
                } else {
                    audioUrl = res.data.URL || res.data.url
                    if (!audioUrl && res.data.MP3) audioUrl = `https://ttsmp3.com/created_mp3_ai/${res.data.MP3}`
                }
            }

            if (!audioUrl) throw new Error('No audio URL returned')

            const display = input.length > 60 ? input.slice(0, 57) + '...' : input

            await sock.sendMessage(from, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                ptt: true,
            }, { quoted: msg })

            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║  🔊  *C Y B E R  X  —  T T S*  ║',
                    '╚══════════════════════════════════╝',
                    '',
                    `📝 *Text:* ${display}`,
                    '',
                    '✅ *Audio generated successfully!*',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })

        } catch (e) {
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════╗',
                    '║  🔊  *C Y B E R  X  —  T T S*  ║',
                    '╚══════════════════════════════════╝',
                    '',
                    '❌ *Failed to generate audio*',
                    '',
                    '🔄 Please try again later',
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
                ].join('\n')
            }, { quoted: msg })
        }
    }
}
