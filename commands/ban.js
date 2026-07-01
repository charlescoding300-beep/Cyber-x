'use strict'
const fs = require('fs')
const path = require('path')

const BAN_FILE = path.join(__dirname, '../session/banned_users.json')

function loadBanned() {
  try {
    if (fs.existsSync(BAN_FILE)) {
      return JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'))
    }
  } catch (e) {
    console.warn('[BAN] Load error:', e.message)
  }
  return {}
}

function saveBanned(data) {
  try {
    fs.writeFileSync(BAN_FILE, JSON.stringify(data, null, 2))
  } catch (e) {
    console.error('[BAN] Save error:', e.message)
  }
}

function isBanned(userId) {
  const banned = loadBanned()
  return !!banned[userId]
}

module.exports = {
  pattern: 'ban',
  alias: ['ban'],
  category: 'group/admin',
  desc: 'Ban/unban users from using the bot (owner only)',
  usage: '.ban (reply) | .ban @user | .ban unban <number> | .ban list',

  run: async ({ sock, from, msg, sender, args, text }) => {

    const isOwner = sender === process.env.OWNER_NUMBER || sender.includes(process.env.OWNER_NUMBER)
    
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ *Owner only command*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    const banned = loadBanned()
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    
    let targetJid = null
    
    if (quoted?.participant) {
      targetJid = quoted.participant
    } else if (args[0]?.startsWith('@')) {
      const phone = args[0].replace('@', '').replace(/[^0-9]/g, '')
      targetJid = `${phone}@s.whatsapp.net`
    } else if (args[0] && /^\d+$/.test(args[0])) {
      targetJid = `${args[0]}@s.whatsapp.net`
    }

    if (!targetJid) {
      return sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  🚫 *BAN COMMAND*      ║\n╚════════════════════════╝\n\n⚠️ *Owner Only*\n\n*Usage:*\n• *Reply to message + .ban* — ban that user\n• *.ban @username* — ban by tag\n• *.ban 234XXXXXXXXXX* — ban by number\n\n*Commands:*\n• *.ban unban <number>* — unban user\n• *.ban list* — show all banned users\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    const phone = targetJid.replace(/[^0-9]/g, '')

    if (args[0]?.toLowerCase() === 'unban') {
      if (banned[phone]) {
        delete banned[phone]
        saveBanned(banned)
        return sock.sendMessage(from, {
          text: `✅ *Unbanned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      return sock.sendMessage(from, {
        text: `⚠️ *User not banned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (args[0]?.toLowerCase() === 'list') {
      const list = Object.keys(banned)
      if (list.length === 0) {
        return sock.sendMessage(from, {
          text: `📋 *Banned Users:* None\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      const bannedList = list.map((p, i) => `${i + 1}. +${p}`).join('\n')
      return sock.sendMessage(from, {
        text: `📋 *Banned Users (${list.length}):*\n\n${bannedList}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (banned[phone]) {
      return sock.sendMessage(from, {
        text: `⚠️ *Already banned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    banned[phone] = {
      phone,
      bannedAt: new Date().toISOString(),
      reason: args.slice(1).join(' ') || 'No reason'
    }

    saveBanned(banned)

    sock.sendMessage(from, {
      text: `🚫 *Banned:* +${phone}\n*Reason:* ${banned[phone].reason}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      quoted: msg
    })

    try {
      sock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: `🚫 *You have been banned from using this bot.*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
      })
    } catch (_) {}
  },

  isBanned,
  loadBanned,
  saveBanned
}
