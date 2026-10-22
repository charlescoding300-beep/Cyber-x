'use strict'

const BOT_NOT_ADMIN_NOTICE =
  '┏━━━━━━━「 BOT NOT ADMIN 」━━━━━━━┓\n' +
  '┃ ⚠️ I need admin permission to do that.\n' +
  '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'

function sendBotNotAdmin(sock, chat, sourceMessage) {
  const options = sourceMessage?.key?.id ? { quoted: sourceMessage } : {}
  return sock.sendMessage(chat, { text: BOT_NOT_ADMIN_NOTICE }, options)
}

module.exports = { BOT_NOT_ADMIN_NOTICE, sendBotNotAdmin }
