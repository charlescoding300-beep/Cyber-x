'use strict'

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function safeEval(expression) {
  // ── Clean and sanitize input ──
  let expr = expression
    .replace(/x/gi,  '*')
    .replace(/÷/g,   '/')
    .replace(/,/g,   '')
    .replace(/\^/g,  '**')
    .replace(/√(\d+(\.\d+)?)/g, (_, n) => Math.sqrt(parseFloat(n)))
    .replace(/√/g,   'Math.sqrt')
    .replace(/π/g,   Math.PI)
    .replace(/pi/gi, Math.PI)
    .replace(/e/g,   Math.E)
    .replace(/sin\(/gi,  'Math.sin(')
    .replace(/cos\(/gi,  'Math.cos(')
    .replace(/tan\(/gi,  'Math.tan(')
    .replace(/log\(/gi,  'Math.log10(')
    .replace(/ln\(/gi,   'Math.log(')
    .replace(/abs\(/gi,  'Math.abs(')
    .replace(/ceil\(/gi, 'Math.ceil(')
    .replace(/floor\(/gi,'Math.floor(')
    .replace(/round\(/gi,'Math.round(')
    .replace(/sqrt\(/gi, 'Math.sqrt(')
    .replace(/pow\(/gi,  'Math.pow(')
    .replace(/max\(/gi,  'Math.max(')
    .replace(/min\(/gi,  'Math.min(')
    .trim()

  // ── Only allow safe characters ──
  if (!/^[0-9+\-*/.()%,Math\s.EPIsincotaglbqrfpw]+$/i.test(expr)) {
    throw new Error('Invalid characters in expression')
  }

  // ── Evaluate ──
  const result = Function('"use strict"; return (' + expr + ')')()

  if (typeof result !== 'number') throw new Error('Invalid result')
  if (!isFinite(result))          throw new Error('Result is infinite or undefined')

  return result
}

function formatResult(num) {
  if (Number.isInteger(num)) return num.toLocaleString()
  return parseFloat(num.toFixed(10)).toLocaleString()
}

function detectOperation(expr) {
  const e = expr.toLowerCase()
  if (e.includes('sin'))   return '📐 Trigonometry'
  if (e.includes('cos'))   return '📐 Trigonometry'
  if (e.includes('tan'))   return '📐 Trigonometry'
  if (e.includes('sqrt') || e.includes('√')) return '√ Square Root'
  if (e.includes('log'))   return '📊 Logarithm'
  if (e.includes('**') || e.includes('^'))   return '⬆️ Power'
  if (e.includes('%'))     return '% Percentage'
  if (e.includes('*') && !e.includes('**')) return '✖️ Multiplication'
  if (e.includes('/'))     return '➗ Division'
  if (e.includes('+'))     return '➕ Addition'
  if (e.includes('-'))     return '➖ Subtraction'
  return '🔢 Calculation'
}

const command = {
  pattern:  'solve',
  alias:    [''],
  category: 'utility',
  desc:     'Calculate any mathematical expression',
  usage:    '.solve <expression>',

  run: async ({ sock, from, msg, text, args }) => {

    // ── React immediately ──
    sock.sendMessage(from, { react: { text: '🧮', key: msg.key } }).catch(() => {})

    const input = (text || args.join(' ')).trim()

    if (!input) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🧮 *CYBER X CALCULATOR*  ║
╚═══════════════════════════╝

*How to use:*
• *.calc <expression>*
• *.math <expression>*
• *.calculator <expression>*

*Basic Operations:*
  _.calc 5 + 3_ → 8
  _.calc 10 - 4_ → 6
  _.calc 6 * 7_ → 42
  _.calc 20 / 4_ → 5
  _.calc 10 % 3_ → 1

*Advanced:*
  _.calc 2 ^ 10_ → 1024
  _.calc √144_ → 12
  _.calc sqrt(256)_ → 16
  _.calc sin(90)_ → trig
  _.calc log(100)_ → log
  _.calc (5 + 3) * 2_ → 16

*Constants:*
  _π or pi_ → 3.14159...
  _e_ → 2.71828...

${CREDIT}`,
        quoted: msg
      })
    }

    try {
      const operation = detectOperation(input)
      const result    = safeEval(input)
      const formatted = formatResult(result)

      await sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🧮 *CYBER X CALCULATOR*  ║
╚═══════════════════════════╝

*Type:* ${operation}

📥 *Input:*
\`${input}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━

📤 *Result:*
*${formatted}*

━━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        quoted: msg
      })

      await sock.sendMessage(from, {
        react: { text: '✅', key: msg.key }
      }).catch(() => {})

    } catch (e) {
      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})

      await sock.sendMessage(from, {
        text:
`❌ *Invalid expression:* \`${input}\`

*Common mistakes:*
• Use \`*\` for multiply not \`x\`
• Use \`/\` for divide not \`÷\`
• Check brackets are balanced
• No letters except math functions

💡 *Example:* _.calc (10 + 5) * 2_

${CREDIT}`,
        quoted: msg
      })
    }
  }
}

module.exports = command
