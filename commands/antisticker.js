'use strict'

const antisticker = require('../lib/antisticker')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

module.exports = {
  name: 'antisticker',
  aliases: ['as', 'nosticker'],
  category: 'group',
  description: 'Enable/Disable Anti-Sticker in the group',
  usage: '.antisticker on/off | .antisticker delete/warn/kick',
  ownerOnly: false,
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,

  async run({ sock, m, msg, from, args, phone, isAdmin, isBotAdmin }) {
    const sourceMessage = msg || m
    const jid = from || sourceMessage?.key?.remoteJid
    if (!jid || !sourceMessage) return
    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'

    if (!args[0]) {
      const cfg = antisticker.getConfig(owner, jid)
      return sock.sendMessage(jid, {
        text: `╭───「 *Anti-Sticker Settings* 」───
│ Status : ${cfg.enabled ? '✅ ON' : '❌ OFF'}
│ Action : ${cfg.action.toUpperCase()}
│ Max Warns : ${cfg.maxWarns}
│ Admins Exempt : ${cfg.applyToAdmins ? 'No' : 'Yes'}
╰──────────────────────────

*Commands:*
• *.antisticker on* → Enable
• *.antisticker off* → Disable
• *.antisticker delete* → Just delete sticker
• *.antisticker warn* → Warn then kick
• *.antisticker kick* → Instant kick
• *.antisticker max 3* → Set max warnings

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
      }, { quoted: sourceMessage })
    }

    const option = args[0].toLowerCase()

    if (option !== 'off' && !isBotAdmin) return sendBotNotAdmin(sock, jid, sourceMessage)

    if (option === 'on') {
      antisticker.antistickerEnable(owner, jid, 'delete', 3, false)
      return sock.sendMessage(jid, {
        text: `✅ *Anti-Sticker Enabled*\n\nAction: *DELETE*\nAdmins are exempt.\n\n> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
      }, { quoted: sourceMessage })
    }

    if (option === 'off') {
      antisticker.antistickerDisable(owner, jid)
      return sock.sendMessage(jid, {
        text: `❌ *Anti-Sticker Disabled*\n\n> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
      }, { quoted: sourceMessage })
    }

    if (['delete', 'warn', 'kick'].includes(option)) {
      const current = antisticker.getConfig(owner, jid)
      antisticker.antistickerEnable(owner, jid, option, current.maxWarns || 3, current.applyToAdmins)
      return sock.sendMessage(jid, {
        text: `✅ *Anti-Sticker Action Updated*\n\nNew Action: *${option.toUpperCase()}*\n\n> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
      }, { quoted: sourceMessage })
    }

    if (option === 'max' && args[1]) {
      const max = parseInt(args[1])
      if (isNaN(max) || max < 1 || max > 10) {
        return sock.sendMessage(jid, { text: '❌ Please enter a number between 1 and 10' }, { quoted: sourceMessage })
      }
      const current = antisticker.getConfig(owner, jid)
      antisticker.antistickerEnable(owner, jid, current.action || 'delete', max, current.applyToAdmins)
      return sock.sendMessage(jid, {
        text: `✅ *Max Warnings set to ${max}*\n\n> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
      }, { quoted: sourceMessage })
    }

    // Help
    return sock.sendMessage(jid, {
      text: `*Anti-Sticker Commands*\n\n• .antisticker on\n• .antisticker off\n• .antisticker delete\n• .antisticker warn\n• .antisticker kick\n• .antisticker max 3\n\n> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`
    }, { quoted: sourceMessage })
  }
}
