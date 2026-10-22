'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antibot.js  —  ZENX  |  Anti-Bot
//
// USAGE (owner must be a group admin to set this):
//   .antibot on          → enable in this group, mode defaults to "kick"
//   .antibot kick         → detect + kick foreign bots
//   .antibot delete        → detect + delete their messages only
//   .antibot warn          → detect + warn, auto-kick at 3 warnings
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
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

function normalizeJid(id) {
  if (!id) return null
  try {
    return id.split('@')[0].split(':')[0]
  } catch {
    return id
  }
}

function getGroupState(lib, phone, groupJid) {
  try {
    const section = lib.userDb?.getSection?.(phone, "antibot") || { groups: {} }
    return section.groups?.[groupJid] || { mode: "off", exemptJids: [], warnings: {} }
  } catch {
    return { mode: "off", exemptJids: [], warnings: {} }
  }
}

function setGroupState(lib, phone, groupJid, patch) {
  try {
    const section = lib.userDb?.getSection?.(phone, "antibot") || { groups: {} }
    const groups = section.groups || {}
    const current = groups[groupJid] || { mode: "off", exemptJids: [], warnings: {} }
    groups[groupJid] = { ...current, ...patch }
    lib.userDb?.setSection?.(phone, "antibot", { groups })
    return groups[groupJid]
  } catch (e) {
    console.error("[ANTIBOT] setGroupState error:", e.message)
    return null
  }
}

module.exports = {
  pattern:  'antibot',
  alias:    [],
  desc:     'Detect suspicious automated message behavior in this group',
  usage:    '.antibot kick|delete|warn|off|status|exempt <jid>|unexempt <jid>',
  category: 'group',

  async run({ sock, from, msg, args, settings, isOwner, isAdmin, isBotAdmin, isGroup, lib }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: `❌ This command only works in groups.\n\n${BRAND}` }, { quoted: msg })
    }

    // Only an admin (or the bot owner) may configure antibot for this group
    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: `❌ Only group admins or the bot owner can configure antibot.\n\n${BRAND}` }, { quoted: msg })
    }

    const phone = settings?.get?.('__ownerPhone') || sock.user?.id?.split('@')[0]?.split(':')[0]
    const action = (args[0] || '').toLowerCase()
    const groupJid = from

    const labels = { off: "❌ Disabled", kick: "🥾 Kick", delete: "🧹 Delete-only", warn: "⚠️ Warn (3 strikes)" }

    if (action === 'on' || action === 'kick' || action === 'delete' || action === 'warn') {
      if (!isBotAdmin) return sendBotNotAdmin(sock, from, msg)
      const mode = action === 'on' ? 'kick' : action
      setGroupState(lib, phone, groupJid, { mode })
      return sock.sendMessage(from, { text: `✅ Antibot mode set to: *${labels[mode]}*\n\n${BRAND}` }, { quoted: msg })
    }

    if (action === 'off') {
      setGroupState(lib, phone, groupJid, { mode: 'off' })
      return sock.sendMessage(from, { text: `🤖 Antibot disabled for this group.\n\n${BRAND}` }, { quoted: msg })
    }

    if (action === 'status') {
      const state = getGroupState(lib, phone, groupJid)
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
      const state = getGroupState(lib, phone, groupJid)
      let exemptJids = state.exemptJids || []

      if (action === 'exempt') {
        if (!exemptJids.some(j => normalizeJid(j) === normalizeJid(targetJid))) {
          exemptJids = [...exemptJids, targetJid]
        }
        setGroupState(lib, phone, groupJid, { exemptJids })
        return sock.sendMessage(from, { text: `✅ Added @${targetJid.split('@')[0]} to the ZENX exempt bot list.\n\n${BRAND}`, mentions: [targetJid] }, { quoted: msg })
      } else {
        exemptJids = exemptJids.filter(j => normalizeJid(j) !== normalizeJid(targetJid))
        setGroupState(lib, phone, groupJid, { exemptJids })
        return sock.sendMessage(from, { text: `✅ Removed @${targetJid.split('@')[0]} from the exempt bot list.\n\n${BRAND}`, mentions: [targetJid] }, { quoted: msg })
      }
    }

    // default / help
    const state = getGroupState(lib, phone, groupJid)
    return sock.sendMessage(from, {
      text:
        `🛡️ *Antibot Commands*\n\n` +
        `• *.antibot kick* — kick detected bots\n` +
        `• *.antibot delete* — delete bot messages only\n` +
        `• *.antibot warn* — warn, auto-kick at 3 warnings\n` +
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
