'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — HIDETAG COMMAND
//  Usage: .hidetag <message>
//  Silently tags every member in the group
//  Admin only | Category: group/admin
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
    pattern:  'hidetag',
    alias:    ['ht', 'tagall', 'everyone'],
    category: 'group/admin',
    desc:     'Silently tag all group members',
    usage:    '.hidetag <message>',

    run: async ({ sock, from, msg, text, args, isGroup, isAdmin, isOwner }) => {

        // ── Only works in groups ───────────────────────────────
        if (!isGroup) {
            return sock.sendMessage(from, {
                text: '❌ This command only works in groups.',
                quoted: msg
            })
        }

        // ── Admin or owner only ────────────────────────────────
        if (!isAdmin && !isOwner) {
            return sock.sendMessage(from, {
                text: '❌ Only admins can use this command.',
                quoted: msg
            })
        }

        // ── React immediately ──────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '📢', key: msg.key }
        }).catch(() => {})

        try {
            // ── Fetch all group members ────────────────────────
            const meta    = await sock.groupMetadata(from)
            const members = meta.participants.map(p => p.id)

            if (!members.length) {
                return sock.sendMessage(from, {
                    text: '❌ Could not fetch group members.',
                    quoted: msg
                })
            }

            // ── Custom message or single space (blank) ─────────
            const customMsg = (text || args.join(' ')).trim()

            // ── Send — no quoted, no visible tag list ──────────
            // mentions array does the silent tagging invisibly
            await sock.sendMessage(from, {
                text:     customMsg || ' ',
                mentions: members,
            })

        } catch (err) {
            console.error('[HIDETAG]', err.message)
            await sock.sendMessage(from, {
                react: { text: '❌', key: msg.key }
            }).catch(() => {})
            await sock.sendMessage(from, {
                text: `❌ *Failed to tag members.*\n_${err.message}_`,
                quoted: msg
            })
        }
    }
}
