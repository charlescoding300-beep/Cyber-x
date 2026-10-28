'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — .character
//
// Fun "character analysis" of a person — mention them or reply to their message.
// Random traits + percentages, sent with their profile picture (text only if they have none).
//
//   .character @user        or      reply to a message with  .character
//
// Credit: set BOT_CREDIT in .env to change it everywhere (default below).

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')

const TRAITS = [
  'Intelligent', 'Creative', 'Determined', 'Ambitious', 'Caring',
  'Charismatic', 'Confident', 'Empathetic', 'Energetic', 'Friendly',
  'Generous', 'Honest', 'Humorous', 'Imaginative', 'Independent',
  'Intuitive', 'Kind', 'Logical', 'Loyal', 'Optimistic',
  'Passionate', 'Patient', 'Persistent', 'Reliable', 'Resourceful',
  'Sincere', 'Thoughtful', 'Understanding', 'Versatile', 'Wise',
]

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// shuffle, then take `count` — always gives exactly `count` different traits
function pickTraits(count) {
  const pool = [...TRAITS]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

// the @mentioned person first, otherwise the person whose message was replied to
function getTarget(msg) {
  const m = msg.message?.ephemeralMessage?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message
  const ctx = m?.extendedTextMessage?.contextInfo ||
              m?.imageMessage?.contextInfo ||
              m?.videoMessage?.contextInfo
  return ctx?.mentionedJid?.[0] || ctx?.participant || null
}

module.exports = {
  name: 'character',
  aliases: [],
  desc: 'Fun character analysis of a mentioned / replied user',
  usage: '.character @user  (or reply to their message)',
  category: 'fun',

  run: async ({ sock, from, msg, helper }) => {
    const target = getTarget(msg)

    if (!target) {
      return sock.sendMessage(from, {
        text: 'Please mention someone or reply to their message to analyze their character!'
      }, { quoted: msg })
    }

    try {
      const tag = target.split('@')[0].split(':')[0]
      const traitLines = pickTraits(rand(3, 5)).map(t => `${t}: ${rand(60, 100)}%`)

      const analysis =
        `╭══✦〔🔮 *Character Analysis* 🔮〕✦═╮\n│ \n` +
        `│ 👤 *User:* @${tag}\n│ \n` +
        `│ ✨ *Key Traits:*\n│ ${traitLines.join('\n│ ')}\n│ \n` +
        `│ 🎯 *Overall Rating:* ${rand(80, 100)}%\n│ \n` +
        `│ Note: This is a fun analysis and should not be taken seriously!\n│ \n` +
        `╰═✦═✦═✦═✦═✦═✦═✦═✦═✦═╯\n\n${CREDIT}`

      // profile picture (retry-safe helper from index.js; plain call as a fallback)
      let pp = null
      try {
        pp = helper?.getProfilePictureSafe
          ? await helper.getProfilePictureSafe(sock, target, { retries: 1, delayMs: 500 })
          : await sock.profilePictureUrl(target, 'image')
      } catch {}

      if (pp) {
        await sock.sendMessage(from, { image: { url: pp }, caption: analysis, mentions: [target] }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: analysis, mentions: [target] }, { quoted: msg })
      }
    } catch (error) {
      console.error('[ZEN X CHARACTER] error:', error)
      await sock.sendMessage(from, { text: 'Failed to analyze character! Try again later.' }, { quoted: msg }).catch(() => {})
    }
  }
}
