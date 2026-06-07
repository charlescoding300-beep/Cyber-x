// lib/muteTimers.js  —  CYBER X
// ─────────────────────────────────────────────────────────
// Shared Map that holds active auto-unmute timers.
// Keyed by group JID → NodeJS Timeout handle.
//
// Kept in its own file so both mute.js and unmute.js
// share the SAME Map instance (require() is cached by Node).
//
// Usage:
//   const muteTimers = require('../lib/muteTimers')
//   muteTimers.set(jid, timer)
//   muteTimers.get(jid)
//   muteTimers.has(jid)
//   muteTimers.delete(jid)
// ─────────────────────────────────────────────────────────

const muteTimers = new Map()

module.exports = muteTimers

