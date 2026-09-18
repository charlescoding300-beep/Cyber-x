'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/goodbye.js  —  ZEN X  |  Goodbye
//  Reuses welcome.js's storage (loadGreet/saveGreet) so the watchdog's
//  single data file covers both welcome and goodbye correctly.
// ════════════════════════════════════════════════════════════════════

const { loadGreet, saveGreet } = require('./welcome.js')

module.exports = {
    loadGreet, // re-exported so index.js's `goodbyeCmd.loadGreet(...)` call works too

    pattern:  'goodbye',
    alias:    [],
    category: 'group',
    desc:     'Enable or disable the leave/goodbye message for this group',
    usage:    '.goodbye on | .goodbye off',

    run: async ({ sock, from, msg, args }) => {
        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return sock.sendMessage(from, { text: '*This command only works inside a group.*' }, { quoted: msg })
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        const sub = (args?.[0] || '').toLowerCase()

        if (sub !== 'on' && sub !== 'off') {
            const state = loadGreet(phone, from).goodbye.enabled ? 'ON ✅' : 'OFF ❌'
            return sock.sendMessage(from, {
                text: `*Goodbye is currently: ${state}*\n\nUse *.goodbye on* or *.goodbye off*`,
            }, { quoted: msg })
        }

        saveGreet(phone, from, 'goodbye', { enabled: sub === 'on' })
        const reply = sub === 'on'
            ? '*Goodbye Command Enabled successfully ✅*'
            : '*Goodbye Command Disabled successfully ❌*'

        await sock.sendMessage(from, { text: reply }, { quoted: msg })
    },
}
