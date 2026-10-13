'use strict'

function parseChoices(input) {
  const choices = String(input || '').split('|').map(value => value.trim()).filter(Boolean)
  if (choices.length < 2 || choices.length > 12 || choices.some(value => value.length > 80)) return null
  return [...new Set(choices)]
}

module.exports = {
  pattern: 'choose',
  alias: ['pick'],
  category: 'fun',
  desc: 'Pick one option from a list',
  usage: '.choose Rice | Pasta | Beans',
  parseChoices,
  run: async ({ sock, from, msg, text }) => {
    const choices = parseChoices(text)
    if (!choices || choices.length < 2) {
      return sock.sendMessage(from, { text: 'Give me 2-12 choices separated by |. Example: .choose Rice | Pasta | Beans', quoted: msg })
    }
    const choice = choices[Math.floor(Math.random() * choices.length)]
    return sock.sendMessage(from, { text: 'I choose: ' + choice, quoted: msg })
  }
}
