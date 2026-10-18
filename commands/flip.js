'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/flip.js — .flip   (category: fun)
//  A fair 50/50 coin, from a cryptographically secure random source.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto')

module.exports = {
  name: 'flip',
  aliases: ['coin', 'coinflip'],
  desc: 'Flip a coin: heads or tails (50/50)',
  usage: '.flip',
  category: 'fun',

  run: async ({ sock, from, msg }) => {
    const result = crypto.randomInt(0, 2) === 0 ? 'Heads' : 'Tails'
    const body =
      '╭───「 COIN FLIP 」───╮\n' +
      `│ 🪙 Result: ${result}!\n` +
      '╰─────────────────────╯'
    return sock.sendMessage(from, { text: body }, { quoted: msg })
  },
}
