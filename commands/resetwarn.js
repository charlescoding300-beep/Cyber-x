'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/resetwarn.js  —  ZEN X  |  Reset Antilink Warnings
//  Reply to the member's message with .resetwarn to clear their strikes.
//  Calls global.__antilinkResetWarnings — the real function in index.js.
// ════════════════════════════════════════════════════════════════════

module.exports = {
    pattern:  'resetwarn',
    alias:    ['clearwarn', 'unwarn'],
    category: 'group',
    desc:     "Reset a member's antilink warning count",
    usage:    'Reply to their message with .resetwarn',

    run: async ({ sock, from, msg }) => {
        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return sock.sendMessage(from, { text: '*This command only works inside a group.*' }, { quoted: msg })
        }

        const quotedJid = msg.message?.extendedTextMessage?.contextInfo?.participant
        if (!quotedJid) {
            return sock.sendMessage(from, {
                text: '*Reply to the member\'s message with .resetwarn to clear their warnings.*',
            }, { quoted: msg })
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        global.__antilinkResetWarnings(phone, from, quotedJid)

        await sock.sendMessage(from, {
            text: `*Warnings reset for @${quotedJid.split('@')[0]} ✅*`,
            mentions: [quotedJid],
        }, { quoted: msg })
    },
}
