'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/say.js  —  CYBER X  |  🗣️ Say (TTS Shortcut)
//  Usage: .say <text>
//  Reaction: 🗣️ | Category: utility
// ════════════════════════════════════════════════════════════════════

const tts = require('./tts')

module.exports = {
    pattern:  'say',
    category: 'media',
    desc:     'Convert text to speech (shortcut for .tts)',
    usage:    '.say <text>',

    run: async (ctx) => {
        return tts.run(ctx)
    }
}
