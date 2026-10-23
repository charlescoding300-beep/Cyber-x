'use strict'

// Reset a member's persistent moderation strikes by reply or @mention.
// Defaults to all automatic moderation systems; an optional feature narrows it.
const antilink = require('../lib/antilink')
const antibot = require('../lib/antibot')
const antispam = require('../lib/antispam')
const antisticker = require('../lib/antisticker')
const userDb = require('../lib/userDb')
const adminLib = require('../lib/isAdmin')

const FEATURES = new Set(['antilink', 'antibot', 'antispam', 'antibadword', 'antistatus', 'antisticker'])
const FEATURE_LABELS = {
  antilink: 'Anti-link',
  antibot: 'Anti-bot',
  antispam: 'Anti-spam',
  antibadword: 'Anti-badword',
  antistatus: 'Anti-status',
  antisticker: 'Anti-sticker',
}
const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const digits = value => String(value || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
const stableJid = value => String(value || '').replace(/:\d+(?=@)/, '')

module.exports = {
  pattern: 'resetwarn',
  alias: ['clearwarn', 'unwarn'],
  category: 'group',
  desc: "Reset a member's persistent moderation warnings by reply or mention",
  usage: '.resetwarn [feature] (reply to member or @mention)',

  run: async ({ sock, from, msg, args, groupCache, isAdmin, isOwner }) => {
    const reply = text => sock.sendMessage(from, { text: `${text}\n\n${CREDIT}` }, { quoted: msg })
    if (!from.endsWith('@g.us')) return reply('This command only works in a group.')
    if (!isAdmin && !isOwner) return reply('Only a group admin or the bot owner can reset warning records.')

    const message = msg.message || {}
    const contexts = [
      message.extendedTextMessage?.contextInfo,
      message.imageMessage?.contextInfo,
      message.videoMessage?.contextInfo,
      message.documentMessage?.contextInfo,
    ].filter(Boolean)
    const quotedTargets = contexts.flatMap(context => [
      context.participant,
      context.participantPn,
      context.participantAlt,
      context.quotedMessage?.key?.participant,
    ])
    const mentionedTargets = contexts.flatMap(context => {
      const mentioned = context.mentionedJid || context.mentionedJids || []
      return Array.isArray(mentioned) ? mentioned : [mentioned]
    })

    const words = (Array.isArray(args) ? args : String(args || '').split(/\s+/)).filter(Boolean)
    const featureWord = words.find(word => FEATURES.has(String(word).toLowerCase()) || String(word).toLowerCase() === 'all')
    const feature = featureWord ? String(featureWord).toLowerCase() : 'all'
    const targetWords = featureWord ? words.filter(word => word !== featureWord) : words
    const typedTargets = targetWords.map(word => {
      const value = String(word).replace(/[<>()[\],]/g, '')
      if (value.includes('@')) return value
      const number = digits(value)
      return number ? `${number}@s.whatsapp.net` : ''
    })

    const targets = [...new Set([
      ...quotedTargets,
      ...mentionedTargets,
      ...typedTargets,
    ].map(stableJid).filter(Boolean))]
    let target = targets[0]
    if (!target) {
      return reply('Reply to the member’s message or mention them. Usage: *.resetwarn [feature] (reply or @mention)\nWithout a feature, all moderation warning counts are reset.')
    }

    // Use identity aliases from the same participant record (phone JID and
    // LID). Do not equate unrelated PN and LID values just because their
    // numeric portions happen to match.
    const participants = groupCache?.[from]?.participants || []
    for (const participant of participants) {
      const ids = [participant.id, participant.jid, participant.phoneNumber, participant.lid].filter(Boolean)
      if (!targets.some(target => adminLib.participantMatches(participant, target))) continue
      for (const id of ids) {
        const stable = stableJid(id)
        if (stable && !targets.includes(stable)) targets.push(stable)
      }
    }

    const phone = digits(sock.user?.id)
    if (!phone) return reply('Could not identify this bot session to reset its warning record.')

    const selected = feature === 'all' ? [...FEATURES] : [feature]
    for (const item of selected) {
      if (item === 'antilink') targets.forEach(jid => antilink.resetWarn(phone, from, jid))
      else if (item === 'antibot') targets.forEach(jid => antibot.resetWarnings(phone, from, jid))
      else if (item === 'antispam') targets.forEach(jid => antispam.resetWarnings(phone, from, jid))
      else if (item === 'antisticker') targets.forEach(jid => antisticker.resetWarn(phone, from, jid))
      else if (item === 'antistatus') targets.forEach(jid => global.__antistatusResetWarnings?.(phone, from, jid))
      else if (item === 'antibadword') {
        const section = userDb.getSection(phone, 'warns') || { groups: {} }
        const warnings = section.groups?.[from]
        if (warnings) {
          for (const key of Object.keys(warnings)) {
            if (targets.includes(stableJid(key))) delete warnings[key]
          }
          userDb.setSection(phone, 'warns', section)
        }
      }
    }

    return sock.sendMessage(from, {
      text: `✅ ${feature === 'all' ? 'All automatic moderation' : FEATURE_LABELS[feature]} warnings cleared for @${digits(target)}.\n\n${CREDIT}`,
      mentions: [target],
    }, { quoted: msg })
  },
}
