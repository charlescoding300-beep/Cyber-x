// commands/ship.js — ZENX Ship Command
'use strict'

const CREDIT = '> 🎨 _Designed by_ *Charles Tech*\n> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

function getScore(jid1, jid2) {
  const str = [jid1, jid2].sort().join('')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash % 101) // 0–100
}

function mentionTag(jid) {
  const participant = String(jid || '').replace(/:\d+(?=@)/, '')
  return `@${participant.split('@')[0]}`
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
      return sock.sendMessage(from, { text:
`╔══════════════════════════╗
║  💘 *ZENX SHIP METER* ║
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

${CREDIT}`
      }, { quoted: msg })
    }

    const score = getScore(user1, user2)
    const output =
`*💞 𝙎𝙃𝙄𝙋 𝙍𝙀𝙎𝙐𝙇𝙏*
*— ${mentionTag(user1)} + ${mentionTag(user2)}:    ${score}%*

${CREDIT}`

    await sock.sendMessage(from, {
      text: output,
      mentions: [user1, user2],
    }, { quoted: msg })
  }
}
