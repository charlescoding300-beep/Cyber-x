// ════════════════════════════════════════════════════════════════════
//  commands/antitag.js  —  CYBER X  |  🏷️ Anti-Tag Command
//  Engine lives in lib/antitag.js — this file is just the command
// ════════════════════════════════════════════════════════════════════

const { getSettings, saveSettings } = require('../lib/antitag')

// Re-export handler so index.js can import from here too
const { handleAntitag } = require('../lib/antitag')

function box(title, lines = []) {
  return (
    `╔══════════════════════╗\n` +
    `║  ${title}\n` +
    `╠══════════════════════╣\n` +
    lines.map(l => `║  ${l}`).join('\n') + '\n' +
    `╚══════════════════════╝\n` +
    `> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
  )
}

module.exports = {
  pattern:   'antitag',
  category:  'admin',
  desc:      'Anti-tag system — delete / warn / kick taggers',
  usage:     '.antitag on | off | delete warn kick | admin on | admin stop',
  groupOnly: true,
  adminOnly: true,

  // ← index.js can import this: const { handler: antitagHandler } = require('./commands/antitag')
  handler: handleAntitag,

  run: async ({ sock, from, msg, args, isAdmin }) => {

    if (!from?.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: box('❌ *ERROR*', ['🚫 Groups only!'])
      }, { quoted: msg })
    }

    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: box('🛡️ *ADMINS ONLY*', ['You need admin to change antitag.'])
      }, { quoted: msg })
    }

    const s     = getSettings(from)
    const input = (args || []).map(a => a.toLowerCase().trim())

    // ── .antitag off ─────────────────────────────────────────────
    if (input[0] === 'off') {
      s.enabled = false
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ *ANTI-TAG*', [
          '🔴 Status: *OFF*',
          '🔕 Tag protection disabled',
        ])
      }, { quoted: msg })
    }

    // ── .antitag admin stop ───────────────────────────────────────
    if (input[0] === 'admin' && input[1] === 'stop') {
      s.adminExempt = true
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ *ANTI-TAG*', [
          '🛡️ Admin Mode: *OFF*',
          'Admins are exempt again',
        ])
      }, { quoted: msg })
    }

    // ── .antitag admin on | admin delete warn kick ────────────────
    if (input[0] === 'admin') {
      s.adminExempt = false
      s.enabled     = true
      const sub = input.slice(1).filter(a => ['delete', 'warn', 'kick'].includes(a))
      s.actions = sub.length ? sub : ['delete']
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ *ANTI-TAG — ADMIN MODE*', [
          '🟢 Status: *ON*',
          '👑 Admins: *INCLUDED*',
          `⚡ Actions: *${s.actions.join(' + ').toUpperCase()}*`,
          '💬 Sassy replies: *ACTIVE*',
        ])
      }, { quoted: msg })
    }

    // ── .antitag on (default: delete only, admins exempt) ─────────
    if (input[0] === 'on' || input.length === 0) {
      s.enabled     = true
      s.adminExempt = true
      s.actions     = ['delete']
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ *ANTI-TAG*', [
          '🟢 Status: *ON*',
          '🛡️ Admins: Exempt',
          '⚡ Actions: *DELETE*',
        ])
      }, { quoted: msg })
    }

    // ── .antitag delete warn kick (any combo) ─────────────────────
    const validActions = input.filter(a => ['delete', 'warn', 'kick'].includes(a))
    if (validActions.length) {
      s.enabled     = true
      s.adminExempt = true
      s.actions     = validActions
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ *ANTI-TAG*', [
          '🟢 Status: *ON*',
          '🛡️ Admins: Exempt',
          `⚡ Actions: *${validActions.join(' + ').toUpperCase()}*`,
        ])
      }, { quoted: msg })
    }

    // ── Help fallback ─────────────────────────────────────────────
    return sock.sendMessage(from, {
      text: box('🏷️ *ANTI-TAG HELP*', [
        '◈ *.antitag on*',
        '◈ *.antitag off*',
        '◈ *.antitag delete*',
        '◈ *.antitag delete warn*',
        '◈ *.antitag delete warn kick*',
        '◈ *.antitag admin on*',
        '◈ *.antitag admin delete warn kick*',
        '◈ *.antitag admin stop*',
      ])
    }, { quoted: msg })
  },
}
