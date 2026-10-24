'use strict'
const { sendOwnerRestricted } = require('../lib/groupAdminNotice')

const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const Pino = require('pino')

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const logger = Pino({ level: 'silent' })

function unwrap(message) {
  return (
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.viewOnceMessageV2Extension?.message ||
    message
  )
}

function contextOf(message) {
  const content = unwrap(message?.message)
  return (
    content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    null
  )
}

function imageFrom(message) {
  const content = unwrap(message)
  if (content?.imageMessage) return { content }

  // Images sent as documents retain their original quality and can also be used.
  const document = content?.documentMessage
  if (document?.mimetype && /^image\//i.test(document.mimetype)) return { content, node: document }
  return null
}

module.exports = {
  name: 'mypp',
  aliases: [],
  desc: 'Set the bot account profile picture from an image',
  usage: 'Reply to an image with .mypp, or send an image with caption .mypp',
  category: 'owner',
  media: true,

  async run({ sock, from, msg, isOwner }) {
    const reply = text => sock.sendMessage(from, { text }, { quoted: msg })

    if (!isOwner) return sendOwnerRestricted(sock, msg?.key?.remoteJid, msg)

    const ownJid = sock.user?.id || sock.user?.lid
    if (!ownJid || typeof sock.updateProfilePicture !== 'function') {
      return reply('⚠️ This WhatsApp session cannot update its profile picture right now.')
    }

    let targetImage = imageFrom(msg?.message)
    let downloadTarget = msg

    if (!targetImage) {
      const context = contextOf(msg)
      targetImage = imageFrom(context?.quotedMessage)
      if (!targetImage || !context?.stanzaId) {
        return reply('🖼️ Reply to an image with .mypp, or send an image with .mypp as its caption.')
      }

      downloadTarget = {
        key: {
          remoteJid: from,
          id: context.stanzaId,
          participant: context.participant || context.participantPn ||
            (context.fromMe ? ownJid : undefined),
          fromMe: context.fromMe === true,
        },
        message: targetImage.content,
      }
    }

    const declaredSize = Number(targetImage.node?.fileLength || 0)
    if (declaredSize > MAX_IMAGE_BYTES) {
      return reply('❌ That image is too large. Please use an image under 20 MB.')
    }

    try {
      const image = await downloadMediaMessage(downloadTarget, 'buffer', {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      })

      if (!Buffer.isBuffer(image) || image.length < 10) {
        return reply('❌ I could not read that image. Please send it again and retry .mypp.')
      }
      if (image.length > MAX_IMAGE_BYTES) {
        return reply('❌ That image is too large. Please use an image under 20 MB.')
      }

      await sock.updateProfilePicture(ownJid, image)
      return reply('✅ Your profile picture added successfully.')
    } catch (error) {
      console.error('[MYPP] Failed to update profile picture:', error?.message || error)
      return reply('❌ I could not update the profile picture. Check that the image is valid and try again.')
    }
  },
}
