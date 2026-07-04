'use strict'
const fs = require('fs')
const path = require('path')

const GREET_ROOT = path.join(__dirname, '../data/greet')

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
    console.error(`[GOODBYE] save error:`, e.message)
  }
}

const DEFAULT_GOODBYE = 'Goodbye @{tag}! 👋\nWe\'ll miss you in *{group}*.\nWe now have *{members}* members.'

module.exports = {
  pattern: 'goodbye',
  alias: ['goodbye'],
  category: 'group/admin',
  desc: 'Set custom goodbye messages for members who leave',
  usage: '.goodbye on|off|set|view',

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

    const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
    const data = loadGreet(phone, from)

    const cmd = args[0]?.toLowerCase()

    if (cmd === 'on') {
      data.goodbye = { ...data.goodbye, enabled: true, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `✅ *Goodbye messages enabled*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'off') {
      data.goodbye = { ...data.goodbye, enabled: false, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `❌ *Goodbye messages disabled*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'view') {
      const msg_text = data.goodbye?.message || DEFAULT_GOODBYE
      return sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  👋 *GOODBYE MESSAGE*  ║\n╚════════════════════════╝\n\n${msg_text}\n\n*Status:* ${data.goodbye?.enabled ? '✅ ON' : '❌ OFF'}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (cmd === 'set') {
      const newMsg = args.slice(1).join(' ').trim()
      if (!newMsg) {
        return sock.sendMessage(from, {
          text: `❌ *Provide a message*\n*.goodbye set <message>*\n\nUse {tag}, {group}, {members}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      data.goodbye = { message: newMsg, enabled: true, updatedAt: Date.now() }
      saveGreet(phone, from, data)
      return sock.sendMessage(from, {
        text: `✅ *Goodbye message set!*\n\n${newMsg}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text: `╔════════════════════════╗\n║  👋 *GOODBYE COMMAND*  ║\n╚════════════════════════╝\n\n*.goodbye on* — enable\n*.goodbye off* — disable\n*.goodbye set <msg>* — customize\n*.goodbye view* — see current\n\n*Variables:*\n{tag} — user phone\n{group} — group name\n{members} — member count\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      quoted: msg
    })
  },

  loadGreet,
  saveGreet,
  greetFile
}
