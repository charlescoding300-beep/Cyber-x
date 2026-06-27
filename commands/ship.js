// commands/ship.js — CYBER X Ship Command
'use strict'

const CREDIT = '> 🎨 _Designed by_ *Charles Tech*\n> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function getScore(jid1, jid2) {
  const str = [jid1, jid2].sort().join('')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash % 101) // 0–100
}

function getBar(score) {
  const filled = Math.round(score / 10)
  const empty  = 10 - filled
  return '❤️'.repeat(filled) + '🖤'.repeat(empty)
}

function getLabel(score) {
  if (score === 100) return '👑 *PERFECT MATCH — Destined for each other!*'
  if (score >= 81)  return '💞 *Soulmates incoming!*'
  if (score >= 61)  return '🔥 *Strong vibes, something is there!*'
  if (score >= 41)  return '🤔 *Maybe... give it a shot?*'
  if (score >= 21)  return '😬 *Awkward energy... but who knows!*'
  return               '💀 *No chance. Absolutely not.*'
}

module.exports = {
  pattern:  'ship',
  alias:    ['love', 'couple'],
  category: 'fun',
  desc:     'Ship two users and check their compatibility',
  usage:    '.ship @user1 @user2',

  run: async ({ sock, from, msg, args, text, sender }) => {

    // ── React immediately ──
    await sock.sendMessage(from, {
      react: { text: '👫🏼', key: msg.key }
    }).catch(() => {})

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []

    let user1, user2

    if (mentioned.length >= 2) {
      user1 = mentioned[0]
      user2 = mentioned[1]
    } else if (mentioned.length === 1) {
      user1 = sender
      user2 = mentioned[0]
    } else {
      return sock.sendMessage(from, {
        text:
`╔══════════════════════════╗
║  💘 *CYBER X SHIP METER* ║
╚══════════════════════════╝

⚠️ *Oops! You didn't tag anyone.*

This command ships two people together and checks their love compatibility score 💘

━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 *How to use it correctly:*

*Option 1 — Ship two people:*
  👉 _.ship @person1 @person2_
  _(Tag both people you want to ship)_

*Option 2 — Ship yourself with someone:*
  👉 _.ship @person_
  _(Tag one person and the bot ships you with them)_

━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Examples:*
  _.ship @John @Sarah_
  _.ship @Mike @Tunde_
  _.ship @Sandra_

━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *What you get:*
• A compatibility score from *0% to 100%*
• A love meter bar ❤️🖤
• A verdict on your relationship potential 😏

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ _The same pair always gets the same score — no cheating!_

${CREDIT}`,
        quoted: msg
      })
    }

    const name1 = user1.split('@')[0]
    const name2 = user2.split('@')[0]
    const score = getScore(user1, user2)
    const bar   = getBar(score)
    const label = getLabel(score)

    const output =
`╔══════════════════════════╗
║  💘 *CYBER X SHIP METER* ║
╚══════════════════════════╝

👤 *+${name1}*
        💗
👤 *+${name2}*

━━━━━━━━━━━━━━━━━━━━━━━━━━

💘 *Compatibility Score:* ${score}%

${bar}

${label}

━━━━━━━━━━━━━━━━━━━━━━━━━━

${CREDIT}`

    await sock.sendMessage(from, {
      text: output,
      mentions: [user1, user2],
      quoted: msg
    })
  }
}
