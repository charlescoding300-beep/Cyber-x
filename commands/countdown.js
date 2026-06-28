'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — COUNTDOWN COMMAND
//  Usage: .countdown <time> <message>
//  Example: .countdown 10m Match starting soon!
//  Anyone can use | Category: general
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT =
`*╭══ ✕-CYBER X ⚡*
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

// ── Active countdowns (prevent spam) ──────────────────────────
const active = new Map()

// ── Parse time string → milliseconds ─────────────────────────
// Supports: 10s, 5m, 2h, 1h30m, 90s etc
function parseTime(str) {
    if (!str) return null
    str = str.toLowerCase().trim()

    let total = 0
    const matches = str.matchAll(/(\d+)(h|m|s)/g)
    let found = false

    for (const match of matches) {
        found = true
        const val  = parseInt(match[1])
        const unit = match[2]
        if (unit === 'h') total += val * 3600000
        if (unit === 'm') total += val * 60000
        if (unit === 's') total += val * 1000
    }

    // plain number = seconds
    if (!found && /^\d+$/.test(str)) {
        total = parseInt(str) * 1000
        found = true
    }

    return found && total > 0 ? total : null
}

function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
}

module.exports = {
    pattern:  'countdown',
    alias:    ['timer', 'cd'],
    category: 'general',
    desc:     'Set a group countdown — bot pings everyone when time is up',
    usage:    '.countdown <time> <message>  e.g .countdown 10m Match starting!',

    run: async ({ sock, from, msg, args, text, isGroup }) => {

        // ── React immediately ──────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '⏳', key: msg.key }
        }).catch(() => {})

        // ── No input → help ────────────────────────────────────
        if (!text || !args.length) {
            return sock.sendMessage(from, {
                text:
`╔══════════════════════════════╗
║  ⏳ *CYBER X  COUNTDOWN*     ║
╚══════════════════════════════╝

📌 *Usage:*
  _.countdown <time> <message>_

⏱️ *Time formats:*
  • _30s_ — 30 seconds
  • _5m_ — 5 minutes
  • _1h_ — 1 hour
  • _1h30m_ — 1 hour 30 minutes

🔥 *Examples:*
  _.countdown 10m Match starting soon!_
  _.countdown 1h Giveaway time!_
  _.countdown 30s Get ready everyone!_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── Check if countdown already running in this chat ────
        if (active.has(from)) {
            return sock.sendMessage(from, {
                text:
`⚠️ *A countdown is already running here!*

Wait for it to finish or it will ping everyone automatically.

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── Parse time from first arg ──────────────────────────
        const timeStr  = args[0]
        const ms       = parseTime(timeStr)

        if (!ms) {
            return sock.sendMessage(from, {
                text:
`❌ *Invalid time format!*

Use: _10s_, _5m_, _1h_, _1h30m_

Example: _.countdown 5m Match starting!_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── Max 24 hours ───────────────────────────────────────
        if (ms > 86400000) {
            return sock.sendMessage(from, {
                text: `❌ *Maximum countdown is 24 hours.*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n${CREDIT}`,
                quoted: msg
            })
        }

        // ── Get custom message ─────────────────────────────────
        const customMsg = args.slice(1).join(' ').trim() || '⏰ Time is up!'
        const timeLabel = formatTime(ms)

        // ── Mark as active ─────────────────────────────────────
        active.set(from, true)

        // ── Send countdown started message ─────────────────────
        await sock.sendMessage(from, {
            text:
`╔══════════════════════════════╗
║  ⏳ *CYBER X  COUNTDOWN*     ║
╚══════════════════════════════╝

✅ *Countdown started!*

⏱️ *Time:* ${timeLabel}
📢 *Message:* ${customMsg}

Everyone will be tagged when time is up! 🔔

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
            quoted: msg
        })

        // ── Wait for countdown ─────────────────────────────────
        setTimeout(async () => {
            try {
                active.delete(from)

                // ── Fetch all members if group ─────────────────
                let members  = []
                let mentions = []

                if (isGroup) {
                    try {
                        const meta = await sock.groupMetadata(from)
                        members    = meta.participants.map(p => p.id)
                        mentions   = members
                    } catch (_) {}
                }

                // ── Build mention text ─────────────────────────
                const mentionText = mentions.length
                    ? members.map(jid => `@${jid.split('@')[0]}`).join(' ')
                    : ''

                // ── Send time up message ───────────────────────
                await sock.sendMessage(from, {
                    text:
`╔══════════════════════════════╗
║  🔔 *TIME IS UP!*            ║
╚══════════════════════════════╝

📢 *${customMsg}*

${mentionText}

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                    mentions,
                })

            } catch (err) {
                console.error('[COUNTDOWN]', err.message)
                active.delete(from)
            }
        }, ms)
    }
}
