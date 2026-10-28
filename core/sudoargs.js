'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/sudoargs.js — shared helpers for .addsudo, .sudolist and .sudo
//  Needs core/sudostore.js (the sudo list). Not auto-loaded — required by the commands.
// ════════════════════════════════════════════════════════════════════

const sudoStore = require('./sudostore')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

const cleanJid = j => String(j || '').replace(/:\d+(?=@)/, '')
const digitsOf = v => sudoStore.digits(v)
const sessionOf = sock => digitsOf(sock.user?.id)

function contextOf(msg) {
  const m = msg?.message || {}
  for (const k of Object.keys(m)) {
    const ci = m[k]?.contextInfo
    if (ci) return ci
  }
  return {}
}

// A typed number: "2348012345678", "@2348012345678", "+234 801 234 5678"
function typedNumber(words) {
  const single = words.map(w => w.replace(/\D/g, '')).find(w => sudoStore.isValidNumber(w))
  if (single) return single
  const looksNumeric = words.length > 0 && words.every(w => /^[+@\d()\-\s]+$/.test(w))
  const joined = words.join('').replace(/\D/g, '')
  return looksNumeric && sudoStore.isValidNumber(joined) ? joined : null
}

// Who is the command aimed at?  @mention → replied-to user → typed number
async function resolveSudoTarget(sock, msg, words) {
  const ctx = contextOf(msg)
  let jid = null

  if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length) {
    jid = cleanJid(ctx.mentionedJid[0])
  } else if (ctx.quotedMessage && ctx.participant) {
    jid = cleanJid(ctx.participant)
  } else {
    const typed = typedNumber(words)
    if (typed) jid = `${typed}@s.whatsapp.net`
  }

  if (!jid || jid.endsWith('@g.us')) return null

  let number = digitsOf(jid)

  // hidden-number (@lid) accounts: use the real phone number when Baileys knows it
  if (jid.endsWith('@lid')) {
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid)
      if (pn) {
        number = digitsOf(pn)
        jid = String(pn).includes('@') ? cleanJid(pn) : `${number}@s.whatsapp.net`
      }
    } catch {}
  }

  return { jid, number }
}

// true when the words contain something that was meant to be a number but isn't valid
const hasNumberLike = words => words.some(w => w.replace(/\D/g, '').length >= 3)

module.exports = { CREDIT, sessionOf, digitsOf, resolveSudoTarget, hasNumberLike }

