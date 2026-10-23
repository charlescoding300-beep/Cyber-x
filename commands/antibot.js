'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antibot.js  —  ZENX  |  Anti-Bot
//
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

function normalizeJid(id) {
  if (!id) return null
  try {
    return id.split('@')[0].split(':')[0]
  } catch {
    return id
  }
}

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

    // Only an admin (or the bot owner) may configure antibot for this group
    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: `❌ Only group admins or the bot owner can configure antibot.\n\n${BRAND}` }, { quoted: msg })
    }

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
      return sock.sendMessage(from, {
        text: `🤖 *Antibot Status*\n\nMode: ${labels[state.mode] || state.mode}\nExempt bots: ${exemptList}\n\n${BRAND}`,
        mentions: (state.exemptJids || [])
      }, { quoted: msg })
    }

    if (action === 'exempt' || action === 'unexempt') {
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
      }
    }

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
}
