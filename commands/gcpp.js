'use strict'

const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const Pino = require('pino')
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

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
  if (content?.imageMessage) return { content, type: 'image', node: content.imageMessage }

  // WhatsApp can send an image as a document to preserve its original quality.
  const document = content?.documentMessage
  if (document?.mimetype && /^image\//i.test(document.mimetype)) {
    return { content, type: 'document', node: document }
  }
  return null
}

function isPermissionError(error) {
  const status = Number(error?.output?.statusCode || error?.statusCode || error?.status || 0)
  if (status === 401 || status === 403) return true
  return /not[- ]admin|not[- ]authorized|admin permission|not authorized/i.test(String(error?.message || ''))
}

module.exports = {
  name: 'gcpp',
  aliases: [],
  desc: 'Set the group profile picture from an image',
  usage: 'Reply to an image with .gcpp, or send an image with caption .gcpp',
  category: 'group',
  media: true,

  async run({ sock, from, msg, sender }) {
    const reply = text => sock.sendMessage(from, { text }, { quoted: msg })

    if (!from?.endsWith('@g.us')) {
      return reply('❌ .gcpp only works in a group chat.')
    }
    if (typeof sock.updateProfilePicture !== 'function') {
      return reply('⚠️ This WhatsApp connection cannot update group profile pictures.')
    }

    let access
    try {
      access = await adminLib.getGroupAdminContext(
        sock,
        from,
        sender || msg?.key?.participant,
        msg?.key?.participantPn || msg?.key?.participantAlt,
      )
    } catch (error) {
      console.error('[GCPP] Permission lookup failed:', error?.message || error)
      return reply('⚠️ I could not verify the group-admin permissions. Please try again.')
    }

    if (!access?.available) {
      return reply('⚠️ I could not verify the group-admin permissions. Please try again.')
    }
    if (!access.senderAdmin) {
      return reply('❌ Only a group admin can use .gcpp.')
    }
    if (!access.botAdmin) {
      return sendBotNotAdmin(sock, from, msg)
    }

    const currentImage = imageFrom(msg?.message)
    let downloadTarget = msg
    let targetImage = currentImage

    if (!targetImage) {
      const context = contextOf(msg)
      const quotedMessage = context?.quotedMessage
      targetImage = imageFrom(quotedMessage)

      if (!targetImage || !context?.stanzaId) {
        return reply(
          '🖼️ Reply to an image with .gcpp, or send an image with .gcpp as its caption.'
        )
      }

      downloadTarget = {
        key: {
          remoteJid: from,
          id: context.stanzaId,
          participant: context.participant || context.participantPn ||
            (context.fromMe ? sock.user?.id : undefined),
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
        return reply('❌ I could not read that image. Please send it again and retry .gcpp.')
      }
      if (image.length > MAX_IMAGE_BYTES) {
        return reply('❌ That image is too large. Please use an image under 20 MB.')
      }

      await sock.updateProfilePicture(from, image)
      return reply('✅ The group profile picture was updated.')
    } catch (error) {
      console.error('[GCPP] Failed to update group picture:', error?.message || error)
      if (isPermissionError(error)) return sendBotNotAdmin(sock, from, msg)
      return reply('❌ I could not update the group picture. Check that the image is valid and try again.')
    }
  },
}
