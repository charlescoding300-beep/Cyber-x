'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ZENX — KICK COMMAND
//  Usage: .kick @user OR reply to a member's message with .kick
//  Group admins only | Category: group
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

function getContextInfo(msg) {
  const queue = [{ value: msg?.message, depth: 0 }]
  const seen = new Set()

  while (queue.length) {
    const { value, depth } = queue.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    if (value.contextInfo) return value.contextInfo
    if (depth >= 6) continue
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 })
    }
  }
  return null
}

function cleanJid(value) {
  if (typeof value !== 'string' || !value.includes('@')) return ''
  const [local, server] = value.split('@')
  return `${local.split(':')[0]}@${server}`.toLowerCase()
}

function jidForms(value) {
  const forms = new Set()
  for (const candidate of Array.isArray(value) ? value : [value]) {
    const jid = cleanJid(candidate)
    if (!jid) continue
    forms.add(jid)
    const digits = jid.split('@')[0].replace(/\D/g, '')
    if (digits) forms.add(`#${digits}`)
  }
  return forms
}

function participantForms(participant) {
  return jidForms([
    participant?.id,
    participant?.jid,
    participant?.lid,
    participant?.phoneNumber,
  ])
}

function findParticipant(participants, identities) {
  const targets = jidForms(identities)
  if (!targets.size) return null
  return participants.find(participant => {
    for (const form of participantForms(participant)) {
      if (targets.has(form)) return true
    }
    return false
  }) || null
}

function participantJid(participant) {
  return cleanJid(participant?.id || participant?.jid || participant?.lid || participant?.phoneNumber)
}

function isAdminParticipant(participant) {
  return participant?.admin === 'admin' || participant?.admin === 'superadmin'
}

function getTargetIdentities(msg, args) {
  const context = getContextInfo(msg)
  const mentioned = Array.isArray(context?.mentionedJid) ? context.mentionedJid.filter(Boolean) : []
  if (mentioned.length) return mentioned

  const quoted = [
    context?.participantAlt,
    context?.participant,
    context?.quotedMessage?.key?.participantAlt,
    context?.quotedMessage?.key?.participant,
  ].filter(Boolean)
  if (quoted.length) return quoted

  // Also accept a pasted WhatsApp JID or a plain international number.
  const input = Array.isArray(args) ? args.join(' ').trim() : ''
  const digits = input.replace(/\D/g, '')
  if (/^\d{8,15}$/.test(digits)) return [`${digits}@s.whatsapp.net`]
  return []
}

module.exports = {
  pattern: 'kick',
  alias: ['remove'],
  category: 'group',
  desc: 'Remove a group member by mention or reply',
  usage: '.kick @user  |  reply to a member with .kick',

  run: async ({ sock, from, msg, sender, args, isAdmin, isBotAdmin, isOwner }) => {
    const reply = text => sock.sendMessage(from, { text: `${text}\n\n${CREDIT}` }, { quoted: msg })

    if (!from.endsWith('@g.us')) {
      return reply('❌ *This command only works in groups.*')
    }

    const targets = getTargetIdentities(msg, args)
    if (!targets.length) {
      return reply('❌ *Mention a member or reply to their message.*\nExample: *.kick @user*')
    }

    try {
      // Kick requires current participant/admin status; ordinary commands do not fetch metadata.
      const meta = await sock.groupMetadata(from)
      const participants = Array.isArray(meta?.participants) ? meta.participants : []

      const senderParticipant = findParticipant(participants, [sender, msg?.key?.participantPn, msg?.key?.participantAlt])
      if (!isAdmin && !isOwner && !isAdminParticipant(senderParticipant)) {
        return reply('❌ *Only group admins can use this command.*')
      }

      const botIdentities = [sock.user?.id, sock.user?.lid]
      const botParticipant = findParticipant(participants, botIdentities)
      if (!isBotAdmin && !isAdminParticipant(botParticipant)) {
        return sendBotNotAdmin(sock, from, msg)
      }

      const targetParticipant = findParticipant(participants, targets)
      if (!targetParticipant) {
        return reply('⚠️ *I could not find that member in this group. Please mention them or reply to their message again.*')
      }

      const targetJid = participantJid(targetParticipant)
      if (!targetJid) return reply('⚠️ *I could not resolve that member’s WhatsApp ID.*')

      if (findParticipant([targetParticipant], [sender, msg?.key?.participantPn, msg?.key?.participantAlt])) {
        return reply('😂 *You can’t kick yourself!*')
      }
      if (findParticipant([targetParticipant], botIdentities)) {
        return reply('😅 *I won’t remove myself from the group!*')
      }
      if (isAdminParticipant(targetParticipant)) {
        return reply('❌ *You can’t kick another group admin.*')
      }

      const result = await sock.groupParticipantsUpdate(from, [targetJid], 'remove')
      const status = Number(result?.[0]?.status ?? result?.status ?? 200)
      if (status < 200 || status >= 300) {
        return reply('⚠️ *WhatsApp did not remove that member. Check that I still have admin permission.*')
      }

      const number = targetJid.split('@')[0].replace(/\D/g, '')
      return sock.sendMessage(from, {
        text: `┏━━━━━━━「 KICK 」━━━━━━━┓\n┃ 🚫 @${number} was removed from the group.\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n${CREDIT}`,
        mentions: [targetJid],
      }, { quoted: msg })
    } catch (error) {
      console.error('[KICK]', error?.message || error)
      return reply('⚠️ *Failed to remove the member. Check that I am an admin and try again.*')
    }
  },
}
