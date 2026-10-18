'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/dice.js — .dice   (category: fun)
//  A standard six-sided die (1 to 6), from a cryptographically secure random source.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto')

module.exports = {
  name: 'dice',
  aliases: ['roll', 'diceroll'],
  desc: 'Roll a six-sided die (1 to 6)',
  usage: '.dice',
  category: 'fun',

  run: async ({ sock, from, msg }) => {
    const n = crypto.randomInt(1, 7)
    const body =
      '╭───「 DICE ROLL 」───╮\n' +
      `│ 🎲 Result: ${n}\n` +
      '╰────────────────────╯'
    return sock.sendMessage(from, { text: body }, { quoted: msg })
  },
}
