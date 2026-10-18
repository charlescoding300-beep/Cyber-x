'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/vunmute.js — ZEN X | .vunmute
//  Reply to a muted member (or @mention / type their number) to unmute them.
//  Same as .vmute off. Shares the same storage, so both always agree.
// ════════════════════════════════════════════════════════════════════

const vmute = require('./vmute')

module.exports = {
  name: 'vunmute',
  aliases: [],
  desc: 'Unmute a group member (reply, @mention, or number)',
  usage: '.vunmute (reply / @mention / number)',
  category: 'group',

  run: (ctx) => vmute.run({ ...ctx, args: ['off', ...(Array.isArray(ctx.args) ? ctx.args : [])] }),
}
