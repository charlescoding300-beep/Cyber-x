'use strict'

let db = null
try { db = require('./userDb') } catch {}

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

async function handleVmute(sock, msg, phone) {
  try {
    const from = msg.key?.remoteJid
    if (!from?.endsWith('@g.us')) return

    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'
    let muted = getMuted(owner, from)
    if (!muted.length) return

    const sender = msg.key.participant || msg.key.remoteJid
    const now = Date.now()

    // Clean expired
    const stillMuted = muted.filter(u => !u.until || u.until > now)
    if (stillMuted.length !== muted.length) {
      setMuted(owner, from, stillMuted)
      muted = stillMuted
    }

    const isMuted = muted.some(u => u.jid === sender)
    if (!isMuted) return

    // Delete message
    try {
      await sock.sendMessage(from, { delete: msg.key })
    } catch (e) {
      console.error('[VMUTE] delete failed:', e.message)
    }

    // Reaction
    try {
      await sock.sendMessage(from, { react: { text: '🔇', key: msg.key } })
    } catch {}

  } catch (e) {
    console.error('[VMUTE]', e.message)
  }
}

module.exports = {
  handleVmute,
  getMuted
}
