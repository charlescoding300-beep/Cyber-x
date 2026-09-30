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

function parseTime(str) {
  if (!str) return null
  const match = str.toLowerCase().match(/^(\d+)(s|m|h|d)$/)
  if (!match) return null
  const num = parseInt(match[1])
  const unit = match[2]
  if (unit === 's') return num * 1000
  if (unit === 'm') return num * 60 * 1000
  if (unit === 'h') return num * 60 * 60 * 1000
  if (unit === 'd') return num * 24 * 60 * 60 * 1000
  return null
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

module.exports = {
  pattern: 'vmute',
  alias: ['voicemute', 'smute'],
  desc: 'Mute a member — bot will delete all their messages',
  usage: '.vmute [time] (reply to user) | .vmute list',
  category: 'group',

  async run({ sock, from, msg, args, isGroup, isAdmin, isBotAdmin, isOwner }) {
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `> ❌ *This command only works in groups.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *I need to be admin to mute members.*\n>\n${CREDIT}`,
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
    const sub = (args[0] || '').toLowerCase()

    // .vmute list
    if (sub === 'list') {
      let muted = getMuted(phone, from)
      const now = Date.now()
      muted = muted.filter(u => !u.until || u.until > now)
      setMuted(phone, from, muted)

      if (!muted.length) {
        return sock.sendMessage(from, {
          text: `> 📋 *No one is currently muted.*\n>\n${CREDIT}`,
          quoted: msg
        })
      }

      const text = muted.map((u, i) => {
        const jid = u.jid
        const left = u.until ? ` (${formatTime(u.until - now)} left)` : ' (permanent)'
        return `\( {i + 1}. @ \){jid.split('@')[0]}${left}`
      }).join('\n')

      return sock.sendMessage(from, {
        text: `> 🔇 *Muted Members*\n>\n\( {text}\n>\n \){CREDIT}`,
        mentions: muted.map(u => u.jid),
        quoted: msg
      })
    }

    // Must reply to someone
    const quoted = msg.message?.extendedTextMessage?.contextInfo
    const target = quoted?.participant || quoted?.remoteJid

    if (!target) {
      return sock.sendMessage(from, {
        text: `> ❌ *Reply to a user*\n>\nExamples:\n> *.vmute*\n> *.vmute 30m*\n> *.vmute 1h*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    if (target === sock.user.id) {
      return sock.sendMessage(from, {
        text: `> ❌ *I can't mute myself.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    let muted = getMuted(phone, from)
    const now = Date.now()

    // Remove expired + same target
    muted = muted.filter(u => u.jid !== target && (!u.until || u.until > now))

    // Parse time
    let duration = null
    let timeText = 'permanently'

    if (sub && sub !== 'list') {
      duration = parseTime(sub)
      if (!duration) {
        return sock.sendMessage(from, {
          text: `> ❌ *Invalid time*\n>\nExamples: \`30s\` \`10m\` \`1h\` \`2h\` \`1d\`\n>\n${CREDIT}`,
          quoted: msg
        })
      }
      timeText = `for ${formatTime(duration)}`
    }

    const muteData = duration
      ? { jid: target, until: now + duration }
      : { jid: target }

    muted.push(muteData)
    setMuted(phone, from, muted)

    return sock.sendMessage(from, {
      text: `> 🔇 *MEMBER MUTED*\n>\n> 👤 @\( {target.split('@')[0]}\n> ⏱️ Duration: * \){timeText}*\n> 🗑️ All messages will be deleted\n>\n${CREDIT}`,
      mentions: [target],
      quoted: msg
    })
  }
}
