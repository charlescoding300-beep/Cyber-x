'use strict'
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data', 'antibot')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const MAX_WARNINGS = 3
// ── Throttle: only send the not-admin alert once per group per 10 minutes,
// so it doesn't spam the group every time a bot posts ──
const notAdminNotifyCache = new Map()
const NOTAdMIN_COOLDOWN_MS = 10 * 60 * 1000

function hasNotifiedNotAdmin(groupId) {
    const last = notAdminNotifyCache.get(groupId)
    return last && (Date.now() - last) < NOTAdMIN_COOLDOWN_MS
}

function markNotifiedNotAdmin(groupId) {
    notAdminNotifyCache.set(groupId, Date.now())
}


function configFile(groupId) {
    return path.join(DATA_DIR, `${groupId.replace(/[^a-z0-9]/gi, '_')}.json`)
}

// ── Persistent: reads straight from disk every time, survives restarts ──
function loadConfig(groupId) {
    try {
        const f = configFile(groupId)
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
    } catch (e) {
        console.error('[ANTIBOT] load error:', e.message)
    }
    return { mode: 'off', warnings: {} }
}

function saveConfig(groupId, data) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true })
        fs.writeFileSync(configFile(groupId), JSON.stringify(data, null, 2))
    } catch (e) {
        console.error('[ANTIBOT] save error:', e.message)
    }
}

const BAILEYS_ID_PATTERNS = [
    /^3EB[0-9A-F]+/i,
    /^BAE[0-9A-F]+/i,
    /^3A[0-9A-F]+/i,
]

function isBaileysMessageId(messageId) {
    if (!messageId) return false
    return BAILEYS_ID_PATTERNS.some(p => p.test(messageId))
}

// ── Lists every group config currently saved to disk — used by index.js
// on startup to log which groups already have antibot configured ──
function listAllConfigs() {
    try {
        if (!fs.existsSync(DATA_DIR)) return []
        return fs.readdirSync(DATA_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'))
                return { file: f, mode: data.mode || 'off' }
            })
    } catch (e) {
        console.error('[ANTIBOT] listAllConfigs error:', e.message)
        return []
    }
}

module.exports = {
    pattern: 'antibot',
    alias: ['anti-bot'],
    category: 'group',
    desc: 'Detect and act on foreign WhatsApp bots in the group (all roles, CYBER X exempt)',
    usage: '.antibot kick|delete|warn|off|status',

    run: async ({ sock, from, msg, args, isGroup, isAdmin, isOwner, isBotAdmin }) => {

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

        sock.sendMessage(from, { react: { text: '🛡️', key: msg.key } }).catch(() => {})

        const action = (args[0] || '').toLowerCase()
        const config = loadConfig(from)

        if (['kick', 'delete', 'warn'].includes(action)) {
            if (!isBotAdmin) {
                return sock.sendMessage(from, {
                    text: `⚠️ *Cannot enable Anti-Bot*\n\nI need admin permissions to delete messages and remove bots.\nPlease make me an admin first!\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                    quoted: msg
                })
            }
            config.mode = action
            saveConfig(from, config)
            const labels = { kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
            return sock.sendMessage(from, {
                text: `✅ *Anti-bot mode set to:* ${labels[action]}\n\n_Acts on ALL roles — member, admin, super admin, owner. Only CYBER X sessions are exempt._\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        if (action === 'off') {
            config.mode = 'off'
            saveConfig(from, config)
            return sock.sendMessage(from, {
                text: `🤖 *Anti-bot protection disabled for this group*\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        if (action === 'status') {
            const labels = { off: '❌ Disabled', kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
            return sock.sendMessage(from, {
                text: `🤖 *Anti-bot Status*\n\nMode: ${labels[config.mode] || config.mode}\nBot Admin: ${isBotAdmin ? '✅ Yes' : '❌ No'}\n\n${!isBotAdmin ? '⚠️ Bot needs admin permissions to act!\n\n' : ''}> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
                quoted: msg
            })
        }

        const labels = { off: '❌ Disabled', kick: '🥾 Kick', delete: '🧹 Delete-only', warn: '⚠️ Warn (3 strikes)' }
        return sock.sendMessage(from, {
            text: `🛡️ *Anti-Bot Commands*\n\n*.antibot kick* — instantly kick + announce\n*.antibot delete* — delete bot messages only\n*.antibot warn* — warn, auto-kick at 3 warnings\n*.antibot off* — disable protection\n*.antibot status* — check current mode\n\n*Current Mode:* ${labels[config.mode] || config.mode}\n\n_Acts on ALL roles regardless of admin status — only CYBER X sessions are exempt._\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
            quoted: msg
        })
    },

    loadConfig,
    saveConfig,
    listAllConfigs,
    isBaileysMessageId,
    hasNotifiedNotAdmin,
    markNotifiedNotAdmin,
    MAX_WARNINGS,
}
