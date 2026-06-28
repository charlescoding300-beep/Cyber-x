// commands/joke.js — CYBER X Joke Command
'use strict'

const { getRandom, getByCategory, JOKES } = require('../lib/jokes')

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

const command = {
  pattern:  'joke',
  alias:    ['jokes', 'funny', 'lol'],
  category: 'fun',
  desc:     'Get a random joke — 150+ jokes inside',
  usage:    '.joke | .joke naija | .joke tech | .joke school',

  run: async ({ sock, from, msg, text, args }) => {

    const category = (text || args.join(' ')).trim().toLowerCase()

    // ── Get joke ──
    const joke = category ? getByCategory(category) : getRandom()

    // ── Auto react 😅 ──
    await sock.sendMessage(from, {
      react: { text: '😅', key: msg.key }
    }).catch(() => {})

    // ── Categories help ──
    if (category === 'help' || category === 'list') {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  😅 *CYBER X JOKES*       ║
╚═══════════════════════════╝

*Categories:*
• *.joke* — Random joke
• *.joke naija* — Nigerian jokes
• *.joke tech* — Tech/programmer jokes
• *.joke school* — School jokes
• *.joke food* — Food jokes
• *.joke work* — Work/office jokes
• *.joke puns* — Puns & wordplay

📊 *Total jokes:* ${JOKES.length}+

${CREDIT}`,
        quoted: msg
      })
    }

    // ── Send joke ──
    await sock.sendMessage(from, {
      text:
`╔═══════════════════════════╗
║  😅 *CYBER X JOKES*       ║
╚═══════════════════════════╝

${joke}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Type_ *.joke* _for another one!_
📊 _${JOKES.length}+ jokes available_

${CREDIT}`,
      quoted: msg
    })

    // ── React success ──
    await sock.sendMessage(from, {
      react: { text: '😂', key: msg.key }
    }).catch(() => {})
  }
}

module.exports = command
