'use strict'
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
// ════════════════════════════════════════════════════════════════════
//  commands/antitag.js  —  ZEN X  |  Antitag Toggle
//
//  index.js's built-in handleAntitagInline already deletes ANY message
//  containing mentions once enabled per group (covers @all / tag-all
//  and individual @mentions alike). This just flips that switch via
//  the real global functions index.js exposes.
//
//  Every reply quotes the command message AND tags the user who ran it.
// ════════════════════════════════════════════════════════════════════

function cleanJid(jid) {
    if (!jid || typeof jid !== 'string') return null
    return jid.replace(/:\d+(?=@)/, '')
}

module.exports = {
    pattern:  'antitag',
    alias:    [],
    category: 'group',
    permissions: ({ args }) => ({
        groupAdmin: ['on', 'off'].includes(String(args?.[0] || '').toLowerCase()),
        adminOrOwner: true,
    }),
    desc:     'Enable or disable auto-delete of @all / tag-all and mention messages',
    usage:    '.antitag on | .antitag off',

    run: async ({ sock, from, msg, args, sender, isAdmin, isOwner, isBotAdmin }) => {
        // ── Who ran the command (to tag them) ────────────────────────────────
        const userJid = cleanJid(sender || msg?.key?.participant || msg?.participant || from)
        const userTag = userJid ? `@${userJid.split('@')[0]}` : ''

        // Every reply: quotes the command message + mentions the user
        const reply = (text) =>
            sock.sendMessage(from, {
                text: userTag ? `${userTag}\n\n${text}` : text,
                mentions: userJid ? [userJid] : [],
            }, { quoted: msg })

        const isGroup = from.endsWith('@g.us')
        if (!isGroup) {
            return reply('*This command only works inside a group.*')
        }

        // Safety: index.js must expose these globals
        if (
            typeof global.__antitagIsEnabled !== 'function' ||
            typeof global.__antitagEnable    !== 'function' ||
            typeof global.__antitagDisable   !== 'function'
        ) {
            return reply('*❌ Antitag system is not loaded. Check index.js.*')
        }

        const phone = (sock.user?.id || '').split(':')[0].split('@')[0]
        const sub = (args?.[0] || '').toLowerCase()

        if (sub !== 'on' && sub !== 'off') {
            const state = global.__antitagIsEnabled(phone, from) ? 'ON ✅' : 'OFF ❌'
            return reply(`*Antitag is currently: ${state}*\n\nUse *.antitag on* or *.antitag off*`)
        }

        if (!isAdmin && !isOwner) return reply('*Only a group admin or the bot owner can change anti-tag settings.*')
        if (sub === 'on' && !isBotAdmin) return sendBotNotAdmin(sock, from, msg)

        if (sub === 'on') {
            global.__antitagEnable(phone, from)
        } else {
            global.__antitagDisable(phone, from)
        }

        await reply(
            sub === 'on'
                ? '*Antitag Enabled successfully ✅*\nMessages with @mentions (including @all/tag-all) will now be deleted.'
                : '*Antitag Disabled successfully ❌*'
        )
    },
}
