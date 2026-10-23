'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — .antistatus
//
// Turns the status-deleter on/off per group. When ON, any WhatsApp status that
// gets shared into the group chat (a member tagging the group in their status)
// is DELETED by the bot (lib/antistatusgc.js does the work), then:
//   warn   (default) → delete + warning each time; saved permanently; 3 warnings = removed
//   delete           → just delete + short notice (no warnings, no kick)
//   kick             → delete + removed instantly
// Group admins and the owner are never touched.
//
// ⚠️  THE BOT'S OWN NUMBER MUST BE A GROUP ADMIN. You being admin is not enough —
//     WhatsApp only lets an admin delete other people's messages, and the one
//     doing the deleting is the bot. Warn mode now deletes too (it used to only
//     warn and leave the status in the chat), so every mode needs the bot as admin.
//
// WARNINGS ARE PERMANENT: saved on disk (lib/antistatusStore.js) and only cleared
// by an admin — .resetwarn antistatus @user   (or .antistatus reset @user|all).
//
//   .antistatus on [warn|delete|kick]
//   .antistatus off
//   .antistatus status
//   .antistatus warns              → everyone with saved warnings in this group
//   .antistatus reset @user|all    → clear saved warnings (@mention or reply)
//   .antistatus check              → diagnoses why deleting might not work
//   shortcut:  .antistatus kick    (= turn on in kick mode)
//
// Credit: set BOT_CREDIT in .env to change it everywhere (default below).

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
const store = require('../lib/antistatusStore').antistatusStore

const MODES = {
  warn:   `⚠️ Delete the status + warn. Warnings are saved permanently${store.KICK_AT_MAX ? `; ${store.MAX_WARNS} warnings = removed` : ' (count only, no auto-remove)'}. Clear with .antistatus reset @user`,
  delete: '🗑️ Delete the shared status and send one deletion notice',
  kick:   '👢 Delete the status and remove the sender with one notice',
}

const USAGE =
  '❌ Usage:\n' +
  '• .antistatus on [warn|delete|kick]\n' +
  '• .antistatus off\n' +
  '• .antistatus status\n' +
  '• .antistatus warns\n' +
  '• .antistatus reset @user | all\n' +
  '• .antistatus check'

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

const bare = jid => String(jid || '').replace(/@.+$/, '').replace(/:\d+$/, '')

// Independent check of "is the BOT an admin here?" straight from the group's member list,
// so a wrong isBotAdmin flag from the message handler can't hide the real problem.
async function checkBotAdmin(sock, groupJid) {
  try {
    const meta = await sock.groupMetadata(groupJid)
    const ids = new Set([bare(sock.user?.id), bare(sock.user?.lid)].filter(Boolean))
    const me = (meta.participants || []).find(p =>
      [p.id, p.lid, p.phoneNumber, p.jid].some(x => x && ids.has(bare(x)))
    )
    return { found: !!me, admin: !!me?.admin, members: (meta.participants || []).length }
  } catch (e) {
    return { found: false, admin: false, error: e.message }
  }
}

// who does the admin mean? @mentions first, then the replied-to person
function targetsFrom(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.conversation?.contextInfo || {}
  const out = new Set((ctx.mentionedJid || []).map(store.norm))
  if (!out.size && ctx.participant && ctx.quotedMessage) out.add(store.norm(ctx.participant))
  return [...out]
}

const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

