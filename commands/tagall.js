'use strict'

// commands/tagall.js — 𓃦 𝗭Ξ𝗡 𝗫

const CREDIT = '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const INVISIBLE = '\u200B'.repeat(4000)

module.exports = {
  pattern: '.tagall',
  aliases: ['tagall'],

  run: async ({ sock, from, msg, args, isOwner, isAdmin }) => {

    // GROUP ONLY
    if (!from.endsWith('@g.us')) {
      await sock.sendMessage(from, {
        text: '> *Group command only*'
      }, { quoted: msg }).catch(() => {})
      return
    }

    // OWNER OR ADMIN ONLY
    if (!isOwner && !isAdmin) {
      await sock.sendMessage(from, {
        text: '> *Only bot Owner and Admin are allowed to use this command*'
      }, { quoted: msg }).catch(() => {})

      await sock.sendMessage(from, {
        react: {
          text: '❌',
          key: msg.key
        }
      }).catch(() => {})

      return
    }

    try {
      const metadata = await sock.groupMetadata(from)
      const members = metadata.participants || []

      if (!members.length) return

      const announcement = args.join(' ').trim()

      const messageText = announcement
        ? announcement
        : 'NONE MESSAGE'

      const mentions = members
        .map(member => member.id)
        .filter(Boolean)

      const tags = members.map(member => {
        const number = String(member.id).split('@')[0]
        return `𓃦 *@${number}*`
      }).join('\n')

      const message =
        `▢ Group : *${metadata.subject || '𝗭Ξ𝗡 𝗫 Company 🦋'}*\n` +
        `▢ Members : *${members.length}*\n` +
        `▢ Message: *${messageText}*\n\n` +
        `┌───⊷ *𓃦 MENTIONS*\n` +
        `${tags}\n` +
        `└──✪ 𝗭Ξ𝗡 𝗫 ┃ 𓃦 ✪──\n\n` +
        `${INVISIBLE}\n\n` +
        `> ${CREDIT}`

      // React to the .tagall command itself
      await sock.sendMessage(from, {
        react: {
          text: '👥',
          key: msg.key
        }
      }).catch(() => {})

      // Quoted tagall response
      await sock.sendMessage(from, {
        text: message,
        mentions
      }, {
        quoted: msg
      })

    } catch (error) {
      console.error(`[TAGALL:${from}]`, error.message)

      await sock.sendMessage(from, {
        text:
          '> *Failed to tag group members. Try again.*\n\n' +
          `> ${CREDIT}`
      }, {
        quoted: msg
      }).catch(() => {})

      await sock.sendMessage(from, {
        react: {
          text: '❌',
          key: msg.key
        }
      }).catch(() => {})
    }
  }
}
