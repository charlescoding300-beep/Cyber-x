'use strict'
const { sendBotNotAdmin } = require('./groupAdminNotice')
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
  const warnings = s.groups?.[jid] || {}
  const key = Object.keys(warnings).find(stored => stableJid(stored) === stableJid(user))
  return key ? Number(warnings[key]) || 0 : 0
}

const stableJid = value => String(value || '').replace(/:\d+(?=@)/, '')

function addWarn(phone, jid, user) {
  if (!db) return 1
  const s = db.getSection(phone, 'antisticker_warns') || { groups: {} }
  s.groups = s.groups || {}
  s.groups[jid] = s.groups[jid] || {}
  const warnings = s.groups[jid]
  const key = Object.keys(warnings).find(stored => stableJid(stored) === stableJid(user)) || stableJid(user)
  warnings[key] = (Number(warnings[key]) || 0) + 1
  db.setSection(phone, 'antisticker_warns', s)
  return warnings[key]
}

function resetWarn(phone, jid, user) {
  if (!db) return
  const s = db.getSection(phone, 'antisticker_warns') || { groups: {} }
  const warnings = s.groups?.[jid]
  if (warnings) {
    for (const stored of Object.keys(warnings)) {
      if (stableJid(stored) === stableJid(user)) delete warnings[stored]
    }
    db.setSection(phone, 'antisticker_warns', s)
  }
}

let isAdminLib = null
try { isAdminLib = require('./isAdmin') } catch {}

async function getAdminFlags(sock, jid, sender, senderAlt) {
  try {
    if (!isAdminLib?.getGroupAdminContext) throw new Error('shared WhatsApp admin checker is unavailable')
    return await isAdminLib.getGroupAdminContext(sock, jid, sender, senderAlt)
  } catch (e) {
    console.error('[ANTISTICKER] admin check:', e.message)
    return { botAdmin: false, senderAdmin: false, available: false, error: e }
  }
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
    const senderAlt = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt || null
    const tag = tagOf(sender)
    const admin = await getAdminFlags(sock, from, sender, senderAlt)
    if (!admin.available) {
      console.error(`[ANTISTICKER] Could not verify group roles; skipped ${cfg.action} in ${from}`)
      return
    }
    const { botAdmin, senderAdmin } = admin

    // Members-only mode: skip group admins
    if (!cfg.applyToAdmins && senderAdmin) return

    // Bot not admin → notify only
    if (!botAdmin) {
      await sendBotNotAdmin(sock, from, msg).catch(() => {})
      return
    }

    // React
    try { await sock.sendMessage(from, { react: { text: '🚫', key: msg.key } }) } catch {}

    const action = cfg.action || 'delete'
    const maxW = cfg.maxWarns || 3

    // Delete the sticker. Do not report success if WhatsApp rejects it.
    let deleted = false
    try {
      await sock.sendMessage(from, { delete: msg.key })
      deleted = true
    } catch (e) {
      console.error('[ANTISTICKER] delete failed:', e.message)
    }

    if (action === 'delete') {
      await sock.sendMessage(from, {
        text: `╔════════════════════════╗
║  ${deleted ? '🚫 STICKER REMOVED' : '⚠️ DELETE FAILED'}  ║
╚══════════════════════╝

👤 @${tag}
${deleted ? '📌 Stickers are not allowed here.' : '📌 I could not remove the sticker. Check my group admin permission.'}

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'kick') {
      let removed = false
      try {
        const result = await sock.groupParticipantsUpdate(from, [sender], 'remove')
        const entry = Array.isArray(result) ? result.find(item => item?.jid === sender || item?.id === sender) || result[0] : result
        const status = entry?.status == null ? 200 : Number(entry.status)
        removed = Number.isFinite(status) && status >= 200 && status < 300
      } catch (e) {
        console.error('[ANTISTICKER] kick failed:', e.message)
      }
      await sock.sendMessage(from, {
        text: `╔══════════════════════╗
║  ${removed ? '🚫 MEMBER REMOVED' : '⚠️ KICK FAILED'}   ║
╚══════════════════════╝

👤 @${tag}
${removed ? '📌 Removed for sending stickers.' : '📌 I could not remove the member. Check my group admin permission.'}

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
        mentions: [sender],
      }, { quoted: msg }).catch(() => {})
      return
    }

    if (action === 'warn') {
      const count = addWarn(owner, from, sender)
      if (count >= maxW) {
        let removed = false
        try {
          const result = await sock.groupParticipantsUpdate(from, [sender], 'remove')
          const entry = Array.isArray(result) ? result.find(item => item?.jid === sender || item?.id === sender) || result[0] : result
          const status = entry?.status == null ? 200 : Number(entry.status)
          removed = Number.isFinite(status) && status >= 200 && status < 300
        } catch (e) {
          console.error('[ANTISTICKER] kick-after-warn failed:', e.message)
        }
        await sock.sendMessage(from, {
          text: `╔════════════════════════╗
║  ${removed ? '🚫 REMOVED (WARN MAX)' : '⚠️ WARN LIMIT REACHED'} ║
╚════════════════════════╝

👤 @${tag}
⚠️ Warnings: *${count}/${maxW}*
📌 ${removed ? 'Removed for sending stickers too many times.' : 'I could not remove the member. Check my group admin permission.'}

> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*`,
          mentions: [sender],
        }, { quoted: msg }).catch(() => {})
      } else {
        const left = maxW - count
        await sock.sendMessage(from, {
          text: `╔══════════════════════╗
║  ⚠️  WARNING (${count}/${maxW})      ║
╚══════════════════════╝

👤 @${tag}
🚫 Stickers are not allowed.
⏳ *${left}* more warning${left === 1 ? '' : 's'} → removal

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
