'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/addsudo.js — ZEN X | .addsudo   (owner only)
//
//  .addsudo @user                 add the tagged user
//  reply to someone + .addsudo    add the person you replied to
//  .addsudo 2348xxxxxxxxx         add by number (country code, no +)
//
//  Sudo users can use the bot while it is in PRIVATE mode.
// ════════════════════════════════════════════════════════════════════

const sudoStore = require('../core/sudostore')
const { CREDIT, sessionOf, resolveSudoTarget, hasNumberLike } = require('../core/sudoargs')

module.exports = {
  name: 'addsudo',
  aliases: ['sudoadd'],
  desc: 'Add a sudo user — they can use the bot while it is private',
  usage: '.addsudo @user  |  reply to someone + .addsudo  |  .addsudo 2348xxxxxxxxx',
  category: 'owner',

  run: async ({ sock, from, msg, args, text, isOwner }) => {
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}` }, { quoted: msg })

    if (!isOwner) return reply('❌ Only the bot owner can add sudo users.')

    const session = sessionOf(sock)
    const words = (Array.isArray(args) ? args : String(text || '').split(/\s+/)).filter(Boolean)

    const target = await resolveSudoTarget(sock, msg, words)
    if (!target) {
      if (!words.length) {
        return reply(
          '*Add a sudo user*\n\n' +
          '• *.addsudo @user*\n' +
          '• reply to someone + *.addsudo*\n' +
          '• *.addsudo 2348xxxxxxxxx*'
        )
      }
      if (hasNumberLike(words)) {
        return reply("❌ That doesn't look like a full phone number (with country code, no +).")
      }
      return reply('❌ Tag the user, reply to their message, or type their number.')
    }

    if (target.number === session) {
      return sock.sendMessage(from, {
        text: `ℹ️ @${target.number} is the owner and already has full access.\n\n${CREDIT}`,
        mentions: [target.jid],
      }, { quoted: msg })
    }

    const result = sudoStore.add(session, target.number, session)

    if (result.reason === 'exists') {
      return sock.sendMessage(from, {
        text: `ℹ️ @${target.number} is already a sudo user.\n\n${CREDIT}`,
        mentions: [target.jid],
      }, { quoted: msg })
    }
    if (result.reason === 'invalid') {
      return reply("❌ That doesn't look like a full phone number (with country code, no +).")
    }

    return sock.sendMessage(from, {
      text: `👑 @${target.number} is now a *sudo user*.\nThey can use the bot while it is private.\n\n${CREDIT}`,
      mentions: [target.jid],
    }, { quoted: msg })
  },
}

