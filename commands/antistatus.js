'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — .antistatus
//
// Turns the status-deleter on/off per group. When ON, any WhatsApp status that
// gets shared into the group chat (a member tagging the group in their status)
// is DELETED by the bot (lib/antistatusgc.js does the work), then:
//   warn   (default) → warning each time, 3 warnings = removed from the group
//   delete           → just delete + short notice (no warnings, no kick)
//   kick             → delete + removed instantly
// Group admins and the owner are never touched. The bot must be a group admin.
//
//   .antistatus on [warn|delete|kick]
//   .antistatus off
//   .antistatus status
//   shortcut:  .antistatus kick   (= turn on in kick mode)
//
// Credit: set BOT_CREDIT in .env to change it everywhere (default below).

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')

const MODES = {
  warn:   '⚠️ Send one warning only; count persists until .resetwarn antistatus @user',
  delete: '🗑️ Delete the shared status and send one deletion notice',
  kick:   '👢 Delete the status and remove the sender with one notice',
}

const USAGE =
  '❌ Usage:\n' +
  '• .antistatus on [warn|delete|kick]\n' +
  '• .antistatus off\n' +
  '• .antistatus status'

const box = (title, lines) =>
  `╔════════════════════╗\n║  ${title}  ║\n╚════════════════════╝\n\n${lines.join('\n')}\n\n${CREDIT}`

// The engine stores its data per session, so find which session this socket belongs to.
function sessionPhone(sock) {
  try {
    for (const [phone, st] of (global.__sessionStates || [])) {
      if (st?.sock === sock) return phone
    }
  } catch {}
  return String(sock.user?.id || '').replace(/@.+$/, '').replace(/:\d+$/, '').replace(/\D/g, '')
}

module.exports = {
  name: 'antistatus',
  aliases: [],
  desc: 'Choose one action for statuses shared in this group',
  usage: '.antistatus on [warn|delete|kick] | off | status',
  category: 'group',
  adminOnly: true,

  run: async ({ sock, from, msg, args, lib, isGroup, isAdmin, isBotAdmin }) => {
    const reply = (text) => sock.sendMessage(from, { text }, { quoted: msg })

    if (!isGroup) return reply('❌ This command only works in groups.')
    if (!isAdmin) return reply('❌ Only admins can use this command.')

    const enable    = global.__antistatusEnable
    const disable   = global.__antistatusDisable
    const isEnabled = global.__antistatusIsEnabled
    const getMode   = global.__antistatusGetMode
    if ([enable, disable, isEnabled, getMode].some(fn => typeof fn !== 'function')) {
      return reply('❌ Anti-status engine is not loaded — restart the bot and try again.')
    }

    const phone   = sessionPhone(sock)
    const action  = String(args[0] || '').toLowerCase()
    const modeArg = String(args[1] || '').toLowerCase()

    // ── ON (".antistatus on kick" or the shortcut ".antistatus kick") ──
    if (action === 'on' || MODES[action]) {
      if (!isBotAdmin) return sendBotNotAdmin(sock, from, msg)
      if (action === 'on' && modeArg && !MODES[modeArg]) return reply(USAGE)
      const mode = MODES[action] ? action : (MODES[modeArg] ? modeArg : 'warn')

      enable(phone, from, mode)

      const lines = [
        '│ ✅ *Anti-Status is now ON*',
        `│ ⚙️ *Mode:* ${mode}`,
        `│ ${MODES[mode]}`,
        '│ 📱 Applies to statuses shared in this group chat (admins are exempt)',
      ]
      if (!lib || typeof lib.handleAntistatusGroup !== 'function') {
        lines.push('│ ⚠️ lib/antistatusgc.js is not loaded — add it and restart the bot')
      }
      return reply(box('📱 *ANTISTATUS*', lines))
    }

    // ── OFF ──
    if (action === 'off') {
      disable(phone, from)
      return reply(box('📱 *ANTISTATUS*', ['│ ❌ *Anti-Status is now OFF*']))
    }

    // ── STATUS ──
    if (action === 'status') {
      const on = !!isEnabled(phone, from)
      const lines = [`│ 📊 *Status:* ${on ? '🟢 ON' : '🔴 OFF'}`]
      if (on) {
        const mode = getMode(phone, from)
        lines.push(`│ ⚙️ *Mode:* ${mode}`)
        if (MODES[mode]) lines.push(`│ ${MODES[mode]}`)
      }
      return reply(box('📱 *ANTISTATUS*', lines))
    }

    return reply(USAGE)
  }
}
