'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/quote.js — .quote   (category: fun)
//  Quotes are drawn without repeats until the whole list has been used.
// ════════════════════════════════════════════════════════════════════
const { QUOTES } = require('../core/funpools')
const { createBag } = require('../core/funkit')

const bag = createBag(QUOTES)

module.exports = {
  name: 'quote',
  aliases: ['quotes'],
  desc: 'A random quote',
  usage: '.quote',
  category: 'fun',

  run: async ({ sock, from, msg }) => {
    const q = bag.next()
    const body =
      '╭───「 QUOTE 」───╮\n' +
      `│ “${q.text}”\n` +
      `│ — ${q.author}\n` +
      '╰────────────────╯'
    return sock.sendMessage(from, { text: body }, { quoted: msg })
  },
}
