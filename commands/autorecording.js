'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/autorecording.js  —  CYBER X  |  Auto Recording Toggle
//
// USAGE:
//   .autorecording        → show current status
//   .autorecording on     → enable (shows "recording..." for 5s on non-command msgs)
//   .autorecording off    → disable
//
// Same engine as autotyping — index.js's handleOrdinaryMessage() already
// fires this only on non-command messages, in both DMs and groups, with
// zero impact on command response speed.
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
  pattern:  'autorecording',
  alias:    ['autorecord'],
  desc:     'Toggle auto-recording indicator on non-command messages',
  usage:    '.autorecording on | off',
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
      const current = settings?.get ? settings.get('autoRecording') : false
      return sock.sendMessage(from, {
        text:
          `🎙️ *Auto Recording:* ${current ? '🟢 ON' : '🔴 OFF'}\n\n` +
          `Shows "recording audio..." for 5s on normal messages.\n` +
          `Commands always fire instantly — no delay.\n\n` +
          `Use *.autorecording on* or *.autorecording off*`,
      }, { quoted: msg })
    }

    if (!['on', 'off'].includes(sub)) {
      return sock.sendMessage(from, {
        text: '❌ Usage: *.autorecording on* or *.autorecording off*',
      }, { quoted: msg })
    }

    const enabled = sub === 'on'

    if (db) {
      try { db.updateSettings(ownerPhone, { autoRecording: enabled }) }
      catch (e) { console.error('[AUTORECORDING] save failed:', e.message) }
    }

    if (settings?.set) {
      try { settings.set('autoRecording', enabled) }
      catch (e) { console.error('[AUTORECORDING] live update failed:', e.message) }
    }

    await sock.sendMessage(from, {
      text: `🎙️ *Auto Recording:* ${enabled ? '🟢 ON' : '🔴 OFF'}`,
    }, { quoted: msg })
  },
}
