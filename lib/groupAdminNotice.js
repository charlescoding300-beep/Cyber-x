'use strict'

const { sendMessageUnstyled } = require('../core/responseTextStyle')

const BOT_NOT_ADMIN_NOTICE =
  '*❌ 𝙱𝙾𝚃 𝙽𝙾𝚃 𝙰𝙽 𝙰𝙳𝙼𝙸𝙽.*\n' +
  '*— 𝙿𝚁𝙾𝙼𝙾𝚃𝙴 𝚃𝙷𝙴 𝙱𝙾𝚃 𝚃𝙾 𝙰𝙳𝙼𝙸𝙽 𝚃𝙾 𝙲𝙾𝙽𝚃𝙸𝙽𝚄𝙴.*'

const OWNER_RESTRICTED_NOTICE =
  '*❌ 𝚁𝙴𝚂𝚃𝚁𝙸𝙲𝚃𝙴𝙳.*\n' +
  '*— 𝙾𝙽𝙻𝚈 𝚃𝙷𝙴 𝙱𝙾𝚃 𝙾𝚆𝙽𝙴𝚁 𝙲𝙰𝙽 𝚄𝚂𝙴.*'

function sendBotNotAdmin(sock, chat, sourceMessage) {
  const options = sourceMessage?.key?.id ? { quoted: sourceMessage } : {}
  return sock.sendMessage(chat, { text: BOT_NOT_ADMIN_NOTICE }, options)
}

function sendOwnerRestricted(sock, chat, sourceMessage) {
  const options = sourceMessage?.key?.id ? { quoted: sourceMessage } : {}
  return sock.sendMessage(chat, { text: OWNER_RESTRICTED_NOTICE }, options)
}

function sendGroupAdminRestricted(sock, chat, sourceMessage, commandLabel) {
  const label = String(commandLabel || 'This command').trim()
  const text =
    '*❌ 𝚁𝙴𝚂𝚃𝚁𝙸𝙲𝚃𝙴𝙳.*\n' +
    `*— ${label} 𝙸𝚂 𝙾𝙽𝙻𝚈 𝙵𝙾𝚁 𝙶𝚁𝙾𝚄𝙿 𝙰𝙳𝙼𝙸𝙽𝚂.*`
  const options = sourceMessage?.key?.id ? { quoted: sourceMessage } : {}
  return sendMessageUnstyled(sock, chat, { text }, options)
}

module.exports = {
  BOT_NOT_ADMIN_NOTICE,
  OWNER_RESTRICTED_NOTICE,
  sendBotNotAdmin,
  sendOwnerRestricted,
  sendGroupAdminRestricted,
}
