'use strict'

const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

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

function isBotAdminError(error) {
  const status = Number(error?.output?.statusCode || error?.statusCode || error?.status || 0)
  if (status === 401 || status === 403) return true

  const reason = [error?.message, error?.data?.content, error?.output?.payload?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return /not[- ]authorized|not[- ]admin|admin(?:istrator)? (?:required|permission)|requires? admin|only admins?/.test(reason)
}

module.exports = {
  pattern: 'del',
  aliases: ['delete'],
  category: 'utility',
  description: 'Delete a replied-to message',

  run: async ({ sock, from, msg, isAdmin, isOwner, isGroup }) => {
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

      // A reaction acknowledges success without posting another group message.
      if (msg?.key) {
        try {
          await sock.sendMessage(from, {
            react: { text: '🗑️', key: msg.key },
          })
        } catch (reactionError) {
          // Deletion already succeeded; a failed reaction must not change that.
          console.error('[DEL REACTION ERROR]', reactionError?.message || reactionError)
        }
      }
      return
    } catch (error) {
      console.error('[DEL ERROR]', error?.message || error)
      if (isGroup && !isOwnMessage && isBotAdminError(error)) {
        return sendBotNotAdmin(sock, from, msg)
      }
      // Other failures stay quiet too; log details for the operator instead of
      // cluttering the group with an unrelated status message.
      return
    }
  },
}
