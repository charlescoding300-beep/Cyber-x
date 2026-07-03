'use strict'

module.exports = {
    pattern: 'antibot',
    alias: ['anti-bot'],
    category: 'group',
    desc: 'Detect and act on foreign WhatsApp bots in the group (all roles, CYBER X exempt)',
    usage: '.antibot kick|delete|warn|off|status',

    run: async ({ sock, from, msg, args, isGroup, isAdmin, isOwner, isBotAdmin, lib }) => {

        if (!isGroup) {
            return sock.sendMessage(from, {
                text: `❌ *Groups only*\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        if (!isAdmin && !isOwner) {
            return sock.sendMessage(from, {
                text: `❌ *Only group admins can use this command*\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        const antibotLib = lib.antibot
        if (!antibotLib || typeof antibotLib.getMode !== 'function') {
            return sock.sendMessage(from, {
                text: `❌ *Antibot engine not loaded* — check lib/antibot.js\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } }).catch(() => {})

        const action = (args[0] || '').toLowerCase()
        const currentMode = antibotLib.getMode(from)

        if (['kick', 'delete', 'warn'].includes(action)) {
            if (!isBotAdmin) {
                return sock.sendMessage(from, {
                    text: `⚠️ *Cannot enable Anti-Bot*\n\nI need admin permissions to delete messages and remove bots.\nPlease make me an admin first!\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                    quoted: msg
                })
            }
            antibotLib.setMode(from, action)
            const labels = { kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
            return sock.sendMessage(from, {
                text: `✅ *Anti-bot mode set to:* ${labels[action]}\n\n_Acts on ALL roles — member, admin, super admin, owner. Only CYBER X sessions are exempt._\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        if (action === 'off') {
            antibotLib.setMode(from, 'off')
            return sock.sendMessage(from, {
                text: `🤖 *Anti-bot protection disabled for this group*\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        if (action === 'status') {
            const labels = { off: '❌ Disabled', kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
            return sock.sendMessage(from, {
                text: `🤖 *Anti-bot Status*\n\nMode: ${labels[currentMode] || currentMode}\nBot Admin: ${isBotAdmin ? '✅ Yes' : '❌ No'}\n\n${!isBotAdmin ? '⚠️ Bot needs admin permissions to act!\n\n' : ''}> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        const labels = { off: '❌ Disabled', kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
        return sock.sendMessage(from, {
            text: `🛡️ *Anti-Bot Commands*\n\n*.antibot kick* — instantly kick + announce\n*.antibot delete* — delete bot messages only\n*.antibot warn* — warn, auto-kick at 3 warnings\n*.antibot off* — disable protection\n*.antibot status* — check current mode\n\n*Current Mode:* ${labels[currentMode] || currentMode}\n\n_Acts on ALL roles regardless of admin status — only CYBER X sessions are exempt._\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
            quoted: msg
        })
    },
}
