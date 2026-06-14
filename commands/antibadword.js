'use strict'
/**
 * commands/antibadword.js — CYBER X Anti Bad Word (MEMBERS)
 *
 * Owner commands:
 *   .antibadword on          → enable for members
 *   .antibadword off         → disable
 *   .antibadword delete      → action: delete message (default)
 *   .antibadword warn        → action: warn (3x = auto kick)
 *   .antibadword kick        → action: kick instantly
 *   .antibadword status      → show current settings
 *   .antibadword reset @user → reset warn count for user
 *
 * Auto enforcement runs via lib/antibadword.js → handleAntilink hook
 */

const {
  getSettings, setEnabled, setAction, resetWarns,
} = require('../lib/antibadword')

const CREDIT   = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const MAX_WARN = 3

module.exports = {
  pattern:  'antibadword',
  desc:     'Filter bad words for members',
  usage:    '.antibadword on/off/delete/warn/kick/status/reset @user',
  category: 'moderation',

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ Only *bot owner* can configure antibadword.\n\n${CREDIT}`,
      }, { quoted: msg })
    }
    if (!from.endsWith('@g.us')) {
      return sock.sendMessage(from, {
        text: `❌ Groups only!\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const sub = (args[0] || '').toLowerCase()
    const s   = getSettings(from)

    // ── ON ──────────────────────────────────────────────────────
    if (sub === 'on') {
      setEnabled(from, true, 'member')
      return sock.sendMessage(from, {
        text:
`╔══════════════════════════╗
║  ✅ ANTIBADWORD ON       ║
╚══════════════════════════╝

🛡️ *Members* are now monitored
🎯 *Action:* ${s.memberAction || 'delete'}
🤐 Any bad word = instant action

💡 To also filter admins: *.abwa on*

${CREDIT}`,
      }, { quoted: msg })

    // ── OFF ─────────────────────────────────────────────────────
    } else if (sub === 'off') {
      setEnabled(from, false, 'member')
      return sock.sendMessage(from, {
        text: `✅ Antibadword *disabled* for members.\n\n${CREDIT}`,
      }, { quoted: msg })

    // ── ACTIONS ─────────────────────────────────────────────────
    } else if (['delete', 'warn', 'kick'].includes(sub)) {
      setAction(from, sub, 'member')
      return sock.sendMessage(from, {
        text:
`✅ *Member bad word action set to:* ${sub.toUpperCase()}
${sub === 'warn' ? `⚠️ ${MAX_WARN} warnings = auto kick` : ''}
${sub === 'kick' ? '👢 Zero tolerance — instant removal' : ''}
${sub === 'delete' ? '🗑️ Message silently deleted' : ''}

${CREDIT}`,
      }, { quoted: msg })

    // ── STATUS ──────────────────────────────────────────────────
    } else if (sub === 'status') {
      const s2 = getSettings(from)
      return sock.sendMessage(from, {
        text:
`📊 *Antibadword Status*

👥 *Members:* ${s2.memberEnabled ? '✅ ON' : '❌ OFF'} | Action: *${s2.memberAction}*
👑 *Admins:*  ${s2.adminEnabled  ? '✅ ON' : '❌ OFF'} | Action: *${s2.adminAction}*

💡 Use *.abwa* to configure admin filter

${CREDIT}`,
      }, { quoted: msg })

    // ── RESET ───────────────────────────────────────────────────
    } else if (sub === 'reset') {
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      if (!mentioned.length) {
        return sock.sendMessage(from, {
          text: `❌ Tag a user: *.antibadword reset @user*\n\n${CREDIT}`,
        }, { quoted: msg })
      }
      resetWarns(from, mentioned[0])
      return sock.sendMessage(from, {
        text: `✅ Warns reset for @${mentioned[0].split('@')[0]}\n\n${CREDIT}`,
        mentions: mentioned,
      }, { quoted: msg })

    // ── HELP ────────────────────────────────────────────────────
    } else {
      return sock.sendMessage(from, {
        text:
`┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  🛡️ *CYBER X ANTIBADWORD*
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

*.antibadword on*         → Enable member filter
*.antibadword off*        → Disable member filter
*.antibadword delete*     → 🗑️ Delete message (default)
*.antibadword warn*       → ⚠️ Warn (${MAX_WARN}x = auto kick)
*.antibadword kick*       → 👢 Kick instantly
*.antibadword status*     → 📊 Show settings
*.antibadword reset @u*   → 🔄 Reset user's warns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 For admins: *.abwa on/off*
Both can run at the same time!

${CREDIT}`,
      }, { quoted: msg })
    }
  },
}