module.exports = {
  name: 'antistatus',
  aliases: [],
  desc: 'Choose one action for statuses shared in this group',
  usage: '.antistatus on [warn|delete|kick] | off | status | warns | reset @user|all | check',
  category: 'group',
  adminOnly: true,

  run: async ({ sock, from, msg, args, lib, isGroup, isAdmin, isBotAdmin }) => {
    const reply = (text, mentions) =>
      sock.sendMessage(from, mentions ? { text, mentions } : { text }, { quoted: msg })

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
      if (action === 'on' && modeArg && !MODES[modeArg]) return reply(USAGE)
      const mode = MODES[action] ? action : (MODES[modeArg] ? modeArg : 'warn')

      // EVERY mode deletes messages, so EVERY mode needs the bot to be admin
      const direct = await checkBotAdmin(sock, from)
      const botIsAdmin = !!isBotAdmin || direct.admin
      if (!botIsAdmin) return sendBotNotAdmin(sock, from, msg)

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

    // ── WARNS: the permanent record for this group ──
    if (action === 'warns' || action === 'list') {
      const rows = store.list(phone, from)
      if (!rows.length) return reply(box('📱 *ANTISTATUS WARNS*', ['│ ✅ No saved warnings in this group']))
      const lines = rows.slice(0, 40).map(r =>
        `│ @${bare(r.user)} — *${r.count}/${store.MAX_WARNS}* · last ${fmtDate(r.last)}`
      )
      lines.push('│', '│ 🧹 Clear one: _.antistatus reset @user_ (or _.resetwarn antistatus @user_ once wired)')
      return reply(box('📱 *ANTISTATUS WARNS*', lines), rows.slice(0, 40).map(r => r.user))
    }

    // ── RESET: clear saved warnings (admin only, manual) ──
    if (action === 'reset') {
      if (String(args[1] || '').toLowerCase() === 'all') {
        const n = store.reset(phone, from, 'all')
        return reply(box('📱 *ANTISTATUS*', [`│ 🧹 Cleared *${n}* saved warning record${n === 1 ? '' : 's'} in this group`]))
      }
      const targets = targetsFrom(msg)
      if (!targets.length) return reply('❌ Mention the person (or reply to them), or use: .antistatus reset all')
      const lines = []
      for (const u of targets) {
        const had = store.getWarn(phone, from, u)
        store.reset(phone, from, u)
        lines.push(`│ 🧹 @${bare(u)} — warnings cleared (was ${had}/${store.MAX_WARNS})`)
      }
      return reply(box('📱 *ANTISTATUS*', lines), targets)
    }

    // ── CHECK: why isn't it deleting? ──
    if (action === 'check') {
      const direct = await checkBotAdmin(sock, from)
      const on = !!isEnabled(phone, from)
      const here = store.list(phone, from).length
      const ok = v => (v ? '✅' : '❌')
      const lines = [
        `│ ${ok(isAdmin)} You are an admin`,
        `│ ${ok(isBotAdmin)} Bot admin (handler flag)`,
        `│ ${ok(direct.admin)} Bot admin (read from the member list)${direct.found ? '' : ' — bot not found in the list'}`,
        `│ ${ok(typeof lib?.handleAntistatusGroup === 'function')} lib/antistatusgc.js handler loaded`,
        `│ ${on ? '🟢' : '🔴'} Anti-status here: ${on ? 'ON · ' + getMode(phone, from) : 'OFF'}`,
        `│ 💾 Saved warnings: ${here} in this group (${store.stats().total} total)`,
        `│ ⚖️ Warn limit: ${store.MAX_WARNS} → ${store.KICK_AT_MAX ? 'removed from the group' : 'counted only (auto-remove is off)'}`,
      ]
      if (!direct.admin && !isBotAdmin) {
        lines.push('│', '│ 🔴 *THE BOT IS NOT A GROUP ADMIN.* That is why nothing gets deleted.',
          '│ Group info → Members → the bot’s number → *Make group admin*.')
      } else if (direct.admin !== !!isBotAdmin) {
        lines.push('│', '│ ⚠️ The two bot-admin checks disagree — send this screen to your developer; the handler may mis-detect LID/phone IDs.')
      } else {
        lines.push('│', '│ ✅ Bot is admin. Share a status to this group from a NON-admin account to test it.',
          '│ Set ANTISTATUS_DEBUG=1 in .env to log what WhatsApp sends.')
      }
      return reply(box('📱 *ANTISTATUS CHECK*', lines))
    }

    return reply(USAGE)
  }
}