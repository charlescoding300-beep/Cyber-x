'use strict'

const { getGroupPresence } = require('../core/online-presence')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

function cleanJid(jid) {
  return String(jid || '').replace(/:\d+(?=@)/, '')
}

async function phoneJidForDisplay(sock, jid) {
  const clean = cleanJid(jid)
  if (!clean.endsWith('@lid')) return clean

  try {
    const result = await sock.signalRepository?.lidMapping?.getPNForLID?.(clean)
    const value = typeof result === 'string' ? result : result?.phoneNumber
    if (typeof value !== 'string' || !value.trim()) return clean
    if (value.includes('@')) return cleanJid(value)
    const number = value.replace(/\D/g, '')
    return number ? `${number}@s.whatsapp.net` : clean
  } catch {
    return clean
  }
}

function displayId(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '') || 'member'
}

function checkedTime() {
  const time = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())
  return `${time} WAT`
}

module.exports = {
  name: 'listonline',
  aliases: [],
  desc: 'Show group members whose online presence WhatsApp shares with the bot',
  usage: '.listonline',
  category: 'group',

  run: async ({ sock, from, msg, isGroup, groupCache }) => {
    const reply = (text, mentions = []) =>
      sock.sendMessage(from, { text, mentions }, { quoted: msg })

    if (!isGroup || !String(from).endsWith('@g.us')) {
      return reply(`❌ .listonline only works inside a group.\n\n${CREDIT}`)
    }

    try {
      let participants = Array.isArray(groupCache?.[from]?.participants)
        ? groupCache[from].participants
        : []
      try {
        const metadata = await sock.groupMetadata(from)
        if (Array.isArray(metadata?.participants)) participants = metadata.participants
      } catch (error) {
        if (!participants.length) throw error
      }

      const presence = await getGroupPresence(sock, from, participants)

      const noOnlineMembers = !presence.members.length && (
        (presence.countFromWhatsApp && presence.onlineCount === 0) || presence.hasMemberPresence
      )
      if (noOnlineMembers) {
        const output =
          '┏━━━━━━━「 ONLINE MEMBERS 」━━━━━━━┓\n' +
          '┃ 💤 No members appear to be online.\n' +
          `┃ ⏱️ Last checked: ${checkedTime()}\n` +
          '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n' +
          CREDIT
        return reply(output)
      }

      // Tag with the exact JID supplied by presence events. Resolve LIDs only
      // for a readable phone-number label; this avoids fake @digits tags.
      const taggedMembers = await Promise.all(presence.members.map(async member => ({
        mentionJid: cleanJid(member.jid),
        displayJid: await phoneJidForDisplay(sock, member.displayJid || member.jid),
      })))
      const uniqueMembers = [...new Map(taggedMembers.map(member => [member.mentionJid, member])).values()]
      const rows = uniqueMembers.map(({ displayJid }) => `┃ @${displayId(displayJid)}`)
      if (!rows.length) {
        rows.push(`┃ ${presence.hasPresenceData
          ? 'WhatsApp reports online activity, but did not share member IDs.'
          : 'WhatsApp has not shared live presence for this group yet.'}`)
        rows.push(`┃ ⏱️ Last checked: ${checkedTime()}`)
      } else if (presence.countFromWhatsApp && presence.onlineCount > rows.length) {
        rows.push('┃ WhatsApp did not share every online member name.')
      }

      const count = presence.hasPresenceData ? presence.onlineCount : '—'
      const output =
        '┏━━━━━━━「 ONLINE MEMBERS 」━━━━━━━┓\n' +
        `┃ 🟢 Online: ${count}\n` +
        '┃\n' +
        rows.join('\n') + '\n' +
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n' +
        CREDIT

      return reply(output, uniqueMembers.map(({ mentionJid }) => mentionJid))
    } catch (error) {
      console.error(`[LISTONLINE:${from}]`, error?.message || error)
      return reply(`❌ Could not read group online presence. WhatsApp may not have provided it yet.\n\n${CREDIT}`)
    }
  },
}
