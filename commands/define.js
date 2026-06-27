// commands/define.js — CYBER X Dictionary Command
'use strict'

const https = require('https')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

async function fetchDefinition(word) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
      res => {
        let d = ''
        res.on('data', c => d += c)
        res.on('end', () => {
          try { resolve(JSON.parse(d)) } catch { resolve(null) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy())
  })
}

function formatPartOfSpeech(pos) {
  const map = {
    noun:        '📦 *Noun*',
    verb:        '⚡ *Verb*',
    adjective:   '🎨 *Adjective*',
    adverb:      '💨 *Adverb*',
    pronoun:     '👤 *Pronoun*',
    preposition: '🔗 *Preposition*',
    conjunction: '🔀 *Conjunction*',
    interjection:'😲 *Interjection*',
    exclamation: '❗ *Exclamation*',
  }
  return map[pos?.toLowerCase()] || `📝 *${pos}*`
}

module.exports = {
  pattern:  'define',
  alias:    ['dict', 'dictionary', 'meaning'],
  category: 'utility',
  desc:     'Get the dictionary definition of any word',
  usage:    '.define <word>',

  run: async ({ sock, from, msg, args, text }) => {

    // ── React immediately ──
    sock.sendMessage(from, { react: { text: '📖', key: msg.key } }).catch(() => {})

    const word = (text || args.join(' ')).trim().toLowerCase()

    if (!word) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  📖 *CYBER X DICTIONARY*  ║
╚═══════════════════════════╝

*How to use:*
• *.define <word>* — Get definition
• *.dict <word>* — Also works
• *.meaning <word>* — Also works

💡 *Examples:*
  _.define love_
  _.define intelligence_
  _.define ephemeral_
  _.define serendipity_

> Supports any English word in existence!

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send searching message ──
    const searchMsg = await sock.sendMessage(from, {
      text: `📖 *Looking up:* _${word}_...`,
    }, { quoted: msg })

    try {
      const data = await fetchDefinition(word)

      // ── Word not found ──
      if (!data || !Array.isArray(data) || data[0]?.title === 'No Definitions Found') {
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        return sock.sendMessage(from, {
          text:
`📖 *Word not found:* _${word}_

❌ This word wasn't found in the dictionary.

*Try:*
• Check the spelling
• Try a different form of the word
  _Example: use "run" instead of "running"_

${CREDIT}`,
          quoted: msg
        })
      }

      const entry    = data[0]
      const wordText = entry.word || word
      const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || ''
      const origin   = entry.origin || null
      const meanings = entry.meanings || []

      // ── Build definition output ──
      let output =
`╔═══════════════════════════╗
║  📖 *CYBER X DICTIONARY*  ║
╚═══════════════════════════╝

📝 *Word:* ${wordText.toUpperCase()}
${phonetic ? `🔊 *Phonetic:* ${phonetic}` : ''}
${origin ? `🌍 *Origin:* ${origin}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━`

      // ── Loop through meanings ──
      for (const meaning of meanings.slice(0, 3)) {
        const pos  = formatPartOfSpeech(meaning.partOfSpeech)
        const defs = meaning.definitions?.slice(0, 2) || []
        const syns = meaning.synonyms?.slice(0, 4)    || []
        const ants = meaning.antonyms?.slice(0, 4)    || []

        output += `\n\n${pos}\n`

        defs.forEach((d, i) => {
          output += `\n*${i + 1}.* ${d.definition}`
          if (d.example) output += `\n   💬 _"${d.example}"_`
        })

        if (syns.length) output += `\n\n✅ *Synonyms:* ${syns.join(', ')}`
        if (ants.length) output += `\n❌ *Antonyms:* ${ants.join(', ')}`

        output += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      }

      output += `\n\n${CREDIT}`

      // ── Delete searching message ──
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      // ── Send definition ──
      await sock.sendMessage(from, {
        text: output,
        quoted: msg
      })

      // ── React success ──
      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

    } catch (e) {
      sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[DEFINE]', e.message)

      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      await sock.sendMessage(from, {
        text: `❌ *Failed to fetch definition.*\nPlease try again.\n\n${CREDIT}`,
        quoted: msg
      })
    }
  }
}
