'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/antibot.js — ZENX | Anti-Bot
//
<<<<<<< Updated upstream
// USAGE (owner must be a group admin to set this):
//   .antibot on          → enable in this group, mode defaults to "kick"
//   .antibot kick         → detect + kick foreign bots
//   .antibot delete        → detect + delete, send one deletion notice
//   .antibot warn          → send one warning; persistent count, no delete/kick
//   .antibot off            → disable in this group
//   .antibot status         → show current mode + exempt list
//   .antibot exempt <jid>   → add a JID to the "known ZENX bot" exempt list
//   .antibot unexempt <jid> → remove a JID from the exempt list
//
// DETECTION SCOPE:
//   WhatsApp message IDs do not identify automated accounts. The shared
//   engine uses observable behavior as a heuristic and exempts group admins
//   to reduce false positives. A maintained per-group list can exempt known
//   ZENX bots as well.
//
// STORAGE — per-group state lives inside lib.userDb's "antibot" section,
// keyed by groupJid inside that section's `groups` object — same pattern
// your antilink/antibadword sections already use.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = "> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦"
const antibotEngine = require('../lib/antibot')
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
=======
//  .antibot kick     → remove bots that have no ZENX badge
//  .antibot delete   → delete their messages only
//  .antibot warn     → warn, remove at 3 warnings
//  .antibot off      → disable in this group
//  .antibot status   → mode, badge state, exempt list
//  .antibot exempt <number>   /   .antibot unexempt <number>
//
//  A bot that carries the ZENX badge is never touched. Admins, the owner and
//  everyone else get no special treatment: only the badge protects a bot.
// ════════════════════════════════════════════════════════════════════

const zenxBadge = require('../core/zenxbadge')

const BRAND = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const MAX_WARNINGS = 3
>>>>>>> Stashed changes

const normalizeJid = id => (id ? String(id).split('@')[0].split(':')[0] : null)
const numberOf = jid => String(jid || '').split('@')[0].split(':')[0]

<<<<<<< Updated upstream
module.exports = {
  pattern:  'antibot',
  alias:    [],
  desc:     'Detect suspicious automated message behavior in this group',
  usage:    '.antibot kick|delete|warn|off|status|exempt <jid>|unexempt <jid>',
  category: 'group',

  async run({ sock, from, msg, args, isOwner, isAdmin, isBotAdmin, isGroup }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: `❌ This command only works in groups.\n\n${BRAND}` }, { quoted: msg })
    }
=======
function getGroupState(lib, phone, groupJid) {
  try {
    const section = lib.userDb?.getSection?.(phone, 'antibot') || { groups: {} }
    return section.groups?.[groupJid] || { mode: 'off', exemptJids: [], warnings: {} }
  } catch {
    return { mode: 'off', exemptJids: [], warnings: {} }
  }
}

function setGroupState(lib, phone, groupJid, patch) {
  try {
    const section = lib.userDb?.getSection?.(phone, 'antibot') || { groups: {} }
    const groups = section.groups || {}
    const current = groups[groupJid] || { mode: 'off', exemptJids: [], warnings: {} }
    groups[groupJid] = { ...current, ...patch }
    lib.userDb?.setSection?.(phone, 'antibot', { groups })
    return groups[groupJid]
  } catch (e) {
    console.error('[ANTIBOT] could not save state:', e.message)
    return null
  }
}

// Baileys gives bot-made messages these ID prefixes
function looksLikeBotMessage(messageId) {
  return !!messageId && /^(3EB|BAE|3A)[0-9A-F]+/i.test(messageId)
}

function textOf(message) {
  let m = message || {}
  for (let i = 0; i < 3; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message
    if (!inner) break
    m = inner
  }
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || ''
}

function isExempt(state, jid) {
  const n = normalizeJid(jid)
  return (state.exemptJids || []).some(j => normalizeJid(j) === n)
}

// short, official, tags the bot's owner number and quotes the message it is about
async function notify(sock, groupJid, quotedMsg, offenderJid, text) {
  try {
    await sock.sendMessage(groupJid, { text, mentions: [offenderJid] }, quotedMsg ? { quoted: quotedMsg } : undefined)
  } catch (e) {
    console.error('[ANTIBOT] notice not delivered:', e.message)
  }
}

async function deleteMessage(sock, groupJid, m) {
  try {
    await sock.sendMessage(groupJid, { delete: m.key })
    return true
  } catch (e) {
    console.error('[ANTIBOT] delete failed (is the bot an admin?):', e.message)
    return false
  }
}

async function removeMember(sock, groupJid, jid) {
  try {
    await sock.groupParticipantsUpdate(groupJid, [jid], 'remove')
    return true
  } catch (e) {
    console.error('[ANTIBOT] remove failed:', e.message)
    return false
  }
}

