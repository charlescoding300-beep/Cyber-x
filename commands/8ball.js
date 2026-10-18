'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/8ball.js — .8ball <question>   (category: fun)
//  Each answer is drawn without repeats until the whole list has been used.
// ════════════════════════════════════════════════════════════════════
const { ANSWERS } = require('../core/funpools')
const { createBag, cleanLine } = require('../core/funkit')

const bag = createBag(ANSWERS)

module.exports = {
  name: '8ball',
  aliases: ['eightball'],
  desc: 'Ask the magic 8-ball a question',
  usage: '.8ball <your question>',
  category: 'fun',

  run: async ({ sock, from, msg, args, text }) => {
    const question = cleanLine(text || (Array.isArray(args) ? args.join(' ') : ''))
    if (!question) {
      return sock.sendMessage(from, { text: 'Usage: *.8ball <your question>*' }, { quoted: msg })
    }
    const answer = bag.next()
    const body =
      '╭───「 8BALL 」───╮\n' +
      `│ 🎱 Question: ${question}\n` +
      `│ 🔮 Answer: ${answer}.\n` +
      '╰─────────────────╯'
    return sock.sendMessage(from, { text: body }, { quoted: msg })
  },
}
