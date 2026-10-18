'use strict'

const { solveMath } = require('../core/mathsolver')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

function calculationMessage(expression, result) {
  const working = result.steps
    .slice(0, 12)
    .map((line, index) => `┃ ${index ? '= ' : ''}${line}`)
    .join('\n')

  return [
    '┏━━━━━━━「 CALCULATION 」━━━━━━━┓',
    `┃ 🧮 Expression: ${expression}`,
    '┃',
    '┃ Working:',
    working,
    '┃',
    `┃ ✅ Answer: ${result.answer}`,
    '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
    '',
    CREDIT,
  ].join('\n')
}

const command = {
  pattern: 'calc',
  alias: ['calculate', 'math', 'calculator'],
  category: 'utility',
  desc: 'Calculate expressions and solve linear or quadratic equations with working',
  usage: '.calc <expression or equation>',

  run: async ({ sock, from, msg, text, args }) => {
    const input = String(text || (Array.isArray(args) ? args.join(' ') : '')).trim()
    if (!input) {
      const help =
        '🧮 *CALCULATION*\n\n' +
        'Arithmetic: *.calc 25 × 4*\n' +
        'Equations: *.calc 2x + 3 = 7*\n' +
        'Quadratics: *.solve x^2 - 4 = 0*\n' +
        'Also supports brackets, %, powers, √, pi, e, and functions such as sqrt(), sin(), cos(), log(), and abs().\n\n' +
        CREDIT
      return sock.sendMessage(from, { text: help }, { quoted: msg })
    }

    try {
      const result = solveMath(input)
      const displayExpression = input
        .replace(/\*/g, '×')
        .replace(/\//g, '÷')
        .replace(/([\d)])\s*[xX]\s*(?=[\d(])/g, '$1 × ')
      return sock.sendMessage(
        from,
        { text: calculationMessage(displayExpression, result) },
        { quoted: msg }
      )
    } catch (error) {
      return sock.sendMessage(
        from,
        {
          text: `❌ ${error.message}\n\nTry: *.calc 25 × 4* or *.calc 2x + 3 = 7*\n\n${CREDIT}`,
        },
        { quoted: msg }
      )
    }
  },
}

module.exports = command
