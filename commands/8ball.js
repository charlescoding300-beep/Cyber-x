'use strict'

const ANSWERS = [
  'Yes - go for it.', 'It looks promising.', 'Most likely.', 'Ask again in a little while.',
  'I cannot tell yet.', 'The signs are mixed.', 'Probably not.', 'It does not look likely.',
  'No - trust your judgment.'
]

module.exports = {
  pattern: '8ball',
  alias: ['magic8ball'],
  category: 'fun',
  desc: 'Ask the magic 8-ball a question',
  usage: '.8ball <question>',
  run: async ({ sock, from, msg, text }) => {
    if (!String(text || '').trim()) {
      return sock.sendMessage(from, { text: 'Ask a question first. Example: .8ball Will we win?', quoted: msg })
    }
    const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
    return sock.sendMessage(from, { text: 'The 8-ball says: ' + answer, quoted: msg })
  }
}
