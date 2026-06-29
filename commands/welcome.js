'use strict'
const fs = require('fs')
const path = require('path')

const GREET_ROOT = path.join(__dirname, '../data/greet')
if (!fs.existsSync(GREET_ROOT)) fs.mkdirSync(GREET_ROOT, { recursive: true })

function greetFile(phone, groupId) {
  const dir = path.join(GREET_ROOT, phone)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, groupId.replace(/[^a-z0-9]/gi, '_') + '.json')
}

function loadGreet(phone, groupId) {
  try {
    const f = greetFile(phone, groupId)
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {}
  return {}
}

function saveGreet(phone, groupId, data) {
  try {
    fs.writeFileSync(greetFile(phone, groupId), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[WELCOME] save error:`, e.message)
  }
}

const DEFAULT_WELCOME = 'Welcome to *{group}*, @{tag}! 🎉\nWe now have *{members}* members.'

module.exports = {
  pattern: 'welcome',
  alias: ['welcome'],
  category: 'group',
  desc: 'Set custom welcome messages for new members',
  usage: '.welcome on|off|set|view',

  run: async ({ sock, from, msg, sender, isGroup, isAdmin, isOwner, args, text }) => {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `❌ *Groups only*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, {
        text: `❌ *Admins only*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    const phone = sender.replace(/[^0-9]/g, '')
    const data = loadGreet(phone, from)

    const cmd = args[0]?.toLowerCase()

    if (cmd === 'on') {
      data.welcome = { ...data.welcome, enabled: true, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `✅ *Welcome messages enabled*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'off') {
      data.welcome = { ...data.welcome, enabled: false, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `❌ *Welcome messages disabled*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'view') {
      const msg_text = data.welcome?.message || DEFAULT_WELCOME
      return sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  👋 *WELCOME MESSAGE*  ║\n╚════════════════════════╝\n\n${msg_text}\n\n*Status:* ${data.welcome?.enabled ? '✅ ON' : '❌ OFF'}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'set') {
      const newMsg = args.slice(1).join(' ').trim()
      if (!newMsg) {
        return sock.sendMessage(from, {
          text: `❌ *Provide a message*\n*.welcome set <message>*\n\nUse {tag}, {group}, {members}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      data.welcome = { message: newMsg, enabled: true, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `✅ *Welcome message set!*\n\n${newMsg}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text: `╔════════════════════════╗\n║  👋 *WELCOME COMMAND*  ║\n╚════════════════════════╝\n\n*.welcome on* — enable\n*.welcome off* — disable\n*.welcome set <msg>* — customize\n*.welcome view* — see current\n\n*Variables:*\n{tag} — user phone\n{group} — group name\n{members} — member count\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      quoted: msg
    })
  },

  loadGreet,
  saveGreet,
  greetFile
}
