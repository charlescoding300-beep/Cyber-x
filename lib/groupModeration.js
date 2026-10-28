'use strict'

const adminLib = require('./isAdmin')

function normalizeMentionJid(candidate) {
  if (candidate == null) return null
  let value = String(candidate).trim()
  if (!value) return null

  const at = value.lastIndexOf('@')
  if (at < 0) {
    const digits = value.replace(/\D/g, '')
    return /^\d{7,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null
  }

  let local = value.slice(0, at).replace(/:\d+$/, '')
  let domain = value.slice(at + 1).toLowerCase()
  if (!local) return null
  if (domain === 'c.us') domain = 's.whatsapp.net'
  if (domain !== 's.whatsapp.net' && domain !== 'lid') return null
  return `${local}@${domain}`
}

function getParticipantMention(participants, sender, senderAlt) {
  const list = Array.isArray(participants) ? participants : []
  const participant = list.find(item => adminLib.participantMatches(item, sender, senderAlt)) || null
  const candidates = [
    participant?.phoneNumber,
    senderAlt,
    participant?.jid,
    participant?.id,
    sender,
    participant?.lid,
  ]
  const jids = candidates.map(normalizeMentionJid).filter(Boolean)
  const jid = jids.find(value => value.endsWith('@s.whatsapp.net')) || jids[0] || null
  return {
    participant,
    jid,
    tag: jid ? jid.slice(0, jid.lastIndexOf('@')).replace(/:\d+$/, '') : 'user',
  }
}

function isRetryableDeleteError(error) {
  const code = String(error?.code || error?.output?.payload?.code || '').toUpperCase()
  const status = Number(error?.statusCode || error?.output?.statusCode || error?.data?.statusCode)
  if ([408, 500, 502, 503, 504].includes(status)) return true
  return ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH'].includes(code) ||
    /timed? ?out|connection closed|socket hang up|network error/i.test(String(error?.message || ''))
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function deleteGroupMessage(sock, message, fallbackParticipant) {
  const key = message?.key
  if (!key?.remoteJid?.endsWith('@g.us') || !key.id) {
    return { deleted: false, error: new Error('Incoming group message has no complete deletion key') }
  }

  // Preserve Baileys' original key exactly. A few Baileys builds expose the
  // author outside key.participant, so supply it only when the key lacks it.
  const participant = key.participant || fallbackParticipant ||
    message?.participantPn || message?.participantAlt || null
  const deleteKey = key.participant || !participant ? key : { ...key, participant }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await sock.sendMessage(key.remoteJid, { delete: deleteKey })
      return { deleted: true }
    } catch (error) {
      if (attempt === 0 && isRetryableDeleteError(error)) {
        await delay(300)
        continue
      }
      return { deleted: false, error }
    }
  }

  return { deleted: false, error: new Error('Delete retry exhausted') }
}

module.exports = { normalizeMentionJid, getParticipantMention, deleteGroupMessage }
