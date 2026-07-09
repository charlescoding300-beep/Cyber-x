'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/antibot.js  —  CYBER X  |  Anti-Bot
//
// USAGE (owner must be a group admin to set this):
//   .antibot on          → enable in this group, mode defaults to "kick"
//   .antibot kick         → detect + kick foreign bots
//   .antibot delete        → detect + delete their messages only
//   .antibot warn          → detect + warn, auto-kick at 3 warnings
//   .antibot off            → disable in this group
//   .antibot status         → show current mode + exempt list
//   .antibot exempt <jid>   → add a JID to the "known CYBER X bot" exempt list
//   .antibot unexempt <jid> → remove a JID from the exempt list
//
// DETECTION SCOPE — per your requirement:
//   Antibot now acts on ANY detected bot message regardless of whether the
//   sender is a regular member, group admin, super admin, OR the group
//   owner. Admin status no longer grants automatic protection.
//   The ONLY exemption is a maintained per-group JID list (exemptJids) —
//   these represent YOUR OWN CYBER X-issued admin bots deployed in that
//   group, which must never be touched even though they're also bots.
//
// STORAGE — per-group state lives inside lib.userDb's "antibot" section,
// keyed by groupJid inside that section's `groups` object — same pattern
// your antilink/antibadword sections already use.
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = "> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™"
const MAX_WARNINGS = 3

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

function isBaileysMessageId(messageId) {
  if (!messageId) return false
  const patterns = [
    /^3EB[0-9A-F]+/i,
    /^BAE[0-9A-F]+/i,
    /^3A[0-9A-F]+/i,
  ]
  return patterns.some(p => p.test(messageId))
}

/**
 * Pure local check, zero network calls — kept fast for the hot path.
 * Returns true if this message looks like it came from a foreign
 * (non-CYBER X) automated bot account, based on Baileys' own message-ID
 * fingerprinting patterns.
 */
function detectBotFromMessage(m, sock) {
  try {
    if (m.key?.fromMe === true) return false
    if (m.sender && m.sender.endsWith('@g.us')) return false

    const messageId = m.key?.id
    if (!messageId) return false

    if (!isBaileysMessageId(messageId)) return false

    // Own bot's messages carry a CYBERX suffix — never flag ourselves
    if (messageId.endsWith('CYBERX')) return false

    return true
  } catch {
    return false
  }
}

function isExempt(groupState, userJid) {
  const normalized = normalizeJid(userJid)
  return (groupState.exemptJids || []).some(j => normalizeJid(j) === normalized)
}

async function deleteOffendingMessage(sock, groupJid, m) {
  try {
    if (!m?.key) return false
    await sock.sendMessage(groupJid, { delete: m.key })
    return true
  } catch (e) {
    console.error(`[ANTIBOT] delete failed:`, e.message)
    return false
  }
}

async function kickUser(sock, groupJid, userJid, reasonText) {
  try {
    await sock.groupParticipantsUpdate(groupJid, [userJid], "remove")
    await sock.sendMessage(groupJid, {
      text: `✅ *Bot Removed*\n\n👤 User: @${userJid.split('@')[0]}\n📋 Reason: ${reasonText}\n\n${BRAND}`,
      mentions: [userJid]
    }).catch(() => {})
    return true
  } catch (e) {
    console.error(`[ANTIBOT] kick failed:`, e.message)
    await sock.sendMessage(groupJid, {
      text: `⚠️ *Failed to remove bot* @${userJid.split('@')[0]} — ${e.message}\n\n${BRAND}`,
      mentions: [userJid]
    }).catch(() => {})
    return false
  }
}

module.exports = {
  pattern:  'antibot',
  alias:    [],
  desc:     'Detect and act on foreign WhatsApp bots in this group (admins/owner not exempt, only known CYBER X bots)',
  usage:    '.antibot kick|delete|warn|off|status|exempt <jid>|unexempt <jid>',
  category: 'group',

  async run({ sock, from, msg, args, settings, isOwner, isAdmin, isGroup, lib }) {
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
        return sock.sendMessage(from, { text: `✅ Added @${targetJid.split('@')[0]} to the CYBER X exempt bot list.\n\n${BRAND}`, mentions: [targetJid] }, { quoted: msg })
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
        `• *.antibot exempt <jid>* — protect a known CYBER X bot\n` +
        `• *.antibot unexempt <jid>* — remove protection\n\n` +
        `*Current Mode:* ${labels[state.mode] || state.mode}\n\n${BRAND}`
    }, { quoted: msg })
  },

  /**
   * Called from index.js's message hot path as:
   *   lib.handleAntibot(sock, m, extractBody, lib)
   * Fast local detection first (zero network), only touches group state/network
   * once a bot-shaped message is actually found.
   */
  async handleAntibot(sock, m, extractBody, lib) {
    try {
      if (!lib) return
      if (!m?.key?.remoteJid?.endsWith('@g.us')) return
      const groupJid = m.key.remoteJid
      const senderJid = m.key.participant || m.key.remoteJid

      if (!detectBotFromMessage({ key: m.key, sender: senderJid }, sock)) return

      const phone = sock.user?.id?.split('@')[0]?.split(':')[0]

      const state = getGroupState(lib, phone, groupJid)
      if (!state.mode || state.mode === 'off') return

      // The ONLY exemption: a maintained list of known CYBER X bot JIDs.
      // Admin status, super admin status, and owner status grant NO
      // protection here — that's the explicit requirement.
      if (isExempt(state, senderJid)) return

      await deleteOffendingMessage(sock, groupJid, m)

      if (state.mode === 'delete') return

      if (state.mode === 'kick') {
        await kickUser(sock, groupJid, senderJid, 'Detected as unauthorized bot account')
        return
      }

      if (state.mode === 'warn') {
        const warnings = { ...(state.warnings || {}) }
        warnings[senderJid] = (warnings[senderJid] || 0) + 1
        const count = warnings[senderJid]

        if (count >= MAX_WARNINGS) {
          await sock.sendMessage(groupJid, {
            text: `⚠️ *Final Warning Reached (${count}/${MAX_WARNINGS})* — @${senderJid.split('@')[0]} being removed automatically.\n\n${BRAND}`,
            mentions: [senderJid]
          }).catch(() => {})
          await kickUser(sock, groupJid, senderJid, `Reached ${MAX_WARNINGS}/${MAX_WARNINGS} warnings`)
          delete warnings[senderJid]
        } else {
          await sock.sendMessage(groupJid, {
            text: `⚠️ *Bot Warning (${count}/${MAX_WARNINGS})* — @${senderJid.split('@')[0]}\n\n${BRAND}`,
            mentions: [senderJid]
          }).catch(() => {})
        }
        setGroupState(lib, phone, groupJid, { warnings })
      }
    } catch (e) {
      console.error('[ANTIBOT] handleAntibot error:', e.message)
    }
  }
}
