'use strict'

const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

function successMessage(count) {
  return `*✅ 𝙰𝙿𝙿𝚁𝙾𝚅𝙰𝙻 𝚂𝚄𝙲𝙲𝙴𝚂𝚂𝙵𝚄𝙻.*\n` +
    `*— ${count} 𝙼𝙴𝙼𝙱𝙴𝚁(𝚂) 𝙹𝙾𝙸𝙽𝙴𝙳 𝚃𝙷𝙴 𝙶𝚁𝙾𝚄𝙿.*`
}

function isPermissionError(error) {
  const status = Number(error?.output?.statusCode || error?.statusCode || error?.status || 0)
  if (status === 401 || status === 403) return true
  const reason = String(error?.message || '').toLowerCase()
  return /not[- ]admin|not[- ]authorized|admin permission|not authorized/.test(reason)
}

module.exports = {
  pattern: 'approveall',
  category: 'group',
  adminOnly: true,
  botAdmin: true,
  desc: 'Approve all pending group join requests',
  usage: '.approveall',

  run: async ({ sock, from, msg, sender, isGroup }) => {
    const reply = text => sock.sendMessage(from, { text }, { quoted: msg })

    if (!isGroup || !from?.endsWith('@g.us')) {
      return reply('❌ This command only works in groups.')
    }
    if (typeof sock.groupRequestParticipantsList !== 'function' ||
        typeof sock.groupRequestParticipantsUpdate !== 'function') {
      return reply('⚠️ This WhatsApp connection does not support join-request approvals.')
    }

    try {
      const access = await adminLib.getGroupAdminContext(
        sock,
        from,
        sender,
        msg?.key?.participantPn || msg?.key?.participantAlt,
      )
      if (!access?.available) {
        return reply('⚠️ I could not verify the current group permissions. Please try again.')
      }
      if (!access.botAdmin) return sendBotNotAdmin(sock, from, msg)
      if (!access.senderAdmin) {
        return reply('❌ Only a group admin can use this command.')
      }

      const pending = await sock.groupRequestParticipantsList(from)
      const jids = [...new Set((Array.isArray(pending) ? pending : [])
        .map(request => request?.jid || request?.id || request?.participant)
        .filter(jid => typeof jid === 'string' && jid.includes('@')))]

      if (!jids.length) {
        return reply('ℹ️ There are no pending join requests.')
      }

      const results = await sock.groupRequestParticipantsUpdate(from, jids, 'approve')
      const outcomes = Array.isArray(results) ? results : []
      const approved = outcomes.filter(result => {
        const status = Number(result?.status)
        return Number.isFinite(status) && status >= 200 && status < 300
      }).length

      if (approved === jids.length) return reply(successMessage(approved))
      if (!approved) {
        return reply('⚠️ WhatsApp did not approve the pending join requests. Please try again.')
      }
      return reply(`⚠️ Approved ${approved} of ${jids.length} pending join requests.`)
    } catch (error) {
      console.error('[APPROVEALL]', error?.message || error)
      if (isPermissionError(error)) return sendBotNotAdmin(sock, from, msg)
      return reply('⚠️ Could not approve the pending join requests. Please try again.')
    }
  },
}