module.exports = {
  pattern: 'antibot',
  alias: [],
  desc: 'Remove bots that do not carry the ZENX badge (ZENX bots are never touched)',
  usage: '.antibot kick|delete|warn|off|status|exempt <number>|unexempt <number>',
  category: 'group',

  async run({ sock, from, msg, args, settings, isOwner, isAdmin, isGroup, lib }) {
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${BRAND}` }, { quoted: msg })
    if (!isGroup) return reply('❌ This command only works in groups.')
    if (!isAdmin && !isOwner) return reply('❌ Only group admins or the bot owner can configure antibot.')
>>>>>>> Stashed changes

    const phone = settings?.get?.('__ownerPhone') || numberOf(sock.user?.id)
    const action = String(args[0] || '').toLowerCase()
    const labels = { off: '❌ Disabled', kick: '🥾 Remove', delete: '🧹 Delete only', warn: '⚠️ Warn (3 strikes)' }

<<<<<<< Updated upstream
    // Keep settings and warning counts under the linked WhatsApp session's
    // own database key. A global owner setting can point at a different bot.
    const phone = adminLib.sessionPhoneOf(sock)
    if (!phone) {
      return sock.sendMessage(from, { text: `⚠️ Could not identify this bot session.\n\n${BRAND}` }, { quoted: msg })
    }
    const action = (args[0] || '').toLowerCase()
    const groupJid = from

    const labels = { off: "❌ Disabled", kick: "🥾 Kick", delete: "🧹 Delete + notice", warn: "⚠️ Warn only" }

    if (action === 'on' || action === 'kick' || action === 'delete' || action === 'warn') {
      const mode = action === 'on' ? 'kick' : action
      if (mode !== 'warn' && !isBotAdmin) return sendBotNotAdmin(sock, from, msg)
      antibotEngine.setGroupState(phone, groupJid, { mode })
      return sock.sendMessage(from, { text: `✅ Antibot mode set to: *${labels[mode]}*\n\n${BRAND}` }, { quoted: msg })
    }

    if (action === 'off') {
      antibotEngine.setGroupState(phone, groupJid, { mode: 'off' })
      return sock.sendMessage(from, { text: `🤖 Antibot disabled for this group.\n\n${BRAND}` }, { quoted: msg })
    }

    if (action === 'status') {
      const state = antibotEngine.getGroupState(phone, groupJid)
      const exemptList = (state.exemptJids || []).map(j => `@${j.split('@')[0]}`).join(', ') || 'none'
=======
    if (['on', 'kick', 'delete', 'warn'].includes(action)) {
      const mode = action === 'on' ? 'kick' : action
      setGroupState(lib, phone, from, { mode })
      return reply(`✅ Antibot mode set to: *${labels[mode]}*\n🔏 ZENX badge: bots carrying it are never touched.`)
    }

    if (action === 'off') {
      setGroupState(lib, phone, from, { mode: 'off' })
      return reply('🤖 Antibot disabled for this group.')
    }

    if (action === 'status') {
      const state = getGroupState(lib, phone, from)
      const exempt = (state.exemptJids || []).map(j => `@${numberOf(j)}`).join(', ') || 'none'
>>>>>>> Stashed changes
      return sock.sendMessage(from, {
        text: `🤖 *Antibot Status*\n\nMode: ${labels[state.mode] || state.mode}\n🔏 ZENX badge: active on every bot message\nExempt numbers: ${exempt}\n\n${BRAND}`,
        mentions: state.exemptJids || [],
      }, { quoted: msg })
    }

    if (action === 'exempt' || action === 'unexempt') {
<<<<<<< Updated upstream
      const targetRaw = args[1]
      if (!targetRaw) {
        return sock.sendMessage(from, { text: `❌ Usage: .antibot ${action} <jid or number>\n\n${BRAND}` }, { quoted: msg })
      }
      const targetJid = targetRaw.includes('@') ? targetRaw : `${targetRaw.replace(/\D/g, '')}@s.whatsapp.net`
      const state = antibotEngine.getGroupState(phone, groupJid)
      let exemptJids = state.exemptJids || []

      if (action === 'exempt') {
        if (!exemptJids.some(j => normalizeJid(j) === normalizeJid(targetJid))) {
          exemptJids = [...exemptJids, targetJid]
        }
        antibotEngine.setGroupState(phone, groupJid, { exemptJids })
        return sock.sendMessage(from, { text: `✅ Added @${targetJid.split('@')[0]} to the ZENX exempt bot list.\n\n${BRAND}`, mentions: [targetJid] }, { quoted: msg })
      } else {
        exemptJids = exemptJids.filter(j => normalizeJid(j) !== normalizeJid(targetJid))
        antibotEngine.setGroupState(phone, groupJid, { exemptJids })
        return sock.sendMessage(from, { text: `✅ Removed @${targetJid.split('@')[0]} from the exempt bot list.\n\n${BRAND}`, mentions: [targetJid] }, { quoted: msg })
=======
      const raw = args[1]
      if (!raw) return reply(`❌ Usage: .antibot ${action} <number>`)
      const jid = raw.includes('@') ? raw : `${raw.replace(/\D/g, '')}@s.whatsapp.net`
      const state = getGroupState(lib, phone, from)
      let list = state.exemptJids || []
      if (action === 'exempt') {
        if (!list.some(j => normalizeJid(j) === normalizeJid(jid))) list = [...list, jid]
        setGroupState(lib, phone, from, { exemptJids: list })
        return sock.sendMessage(from, { text: `✅ @${numberOf(jid)} is exempt.\n\n${BRAND}`, mentions: [jid] }, { quoted: msg })
>>>>>>> Stashed changes
      }
      list = list.filter(j => normalizeJid(j) !== normalizeJid(jid))
      setGroupState(lib, phone, from, { exemptJids: list })
      return sock.sendMessage(from, { text: `✅ @${numberOf(jid)} is no longer exempt.\n\n${BRAND}`, mentions: [jid] }, { quoted: msg })
    }

<<<<<<< Updated upstream
    // default / help
    const state = antibotEngine.getGroupState(phone, groupJid)
    return sock.sendMessage(from, {
      text:
        `🛡️ *Antibot Commands*\n\n` +
        `• *.antibot kick* — kick detected bots\n` +
        `• *.antibot delete* — delete the message and send one notice\n` +
        `• *.antibot warn* — warn only; count persists until .resetwarn\n` +
        `• *.antibot off* — disable\n` +
        `• *.antibot status* — check mode + exempt list\n` +
        `• *.antibot exempt <jid>* — protect a known ZENX bot\n` +
        `• *.antibot unexempt <jid>* — remove protection\n\n` +
        `*Current Mode:* ${labels[state.mode] || state.mode}\n\n${BRAND}`
    }, { quoted: msg })
  },

  // Use the shared behavior-based engine. WhatsApp message-ID prefixes are
  // common across clients and cannot identify a bot reliably.
  async handleAntibot(sock, m, extractBody) {
    return antibotEngine.handleAntibot(sock, m, extractBody)
  }
=======
    const state = getGroupState(lib, phone, from)
    return reply(
      '🛡️ *Antibot*\n\n' +
      '• *.antibot kick* — remove bots without the ZENX badge\n' +
      '• *.antibot delete* — delete their messages only\n' +
      '• *.antibot warn* — warn, remove at 3 warnings\n' +
      '• *.antibot off* — disable\n' +
      '• *.antibot status* — current state\n\n' +
      `*Current mode:* ${labels[state.mode] || state.mode}`
    )
  },

  // Called by index.js for every incoming message: lib.handleAntibot(sock, m, extractBody, lib)
  async handleAntibot(sock, m, extractBody, lib) {
    try {
      if (!lib || !m?.key) return
      const groupJid = m.key.remoteJid
      if (!groupJid || !groupJid.endsWith('@g.us')) return
      if (m.key.fromMe) return
      if (!looksLikeBotMessage(m.key.id)) return          // not a bot-made message
      if (m.key.id.endsWith('CYBERX')) return             // our own family of bots

      // the badge: a ZENX bot is never touched, whoever is running it
      if (zenxBadge.hasBadge(textOf(m.message))) return

      const phone = numberOf(sock.user?.id)
      const state = getGroupState(lib, phone, groupJid)
      if (!state.mode || state.mode === 'off') return

      const senderJid = m.key.participant || m.key.remoteJid
      if (isExempt(state, senderJid)) return

      const tag = numberOf(senderJid)

      // Warn mode: count this strike first, so the notice can show it.
      let warnings = null
      let footer = 'Message removed.'
      if (state.mode === 'kick') footer = 'You have been removed from this group.'
      if (state.mode === 'warn') {
        warnings = { ...(state.warnings || {}) }
        const count = (warnings[senderJid] || 0) + 1
        warnings[senderJid] = count
        footer = count >= MAX_WARNINGS
          ? 'You have been removed from this group.'
          : `Warning ${count}/${MAX_WARNINGS}.`
      }

      // 1) Always: tell the person, quoting their message, BEFORE anything is deleted or removed.
      await notify(sock, groupJid, m, senderJid,
        `🚫 *Bot Not Allowed Here*\n\n@${tag}, this bot is not allowed in this group. Only bots carrying the ZENX badge are permitted.\n${footer}\n\n${BRAND}`)

      // 2) Then the group's mode.
      if (state.mode === 'delete') {
        await deleteMessage(sock, groupJid, m)
        return
      }

      if (state.mode === 'kick') {
        await deleteMessage(sock, groupJid, m)
        await removeMember(sock, groupJid, senderJid)
        return
      }

      if (state.mode === 'warn') {
        await deleteMessage(sock, groupJid, m)
        if (warnings[senderJid] >= MAX_WARNINGS) {
          await removeMember(sock, groupJid, senderJid)
          delete warnings[senderJid]
        }
        setGroupState(lib, phone, groupJid, { warnings })
      }
    } catch (e) {
      console.error('[ANTIBOT] error:', e.message)
    }
  },
>>>>>>> Stashed changes
}
