'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/sudolist.js — ZEN X | .sudolist   (owner only)
//  Shows every sudo user for this bot, tagged, with the date they were added.
// ════════════════════════════════════════════════════════════════════

const sudoStore = require('../core/sudostore')
const { CREDIT, sessionOf } = require('../core/sudoargs')

module.exports = {
  name: 'sudolist',
  aliases: ['sudos'],
  desc: 'Show all sudo users',
  usage: '.sudolist',
  category: 'owner',

  run: async ({ sock, from, msg, isOwner }) => {
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}` }, { quoted: msg })

    if (!isOwner) return reply('❌ Only the bot owner can view the sudo list.')

    const items = sudoStore.list(sessionOf(sock))
    if (!items.length) {
      return reply('*Sudo users:* none yet.\n\nAdd one with *.addsudo @user*')
    }

    const lines = items.map((i, n) =>
      `${n + 1}. @${i.number}  _(added ${i.addedAt ? i.addedAt.slice(0, 10) : 'unknown'})_`
    )

    return sock.sendMessage(from, {
      text: `*Sudo users (${items.length}):*\n${lines.join('\n')}\n\n${CREDIT}`,
      mentions: items.map(i => `${i.number}@s.whatsapp.net`),
    }, { quoted: msg })
  },
}

