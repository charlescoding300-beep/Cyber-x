'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/zenxbadge.js — the ZENX badge
//
//  Every text and caption this bot sends carries an invisible signature made of
//  zero-width characters. You can't see it, the message reads the same, but the
//  anti-bot can check for it. Bots without the badge are the ones it acts on.
//
//  The signature is 64 bits derived from an HMAC, so it is the same in every copy of
//  this code. It is a watermark, not a lock: anyone who copies the code also copies
//  the signature, and a bot that strips zero-width characters loses it.
// ════════════════════════════════════════════════════════════════════

const crypto = require('crypto')

const BADGE_LABEL = 'ZENX-OFFICIAL-BOT-BADGE'
const BADGE_KEY = 'zenx-badge-key-v1'
const ZERO = '\u200B'   // zero-width space       → bit 0
const ONE = '\u200C'    // zero-width non-joiner  → bit 1
const EDGE = '\u2060'   // word joiner            → start and end marker
const TOKEN_BYTES = 8

const TOKEN = crypto.createHmac('sha256', BADGE_KEY).update(BADGE_LABEL).digest().subarray(0, TOKEN_BYTES)

function encodeBytes(buf) {
  let bits = ''
  for (const byte of buf) for (let i = 7; i >= 0; i--) bits += ((byte >> i) & 1) ? ONE : ZERO
  return bits
}

const PAYLOAD = encodeBytes(TOKEN)
const BADGE = EDGE + PAYLOAD + EDGE

// true when the text carries this bot's badge
function hasBadge(text) {
  const s = String(text || '')
  const start = s.indexOf(EDGE)
  if (start < 0) return false
  const end = s.indexOf(EDGE, start + 1)
  if (end < 0) return false
  return s.slice(start + 1, end) === PAYLOAD
}

// the text with the badge at the end (added only once)
function withBadge(text) {
  const s = String(text || '')
  return hasBadge(s) ? s : s + BADGE
}

// Wraps sock.sendMessage once, so every text or caption it sends carries the badge.
// Deletes, reactions and media without text are left untouched.
function attach(sock) {
  if (!sock || typeof sock.sendMessage !== 'function' || sock.__zenxBadge) return false
  sock.__zenxBadge = true
  const original = sock.sendMessage.bind(sock)

  sock.sendMessage = (jid, content, options) => {
    if (content && typeof content === 'object' && !('delete' in content) && !('react' in content)) {
      if (typeof content.text === 'string' && content.text.trim() && !hasBadge(content.text)) {
        content = { ...content, text: content.text + BADGE }
      } else if (typeof content.caption === 'string' && content.caption.trim() && !hasBadge(content.caption)) {
        content = { ...content, caption: content.caption + BADGE }
      }
    }
    return original(jid, content, options)
  }
  return true
}

module.exports = { BADGE_LABEL, BADGE, withBadge, hasBadge, attach, _internals: { encodeBytes, TOKEN } }

