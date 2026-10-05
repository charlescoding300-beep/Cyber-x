'use strict'

module.exports = {
  pattern:  'gpt',
  category: 'ai',
  desc:     'Chat with ZENX GPT — powered by Groq',
  usage:    '.gpt <question>',
  run:      require('./ai').run,
}
