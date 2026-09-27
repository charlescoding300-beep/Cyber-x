'use strict'
/**
 * lib/antisticker.js — 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 Anti-Sticker
 * Only deletes stickers. Ignores images & videos.
 */

let db = null
try { db = require('./userDb') } catch {}

function getCfg(phone, jid) {
  if (!db) {
    return { enabled: false, action: 'delete', maxWarns: 3, applyToAdmins: false }
  }
  const s = db.getSection(phone, 'antisticker') || { groups: {} }
  const g = s.groups?.[jid] || {}
  return {
    enabled: !!g.enabled,
    action: g.action || 'delete',
    maxWarns: Math.max(1, parseInt(g.maxWarns, 10) || 3),
    applyToAdmins: !!g.applyToAdmins,
  }
}

function setCfg(phone, jid, updates) {
  if (!db) return
  const s = db.getSection(phone, 'antisticker') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = {
    enabled: false,
    action: 'delete',
    maxWarns: 3,
    applyToAdmins: false,
    ...(s.groups[jid] || {}),
    ...updates,
  }
  db.setSection(phone, 'antisticker', s)
}

function getWarnCount(phone, jid, user) {
  if (!db) return 0
  const s = db.getSection(phone, 'antisticker_warns') || { groups: {} }
  return s.groups?.[jid]?.[user] || 0
}

function addWarn(phone, jid, user) {
  if (!db) return 1
  const s = db.getSection(phone, 'antisticker_warns') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = s.groups[jid] || {}
  s.groups[jid][user] = (s.groups[jid][user] || 0) + 1
  db.setSection(phone, 'antisticker_warns', s)
  return s.groups[jid][user]
}

function resetWarn(phone, jid, user) {
  if (!db) return
  const s = db.getSection(phone, 'antisticker_warns') || { groups: {} }
  if (s.groups?.[jid]) {
    s.groups[jid][user] = 0
    db.setSection(phone, 'antisticker_warns', s)
  }
}

let isAdminLib = null
try { isAdminLib = require('./isAdmin') } catch {}

async function getAdminFlags(sock, jid, sender, senderAlt) {
  let botAdmin = false
  let senderAdmin = false
  try {
    if (isAdminLib) {
      const meta = await sock.groupMetadata(jid)
      const cache = { [jid]: meta }
      botAdmin = !!isAdminLib.isBotAdmin(cache, jid, sock)
      senderAdmin = !!isAdminLib.isAdmin(cache, jid, sender, sock, null, senderAlt)
    } else {
      const meta = await sock.groupMetadata(jid)
      const botNum = String(sock.user?.id || '').split(':')[0].replace(/\D/g, '')
      const senderNum = String(sender || '').split('@')[0].replace(/\D/g, '')
      for (const p of meta.participants || []) {
        const id = String(p.id || '').split('@')[0].replace(/\D/g, '')
        const isAdm = p.admin === 'admin' || p.admin === 'superadmin'
        if (id === botNum && isAdm) botAdmin = true
        if (id === senderNum && isAdm) senderAdmin = true
      }
    }
  } catch (e) {
    console.error('[ANTISTICKER] admin check:', e.message)
  }
  return { botAdmin, senderAdmin }
}

function tagOf(jid) {
  return String(jid.split('@')[0] || '').replace(/:\d+$/, '')
}

function isSticker(msg) {
  const m = msg.message || {}
  return !!(
    m.stickerMessage ||
    m.ephemeralMessage?.message?.stickerMessage ||
    m.viewOnceMessage?.message?.stickerMessage ||
    m.viewOnceMessageV2?.message?.stickerMessage
  )
}

async function handleAntistickerInline(sock, msg, phone) {
  try {
    const from = msg.key?.remoteJid
    if (!from?.endsWith('@g.us')) return

    // Only stickers
    if (!isSticker(msg)) return

    const owner = String(phone || sock.user?.id || '').split(':')[0].replace(/\D/g, '') || 'default'
    const cfg = getCfg(owner, from)
    if (!cfg.enabled) return

    const sender = msg.key.participant || from
    const senderAlt = msg.key.participantPn || null
    const tag = tagOf(sender)
    const { botAdmin, senderAdmin } = await getAdminFlags(sock, from, sender, senderAlt)

    // Members-only mode: skip group admins
    if (!cfg.applyToAdmins && senderAdmin) return

    // Bot not admin → notify only
    if (!botAdmin) {
      await sock.sendMessage(from, {
        text: `🚫 *Sticker detected*\n\n@${tag} sent a sticker, but I am *not a group admin*, so I cannot delete it.\n\nPlease promote me to admin.`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    // React
    try { await sock.sendMessage(from, { react: { text: '🚫', key: msg.key } }) } catch {}

    const action = cfg.action || 'delete'
    const maxW = cfg.maxWarns || 3

    // Delete the sticker
    try {
      await sock.sendMessage(from, { delete: msg.key })
    } catch (e) {
      console.error('[ANTISTICKER] delete failed:', e.message)
    }

    if (action === 'delete') {
      await sock.sendMessage(from, {
        text: `╔══════════════════════╗
║  🚫  STICKER REMOVED  ║
╚══════════════════════╝

👤 @${tag}
📌 Stickers are not allowed here.

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove')
      } catch (e) {
        console.error('[ANTISTICKER] kick failed:', e.message)
      }
      await sock.sendMessage(from, {
        text: `╔══════════════════════╗
║  🚫  MEMBER REMOVED   ║
╚══════════════════════╝

👤 @${tag}
📌 Removed for sending stickers.

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'warn') {
      const count = addWarn(owner, from, sender)
      if (count >= maxW) {
        resetWarn(owner, from, sender)
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove')
        } catch (e) {
          console.error('[ANTISTICKER] kick-after-warn failed:', e.message)
        }
        await sock.sendMessage(from, {
          text: `╔════════════════════════╗
║  🚫  REMOVED (WARN MAX) ║
╚════════════════════════╝

👤 @${tag}
⚠️ Warnings: *\( {count}/ \){maxW}*
📌 Sent stickers too many times.

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
          mentions: [sender],
        }, { quoted: msg }).catch(() => {})
      } else {
        const left = maxW - count
        await sock.sendMessage(from, {
          text: `╔══════════════════════╗
║  ⚠️  WARNING \( {count}/ \){maxW}      ║
╚══════════════════════╝

👤 @${tag}
🚫 Stickers are not allowed.
⏳ *\( {left}* more warning \){left === 1 ? '' : 's'} → removal

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
          mentions: [sender],
        }, { quoted: msg }).catch(() => {})
      }
    }
  } catch (e) {
    console.error('[ANTISTICKER]', e.message)
  }
}

module.exports = {
  handleAntistickerInline,
  handleAntisticker: handleAntistickerInline,
  antistickerEnable: (p, j, action = 'delete', maxWarns = 3, applyToAdmins = false) =>
    setCfg(p, j, { enabled: true, action, maxWarns, applyToAdmins }),
  antistickerDisable: (p, j) => setCfg(p, j, { enabled: false }),
  antistickerIsEnabled: (p, j) => !!getCfg(p, j).enabled,
  antistickerGetAction: (p, j) => getCfg(p, j).action || 'delete',
  getConfig: getCfg,
  setConfig: setCfg,
  getWarnCount,
  resetWarn,
  addWarn,
}
