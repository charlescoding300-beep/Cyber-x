'use strict'

module.exports = {
  pattern:  'gpt',
  category: 'ai',
  desc:     'Chat with CYBER X GPT — powered by Groq',
  usage:    '.gpt <question>',
  run:      require('./ai').run,
}
