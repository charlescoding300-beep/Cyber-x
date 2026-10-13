'use strict'

const DARES = [
  'Describe your day using exactly three emojis.',
  'Send a voice note saying your favorite movie title like a trailer narrator.',
  'Write a two-line poem about your next meal.',
  'Give someone in this chat a kind, specific compliment.',
  'Type your next message using only emojis.',
  'Share a song you would put on a feel-good playlist.',
  'Invent a funny title for your life story.',
  'Say the alphabet backwards as far as you can in a voice note.',
  'Describe your favorite snack without naming it and let the group guess.',
  'Write a tiny advertisement for your favorite hobby.',
  'Send a voice note with your best robot voice.',
  'Make up a new word and explain what it means.',
  'Name three things that made you smile this week.',
  'Write a dramatic weather report for the room you are in.',
  'Use a movie quote to describe your mood today.',
  'Create a team name for this chat in ten seconds.',
  'Tell a harmless joke you have not used in this chat before.',
  'Describe your favorite place using only five words.',
  'Write a one-sentence thank-you to someone who helped you.',
  'Make up a slogan for your favorite food.'
]

module.exports = {
  pattern: 'dare',
  category: 'fun',
  desc: 'Get a safe, light-hearted dare',
  usage: '.dare',
  run: async ({ sock, from, msg }) => {
    const dare = DARES[Math.floor(Math.random() * DARES.length)]
    return sock.sendMessage(from, { text: 'Dare: ' + dare + '\nKeep it fun and skip anything you do not want to do.', quoted: msg })
  }
}
