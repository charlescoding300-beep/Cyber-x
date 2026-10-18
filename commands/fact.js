'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/fact.js — .fact   (category: fun)
//  Facts are drawn without repeats until the whole list has been used.
// ════════════════════════════════════════════════════════════════════
const { FACTS } = require('../core/funpools')
const { createBag } = require('../core/funkit')

const bag = createBag(FACTS)

module.exports = {
  name: 'fact',
  aliases: ['didyouknow'],
  desc: 'A random real fact',
  usage: '.fact',
  category: 'fun',

  run: async ({ sock, from, msg }) => {
    const fact = bag.next()
    const body =
      '╭───「 FACT 」───╮\n' +
      '│ 🧠 Did you know?\n' +
      `│ ${fact}.\n` +
      '╰────────────────╯'
    return sock.sendMessage(from, { text: body }, { quoted: msg })
  },
}
