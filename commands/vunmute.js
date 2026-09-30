'use strict'

let db
try { db = require('../lib/userDb') } catch { db = null }

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

function getMuted(phone, jid) {
  if (!db) return []
  const s = db.getSection(phone, 'vmute') || { groups: {} }
  return s.groups?.[jid] || []
}

function setMuted(phone, jid, list) {
  if (!db) return
  const s = db.getSection(phone, 'vmute') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = list
  db.setSection(phone, 'vmute', s)
}

module.exports = {
  pattern: 'vunmute',
  alias: ['vum', 'unsilent'],
  desc: 'Unmute a muted member',
  usage: '.vunmute (reply to user)',
  category: 'group',

  async run({ sock, from, msg, isGroup, isAdmin, isBotAdmin, isOwner }) {
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `> ❌ *This command only works in groups.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *I need to be admin.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }
    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, {
        text: `> ❌ *Only group admins can use this command.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'

    const quoted = msg.message?.extendedTextMessage?.contextInfo
    const target = quoted?.participant || quoted?.remoteJid

    if (!target) {
      return sock.sendMessage(from, {
        text: `> ❌ *Reply to the muted user*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    let muted = getMuted(phone, from)
    const before = muted.length
    muted = muted.filter(u => u.jid !== target)
    setMuted(phone, from, muted)

    if (muted.length === before) {
      return sock.sendMessage(from, {
        text: `> ℹ️ @\( {target.split('@')[0]} is not muted.\n>\n \){CREDIT}`,
        mentions: [target],
        quoted: msg
      })
    }

    return sock.sendMessage(from, {
      text: `> 🔊 *MEMBER UNMUTED*\n>\n> 👤 @\( {target.split('@')[0]}\n> ✅ Can send messages again\n>\n \){CREDIT}`,
      mentions: [target],
      quoted: msg
    })
  }
}
