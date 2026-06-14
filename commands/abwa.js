// ════════════════════════════════════════════════════════════════════
//  commands/abwa.js  —  CYBER X  |  👑 Anti-Tag (ADMINS ONLY)
// ════════════════════════════════════════════════════════════════════
'use strict'

const { getSettings, saveSettings, handleAbwa } = require('../lib/abwa')

const CREDIT = '> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*'

function box(title, lines = []) {
  const w   = 28
  const top = `╔${'═'.repeat(w)}╗`
  const mid = `╠${'═'.repeat(w)}╣`
  const bot = `╚${'═'.repeat(w)}╝`
  const row = s => `║  ${s.padEnd(w - 2)}║`
  return [top, row(`  ${title}`), mid, ...lines.map(row), bot, CREDIT].join('\n')
}

module.exports = {
  pattern:  'abwa',
  category: 'admin',
  desc:     'Anti-tag system for ADMINS — delete / warn / kick',
  usage:    '.abwa on | off | delete | warn | kick | status | reset @user',
  handler:  handleAbwa,

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner)
      return sock.sendMessage(from, { text: `❌ Only *bot owner* can configure *.abwa*\n\n${CREDIT}` }, { quoted: msg })

    if (!from?.endsWith('@g.us'))
      return sock.sendMessage(from, { text: `❌ Groups only!\n\n${CREDIT}` }, { quoted: msg })

    const s   = getSettings(from)
    const sub = (args[0] || '').toLowerCase().trim()

    if (sub === 'status') {
      return sock.sendMessage(from, {
        text: box('👑 ABWA STATUS', [
          `Enabled : ${s.enabled ? '✅ ON' : '❌ OFF'}`,
          `Action  : ${(s.action || 'delete').toUpperCase()}`,
          'Scope   : ADMINS only',
        ])
      }, { quoted: msg })
    }

    if (sub === 'off') {
      s.enabled = false; saveSettings(from, s)
      return sock.sendMessage(from, { text: box('👑 ABWA', ['🔴 OFF — admins can tag freely']) }, { quoted: msg })
    }

    if (sub === 'on' || !sub) {
      s.enabled = true; s.action = 'delete'; saveSettings(from, s)
      return sock.sendMessage(from, { text: box('👑 ABWA', ['🟢 ON', 'Action  : DELETE', 'Scope   : Admins only']) }, { quoted: msg })
    }

    if (['delete', 'warn', 'kick'].includes(sub)) {
      s.enabled = true; s.action = sub; saveSettings(from, s)
      return sock.sendMessage(from, {
        text: box('👑 ABWA', [
          '🟢 ON',
          `Action  : ${sub.toUpperCase()}`,
          sub === 'warn' ? 'Warn x3 = demote + kick' : '',
          sub === 'kick' ? 'Zero tolerance — demote + remove' : '',
        ].filter(Boolean))
      }, { quoted: msg })
    }

    if (sub === 'reset') {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      if (!mentioned.length)
        return sock.sendMessage(from, { text: `❌ Tag a user: *.abwa reset @user*\n\n${CREDIT}` }, { quoted: msg })
      if (!s.warns) s.warns = {}
      s.warns[mentioned[0]] = 0
      saveSettings(from, s)
      return sock.sendMessage(from, {
        text: `✅ Warns reset for @${mentioned[0].split('@')[0]}\n\n${CREDIT}`,
        mentions: mentioned,
      }, { quoted: msg })
    }

    // Help
    return sock.sendMessage(from, {
      text: box('👑 ABWA HELP', [
        '.abwa on          → enable (delete)',
        '.abwa off         → disable',
        '.abwa delete      → delete only',
        '.abwa warn        → warn x3 then demote+kick',
        '.abwa kick        → instant demote+remove',
        '.abwa status      → show settings',
        '.abwa reset @u    → reset admin warns',
      ])
    }, { quoted: msg })
  },
}
