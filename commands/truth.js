'use strict'

const PROMPTS = [
  'What small thing always makes your day better?',
  'What skill would you love to learn this year?',
  'Which song do you know almost every word to?',
  'What is one kind thing someone did for you recently?',
  'What food could you happily eat every week?',
  'What was your favorite game as a child?',
  'What is a place you would like to visit one day?',
  'Which movie or show can you watch more than once?',
  'What is something you are proud of learning?',
  'What is your favorite way to spend a quiet evening?',
  'If you could instantly master one hobby, what would it be?',
  'What is the funniest harmless misunderstanding you remember?',
  'What is one goal you are working toward?',
  'Which fictional character would make a fun friend?',
  'What is your favorite memory from school?',
  'What is a simple thing you wish more people appreciated?',
  'What is the best advice you have received?',
  'What is one new thing you tried and enjoyed?',
  'Which animal would you choose as a friendly companion?',
  'What makes a group chat fun for you?'
]

module.exports = {
  pattern: 'truth',
  category: 'fun',
  desc: 'Get a light, friendly truth question',
  usage: '.truth',
  run: async ({ sock, from, msg }) => {
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)]
    return sock.sendMessage(from, { text: 'Truth: ' + prompt + '\nPass any question you do not want to answer.', quoted: msg })
  }
}
