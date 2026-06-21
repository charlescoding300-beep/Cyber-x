'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/mode.js  —  CYBER X  |  Public / Private Mode
//
// USAGE:
//   .mode            → show current mode
//   .mode public     → anyone can use commands
//   .mode private     → ONLY the bot owner can trigger commands
//
// OWNER-ONLY — uses lib/isAdmin.js's isOwner() check for the strongest
// available owner verification, with safe fallbacks if that lib or the
// per-session settings aren't loaded for any reason (never crashes the
// command — just degrades gracefully and tells the user what's missing).
//
// Persisted via lib/userDb.js under settings.mode, same place index.js
// reads `state.settings.get("mode")` from on every incoming message —
// so toggling this takes effect immediately, no restart needed.
// ─────────────────────────────────────────────────────────────────────────────

let isAdminLib
try { isAdminLib = require('../lib/isAdmin') } catch { isAdminLib = null }

let db
try { db = require('../lib/userDb') } catch { db = null }

/**
 * Resolve owner status with multiple fallback layers so this command
 * never breaks even if one piece isn't available:
 *   1. isOwner flag already computed by index.js's 10-layer check (best)
 *   2. lib/isAdmin.js's own isOwner() helper, if reachable
 *   3. fail closed (treat as NOT owner) if neither is available —
 *      safer to wrongly block than to wrongly allow a mode change
 */
function resolveIsOwner({ isOwner, sender, fromMe }) {
  if (fromMe === true) return true
  if (typeof isOwner === 'boolean') return isOwner   // already computed upstream — trust it

  if (isAdminLib && typeof isAdminLib.isOwner === 'function') {
    try { return isAdminLib.isOwner(sender) } catch { /* fall through */ }
  }

  return false   // fail closed — no way to verify, so don't allow it
}

module.exports = {
  pattern:  'mode',
  alias:    ['setmode', 'privacy'],
  desc:     'Set bot to public or private mode (owner only)',
  usage:    '.mode | .mode public | .mode private',
  category: 'settings',

  async run({ sock, from, msg, args, sender, fromMe, isOwner, settings }) {
    const verifiedOwner = resolveIsOwner({ isOwner, sender, fromMe })

    if (!verifiedOwner) {
      return sock.sendMessage(from, {
        text: '❌ *Owner-only command.*\nOnly the bot owner can change public/private mode.',
      }, { quoted: msg })
    }

    const ownerPhone = sock.user?.id?.split(':')[0]?.split('@')[0] || 'default'
    const sub = (args[0] || '').toLowerCase()

    // ── No args — show current mode ─────────────────────────────────────────────
    if (!sub) {
      const current = (settings?.get ? settings.get('mode') : null) || 'public'
      return sock.sendMessage(from, {
        text:
          `⚙️ *CYBER X — Mode*\n\n` +
          `Current mode: *${current.toUpperCase()}*\n\n` +
          `🌐 *public*  — Anyone can use commands\n` +
          `🔒 *private* — Only the bot owner can trigger commands\n\n` +
          `Use *.mode public* or *.mode private* to change.`,
      }, { quoted: msg })
    }

    // ── Validate ──────────────────────────────────────────────────────────────────
    if (!['public', 'private'].includes(sub)) {
      return sock.sendMessage(from, {
        text: '❌ Invalid mode. Use *.mode public* or *.mode private*.',
      }, { quoted: msg })
    }

    // ── Persist via lib/userDb.js (per-session, survives restarts) ─────────────────
    if (db) {
      try { db.updateSettings(ownerPhone, { mode: sub }) }
      catch (e) { console.error('[MODE] userDb save failed:', e.message) }
    }

    // ── Also update the LIVE in-memory settings object so it takes effect
    // immediately on this running session, without waiting for a restart
    // or reload — same object index.js's handleMessage() reads from.
    if (settings?.set) {
      try { settings.set('mode', sub) }
      catch (e) { console.error('[MODE] live settings update failed:', e.message) }
    }

    const emoji = sub === 'private' ? '🔒' : '🌐'
    const note  = sub === 'private'
      ? '\n\n_Only you (the bot owner) can trigger commands now._'
      : '\n\n_Everyone can use commands again._'

    await sock.sendMessage(from, {
      text: `${emoji} *Mode set to:* ${sub.toUpperCase()}${note}`,
    }, { quoted: msg })
  },
}
