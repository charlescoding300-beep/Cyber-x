'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/wyr.js  —  CYBER X  |  Would You Rather
//
// USAGE (anyone, anywhere — DM or group):
//   .wyr   → random "Would you rather A or B" dilemma
//
// No args, no setup. Reacts 🤔 then sends a random pair.
// ─────────────────────────────────────────────────────────────────────────────

const QUESTIONS = [
  ['have the ability to fly', 'have the ability to turn invisible'],
  ['be able to talk to animals', 'be able to speak every human language'],
  ['have unlimited money but no friends', 'have amazing friends but be broke forever'],
  ['live without music', 'live without movies/TV'],
  ['always say everything on your mind', 'never speak again'],
  ['be 10 years older', 'be 10 years younger'],
  ['have no internet for a year', 'have no AC/heating for a year'],
  ['fight one horse-sized duck', 'fight a hundred duck-sized horses'],
  ['know how you die', 'know when you die'],
  ['be famous but broke', 'be rich but unknown'],
  ['lose your sense of smell', 'lose your sense of taste'],
  ['be stuck in traffic for 3 hours', 'be stuck in an elevator for 1 hour'],
  ['have free flights for life', 'have free food for life'],
  ['never use social media again', 'never watch another movie again'],
  ['be able to read minds', 'be able to teleport'],
  ['have a rewind button for your life', 'have a pause button for your life'],
  ['always be 10 minutes late', 'always be 20 minutes early'],
  ['lose all your money', 'lose all your photos and memories saved online'],
  ['live in a treehouse', 'live in a houseboat'],
  ['fight a zombie apocalypse', 'survive an alien invasion'],
  ['have everyone know your search history', 'have everyone know your private messages'],
  ['be able to control fire', 'be able to control water'],
  ['win 1 million dollars now', 'have a chance to win 100 million in 10 years'],
  ['never eat your favorite food again', 'only eat your favorite food forever'],
  ['be a famous actor', 'be a famous musician'],
  ['always have to whisper', 'always have to shout'],
  ['have a personal chef', 'have a personal driver'],
  ['live without your phone', 'live without your best friend nearby'],
  ['be feared by everyone', 'be liked by everyone but respected by no one'],
  ['have unlimited tacos', 'have unlimited pizza'],
]

module.exports = {
  pattern:  'wyr',
  alias:    ['wouldyourather'],
  desc:     'Random Would You Rather question',
  usage:    '.wyr',
  category: 'fun',

  async run({ sock, from, msg }) {
    await sock.sendMessage(from, { react: { text: '🤔', key: msg.key } }).catch(() => {})

    const [a, b] = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]

    const text =
      `🎭 *WOULD YOU RATHER...*\n\n` +
      `*A)* ${a}\n\n` +
      `*OR*\n\n` +
      `*B)* ${b}\n\n` +
      `_Reply with A or B!_`

    return sock.sendMessage(from, { text }, { quoted: msg })
  },
}
