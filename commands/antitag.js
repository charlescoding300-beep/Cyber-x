// ════════════════════════════════════════════════════════════════════
//  commands/antitag.js  —  CYBER X  |  🏷️ Anti-Tag (MEMBERS ONLY)
// ════════════════════════════════════════════════════════════════════
'use strict'

const { getSettings, saveSettings, handleAntitag } = require('../lib/antitag')

function box(title, lines = []) {
  const w = 26
  const top  = `╔${'═'.repeat(w)}╗`
  const mid  = `╠${'═'.repeat(w)}╣`
  const bot  = `╚${'═'.repeat(w)}╝`
  const row  = s => `║  ${s.padEnd(w - 2)}║`
  return [top, row(`  ${title}`), mid, ...lines.map(row), bot, '> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*'].join('\n')
}

module.exports = {
  pattern:  'antitag',
  category: 'admin',
  desc:     'Anti-tag system for MEMBERS — delete / warn / kick',
  usage:    '.antitag on | off | delete | warn | kick | status',
  handler:  handleAntitag,

  run: async ({ sock, from, msg, args, isAdmin }) => {
    if (!from?.endsWith('@g.us'))
      return sock.sendMessage(from, { text: box('❌ ERROR', ['Groups only!']) }, { quoted: msg })

    if (!isAdmin)
      return sock.sendMessage(from, { text: box('🛡️ ADMINS ONLY', ['Need admin to change this.']) }, { quoted: msg })

    const s     = getSettings(from)
    const input = (args || []).map(a => a.toLowerCase().trim())
    const sub   = input[0]

    if (sub === 'status') {
      return sock.sendMessage(from, {
        text: box('🏷️ ANTI-TAG STATUS', [
          `Enabled : ${s.enabled ? '✅ ON' : '❌ OFF'}`,
          `Action  : ${(s.action || 'delete').toUpperCase()}`,
          'Scope   : MEMBERS only',
        ])
      }, { quoted: msg })
    }

    if (sub === 'off') {
      s.enabled = false; saveSettings(from, s)
      return sock.sendMessage(from, { text: box('🏷️ ANTI-TAG', ['🔴 OFF — members can tag freely']) }, { quoted: msg })
    }

    if (sub === 'on' || !sub) {
      s.enabled = true; s.action = 'delete'; saveSettings(from, s)
      return sock.sendMessage(from, { text: box('🏷️ ANTI-TAG', ['🟢 ON', 'Action  : DELETE', 'Scope   : Members only']) }, { quoted: msg })
    }

    if (['delete', 'warn', 'kick'].includes(sub)) {
      s.enabled = true; s.action = sub; saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('🏷️ ANTI-TAG', [
          '🟢 ON',
          `Action  : ${sub.toUpperCase()}`,
          sub === 'warn' ? 'Warn x3 = auto-kick' : '',
          sub === 'kick' ? 'Zero tolerance — instant remove' : '',
        ].filter(Boolean))
      }, { quoted: msg })
    }

    // Help
    return sock.sendMessage(from, {
      text: box('🏷️ ANTI-TAG HELP', [
        '.antitag on       → enable (delete)',
        '.antitag off      → disable',
        '.antitag delete   → delete only',
        '.antitag warn     → warn x3 then kick',
        '.antitag kick     → instant remove',
        '.antitag status   → show settings',
      ])
    }, { quoted: msg })
  },
}
