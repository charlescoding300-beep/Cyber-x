'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/autotyping.js  —  CYBER X  |  Auto Typing Toggle
//
// USAGE:
//   .autotyping        → show current status
//   .autotyping on     → enable (shows "typing..." for 5s on non-command msgs)
//   .autotyping off    → disable
//
// The actual behavior already lives in index.js's handleOrdinaryMessage():
//   - Fires ONLY on non-command messages (commands always run instantly,
//     zero delay, zero extra network calls)
//   - Works identically in DMs and groups — handleMessage() doesn't
//     branch on isGroup before calling handleOrdinaryMessage()
//   - composing → wait 5s → paused, exactly like WhatsApp's native
//     typing indicator behavior
//
// This command just flips the settings flag that engine already reads.
// ─────────────────────────────────────────────────────────────────────────────

let db
try { db = require('../lib/userDb') } catch { db = null }

let isAdminLib
try { isAdminLib = require('../lib/isAdmin') } catch { isAdminLib = null }

/**
 * Re-verify owner status directly via lib/isAdmin.js instead of only
 * trusting the isOwner flag passed in from index.js. Two layers means
 * a bug in either one alone can't accidentally let a non-owner through.
 * Fails CLOSED (treats as not-owner) if neither check is available.
 */
function resolveIsOwner({ isOwner, sender, fromMe }) {
  if (fromMe === true) return true
  if (isAdminLib && typeof isAdminLib.isOwner === 'function') {
    try {
      const verified = isAdminLib.isOwner(sender)
      // Both checks must agree when both are available — if index.js
      // says owner but lib/isAdmin.js disagrees, trust the stricter NO.
      if (typeof isOwner === 'boolean') return isOwner && verified
      return verified
    } catch { /* fall through */ }
  }
  if (typeof isOwner === 'boolean') return isOwner
  return false
}

module.exports = {
  pattern:  'autotyping',
  alias:    ['autotype'],
  desc:     'Toggle auto-typing indicator on non-command messages',
  usage:    '.autotyping on | off',
  category: 'owner',

  async run({ sock, from, msg, args, sender, fromMe, settings, isOwner }) {
    const verifiedOwner = resolveIsOwner({ isOwner, sender, fromMe })

    if (!verifiedOwner) {
      return sock.sendMessage(from, {
        text: '❌ *Owner-only command.*',
      }, { quoted: msg })
    }

    const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()

    if (!sub) {
      const current = settings?.get ? settings.get('autoTyping') : false
      return sock.sendMessage(from, {
        text:
          `⌨️ *Auto Typing:* ${current ? '🟢 ON' : '🔴 OFF'}\n\n` +
          `Shows "typing..." for 5s on normal messages.\n` +
          `Commands always fire instantly — no delay.\n\n` +
          `Use *.autotyping on* or *.autotyping off*`,
      }, { quoted: msg })
    }

    if (!['on', 'off'].includes(sub)) {
      return sock.sendMessage(from, {
        text: '❌ Usage: *.autotyping on* or *.autotyping off*',
      }, { quoted: msg })
    }

    const enabled = sub === 'on'

    if (db) {
      try { db.updateSettings(ownerPhone, { autoTyping: enabled }) }
      catch (e) { console.error('[AUTOTYPING] save failed:', e.message) }
    }

    if (settings?.set) {
      try { settings.set('autoTyping', enabled) }
      catch (e) { console.error('[AUTOTYPING] live update failed:', e.message) }
    }

    await sock.sendMessage(from, {
      text: `⌨️ *Auto Typing:* ${enabled ? '🟢 ON' : '🔴 OFF'}`,
    }, { quoted: msg })
  },
}
