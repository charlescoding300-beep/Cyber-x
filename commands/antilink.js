'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/antilink.js  —  ZEN X  |  Antilink Toggle
//
//  index.js already has a COMPLETE, working, built-in antilink engine
//  (functions antilinkEnable/Disable/IsEnabled/GetAction/ResetWarnings,
//  exposed as global.__antilinkEnable etc. in init()). This command
//  just calls those — it does NOT implement its own detection/storage.
// ════════════════════════════════════════════════════════════════════

module.exports = {
    pattern:  'antilink',
    alias:    [],
    category: 'group',
    desc:     'Enable or disable the link watchdog for this group',
    usage:    '.antilink on | .antilink off | .antilink warn | .antilink kick | .antilink delete',

    run: async ({ sock, from, msg, args }) => {
        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return sock.sendMessage(from, { text: '*This command only works inside a group.*' }, { quoted: msg })
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        const sub = (args?.[0] || '').toLowerCase()

        if (!['on', 'off', 'delete', 'warn', 'kick'].includes(sub)) {
            const enabled = global.__antilinkIsEnabled(phone, from)
            const action  = global.__antilinkGetAction(phone, from)
            return sock.sendMessage(from, {
                text: `*Antilink is currently: ${enabled ? 'ON ✅' : 'OFF ❌'}*\n*Mode:* ${action}\n\nUse *.antilink on* (defaults to delete), *.antilink warn* (3 strikes → kick), *.antilink kick* (instant kick), or *.antilink off*`,
            }, { quoted: msg })
        }

        if (sub === 'off') {
            global.__antilinkDisable(phone, from)
            return sock.sendMessage(from, { text: '*Antilink Disabled successfully ❌*' }, { quoted: msg })
        }

        // on / delete / warn / kick all enable it, with the matching action
        const mode = sub === 'on' ? 'delete' : sub
        global.__antilinkEnable(phone, from, mode)

        await sock.sendMessage(from, {
            text: `*Antilink Enabled successfully ✅*\n*Mode:* ${mode}`,
        }, { quoted: msg })
    },
}

