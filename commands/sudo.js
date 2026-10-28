'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/sudo.js — ZEN X | .sudo   (owner only)
//
//  .sudo remove @user             remove the tagged user
//  .sudo remove @2348xxxxxxxxx    remove by number (also works without @)
//  reply to someone + .sudo remove  remove the person you replied to
//  .sudo clear                    remove every sudo user
//  .sudo help                     show these options
//
//  To ADD a sudo user use  .addsudo  ·  to VIEW them use  .sudolist
// ════════════════════════════════════════════════════════════════════

const sudoStore = require('../core/sudostore')
const { CREDIT, sessionOf, resolveSudoTarget } = require('../core/sudoargs')
const addsudo = require('./addsudo')

const HELP =
  '*Sudo commands* (owner only)\n\n' +
  '• *.addsudo @user* — add a sudo user\n' +
  '• *.sudolist* — show sudo users\n' +
  '• *.sudo remove @user* — remove (tag, reply, or number)\n' +
  '• *.sudo clear* — remove everyone'

module.exports = {
  name: 'sudo',
  aliases: [],
  desc: 'Remove sudo users (remove / clear)',
  usage: '.sudo remove @user | reply + .sudo remove | .sudo clear',
  category: 'owner',

  run: async (ctx) => {
    const { sock, from, msg, args, text, isOwner } = ctx
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}` }, { quoted: msg })

    if (!isOwner) return reply('❌ Only the bot owner can manage sudo users.')

    const session = sessionOf(sock)
    const words = (Array.isArray(args) ? args : String(text || '').split(/\s+/)).filter(Boolean)
    const sub = (words[0] || '').toLowerCase()
    const rest = words.slice(1)

    if (!words.length || sub === 'help') return reply(HELP)

    // ── remove ──────────────────────────────────────────────────────────────
    if (['remove', 'del', 'rm', 'unsudo'].includes(sub)) {
      const target = await resolveSudoTarget(sock, msg, rest)
      if (!target) {
        return reply('❌ Tag the user, reply to their message, or type their number.\nExample: *.sudo remove @user*')
      }
      const removed = sudoStore.remove(session, target.number)
      return sock.sendMessage(from, {
        text: removed
          ? `✅ @${target.number} is no longer a sudo user.\n\n${CREDIT}`
          : `ℹ️ @${target.number} is not a sudo user.\n\n${CREDIT}`,
        mentions: [target.jid],
      }, { quoted: msg })
    }

    // ── clear ───────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const count = sudoStore.clear(session)
      return reply(`🧹 Removed *${count}* sudo user(s).`)
    }

    // ── backwards compatibility: `.sudo @user` adds, like .addsudo ─────────
    if (sub === 'add') return addsudo.run({ ...ctx, args: rest, text: rest.join(' ') })
    return addsudo.run({ ...ctx, args: words, text: words.join(' ') })
  },
}

