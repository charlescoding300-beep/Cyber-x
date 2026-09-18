'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/antitag.js  —  ZEN X  |  Antitag Toggle
//
//  index.js's built-in handleAntitagInline already deletes ANY message
//  containing mentions once enabled per group (covers @all / tag-all
//  and individual @mentions alike). This just flips that switch via
//  the real global functions index.js exposes.
// ════════════════════════════════════════════════════════════════════

module.exports = {
    pattern:  'antitag',
    alias:    [],
    category: 'group',
    desc:     'Enable or disable auto-delete of @all / tag-all and mention messages',
    usage:    '.antitag on | .antitag off',

    run: async ({ sock, from, msg, args }) => {
        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return sock.sendMessage(from, { text: '*This command only works inside a group.*' }, { quoted: msg })
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        const sub = (args?.[0] || '').toLowerCase()

        if (sub !== 'on' && sub !== 'off') {
            const state = global.__antitagIsEnabled(phone, from) ? 'ON ✅' : 'OFF ❌'
            return sock.sendMessage(from, {
                text: `*Antitag is currently: ${state}*\n\nUse *.antitag on* or *.antitag off*`,
            }, { quoted: msg })
        }

        if (sub === 'on') {
            global.__antitagEnable(phone, from)
        } else {
            global.__antitagDisable(phone, from)
        }

        await sock.sendMessage(from, {
            text: sub === 'on'
                ? '*Antitag Enabled successfully ✅*\nMessages with @mentions (including @all/tag-all) will now be deleted.'
                : '*Antitag Disabled successfully ❌*',
        }, { quoted: msg })
    },
}
