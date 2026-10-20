'use strict'

// commands/tagadmin.js — ZEN X | .tagadmin <message>

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

module.exports = {
  pattern: '.tagadmin',
  alias: [],
  desc: 'Mention the group admins with a message',
  usage: '.tagadmin <message>',
  category: 'group',

  run: async ({ sock, from, msg, args, text, isGroup, isAdmin, isOwner }) => {
    if (!isGroup || !from.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: '❌ This command only works in a group.',
      }, { quoted: msg })
    }

    if (!isOwner && !isAdmin) {
      await sock.sendMessage(from, {
        text: '> *Only bot Owner and Admin are allowed to use this command*',
      }, { quoted: msg }).catch(() => {})
      return sock.sendMessage(from, {
        react: { text: '❌', key: msg.key },
      }).catch(() => {})
    }

    await sock.sendMessage(from, {
      react: { text: '📣', key: msg.key },
    }).catch(() => {})

    try {
      const metadata = await sock.groupMetadata(from)
      const admins = (metadata.participants || [])
        .filter(p => p && (p.admin === 'admin' || p.admin === 'superadmin'))
        .map(p => {
          const jid = [p.id, p.jid, p.phoneNumber]
            .find(value => typeof value === 'string' && value.includes('@'))
          if (!jid) return null
          const number = String(p.phoneNumber || jid.split('@')[0])
            .split(':')[0]
            .replace(/\D/g, '')
          if (!number) return null
          return { jid, number }
        })
        .filter(Boolean)
        .filter((entry, index, all) => all.findIndex(item => item.jid === entry.jid) === index)

      if (!admins.length) {
        return sock.sendMessage(from, {
          text: '❌ No group admins were found.',
        }, { quoted: msg })
      }

      const message = String(text || (Array.isArray(args) ? args.join(' ') : ''))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000) || 'Please check the group.'
      const adminLines = admins
        .map(({ number }) => `┃ 👑 *Admin* @${number}`)
        .join('\n')
      const output =
        '┏━━━━━━━「 TAG ADMINS 」━━━━━━━┓\n' +
        '┃ 📢 Calling the group admins:\n' +
        `${adminLines}\n` +
        '┃\n' +
        `┃ 📝 Message: ${message}\n` +
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n' +
        CREDIT

      return sock.sendMessage(from, {
        text: output,
        mentions: admins.map(({ jid }) => jid),
      }, { quoted: msg })
    } catch (error) {
      console.error(`[TAGADMIN:${from}]`, error.message)
      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key },
      }).catch(() => {})
      return sock.sendMessage(from, {
        text: `❌ Failed to tag group admins. Try again.\n\n${CREDIT}`,
      }, { quoted: msg }).catch(() => {})
    }
  },
}
