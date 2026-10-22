'use strict'

const adminLib = require('../lib/isAdmin')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

function digits(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function contextOf(msg) {
  const message = msg?.message?.ephemeralMessage?.message ||
    msg?.message?.viewOnceMessageV2?.message ||
    msg?.message?.viewOnceMessage?.message ||
    msg?.message || {}
  return message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo || null
}

module.exports = {
  pattern: 'del',
  aliases: ['delete'],
  category: 'utility',
  description: 'Delete a replied-to message',

  run: async ({ sock, from, msg, isAdmin, isOwner, isGroup, isBotAdmin, groupCache }) => {
    const reply = text => sock.sendMessage(from, {
      text: `${text}\n\n${CREDIT}`,
    }, { quoted: msg })

    const contextInfo = contextOf(msg)
    if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) {
      return reply('❌ Reply to a message with *.del* to delete it.')
    }

    const participant = contextInfo.participant || contextInfo.participantAlt || ''
    const ownIds = new Set([sock.user?.id, sock.user?.lid].map(digits).filter(Boolean))
    const isOwnMessage = contextInfo.fromMe === true ||
      contextInfo.quotedMessage?.key?.fromMe === true ||
      [contextInfo.participant, contextInfo.participantAlt].some(id => id && ownIds.has(digits(id)))

    if (isGroup && !isOwnMessage) {
      if (!isAdmin && !isOwner) {
        return reply('⚠️ Only a group admin or the bot owner can request deletion of another member’s message.')
      }

      // Recompute from the cached participant list. The owner override used by
      // command authorization does not grant the WhatsApp account admin rights.
      const botHasGroupAdmin = adminLib.isBotAdmin(groupCache, from, sock) ||
        (isBotAdmin && !isOwner)
      if (!botHasGroupAdmin) {
        return reply('⚠️ WhatsApp requires the bot itself to be a group admin to delete another member’s message. Bot-owner access cannot override this. I can still delete messages sent by this bot account.')
      }
      if (!participant) {
        return reply('⚠️ I could not identify who sent that message. Reply to it again and retry.')
      }
    }

    try {
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: isOwnMessage,
          id: contextInfo.stanzaId,
          ...(participant ? { participant } : {}),
        },
      })

      return reply('✅ Deleted the replied-to message.')
    } catch (error) {
      console.error('[DEL ERROR]', error?.message || error)
      const explanation = isGroup && !isOwnMessage
        ? '⚠️ WhatsApp did not delete that message. Check that the bot account is still a group admin, then try again.'
        : '⚠️ WhatsApp could not delete that message. It may be too old or outside this account’s permissions.'
      return reply(explanation)
    }
  },
}
