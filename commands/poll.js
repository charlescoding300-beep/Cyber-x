'use strict'

function parsePoll(input) {
  const parts = String(input || '').split('|').map(value => value.trim()).filter(Boolean)
  if (parts.length < 3) return null
  const question = parts.shift()
  const options = [...new Set(parts)]
  if (!question || options.length < 2 || options.length > 12) return null
  if (question.length > 120 || options.some(option => option.length > 80)) return null
  return { question, options }
}

module.exports = {
  pattern: 'poll',
  alias: ['vote'],
  category: 'group/admin',
  desc: 'Create a WhatsApp poll in a group',
  usage: '.poll Question? | Option 1 | Option 2',
  parsePoll,
  run: async ({ sock, from, msg, text, isGroup }) => {
    if (!isGroup) {
      return sock.sendMessage(from, { text: 'Polls work in groups. Add at least two choices, separated with |.\nExample: .poll Lunch? | Rice | Pasta', quoted: msg })
    }
    const poll = parsePoll(text)
    if (!poll) {
      return sock.sendMessage(from, { text: 'Use: .poll Question? | Option 1 | Option 2\nAdd 2-12 choices, separated with |.', quoted: msg })
    }
    return sock.sendMessage(from, { poll: { name: poll.question, values: poll.options, selectableCount: 1 } })
  }
}
