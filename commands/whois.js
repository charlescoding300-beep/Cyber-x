'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — WHOIS COMMAND
//  Usage: .whois (reply to someone's message)
//  Anyone can use | Category: general
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT = '> 🎨 _Designed by_ *Charles Tech*\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'

module.exports = {
    pattern:  'whois',
    alias:    ['who'],
    category: 'general',
    desc:     'Get full info on a user — reply to their message',
    usage:    '.whois (reply to a message)',

    run: async ({ sock, from, msg, sender, isGroup }) => {

        // ── React immediately ──────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '🕵️', key: msg.key }
        }).catch(() => {})

        // ── Determine target ───────────────────────────────────
        const quoted    = msg.message?.extendedTextMessage?.contextInfo
        let targetJid   = null

        if (quoted?.participant) {
            targetJid = quoted.participant
        } else if (quoted?.remoteJid) {
            targetJid = quoted.remoteJid
        } else {
            targetJid = sender
        }

        // ── Clean JID ──────────────────────────────────────────
        const phone    = targetJid.replace(/[^0-9]/g, '')
        const cleanJid = `${phone}@s.whatsapp.net`
        const tag      = `@${phone}`

        try {
            // ── Profile picture ────────────────────────────────
            let ppUrl = null
            try {
                ppUrl = await sock.profilePictureUrl(cleanJid, 'image')
            } catch (_) {}

            // ── About / status ─────────────────────────────────
            let about = 'No status set'
            try {
                const status = await sock.fetchStatus(cleanJid)
                if (status?.status) about = status.status
            } catch (_) {}

            // ── Business profile ───────────────────────────────
            let isBusiness  = false
            let bizDesc     = null
            let bizCategory = null
            try {
                const biz = await sock.getBusinessProfile(cleanJid)
                if (biz?.description) {
                    isBusiness  = true
                    bizDesc     = biz.description
                    bizCategory = biz.category || null
                }
            } catch (_) {}

            // ── Group role ─────────────────────────────────────
            let roleLabel = '👤 Member'
            if (isGroup) {
                try {
                    const meta        = await sock.groupMetadata(from)
                    const participant = meta.participants.find(p =>
                        p.id.replace(/[^0-9]/g, '') === phone
                    )
                    if (participant?.admin === 'superadmin') roleLabel = '👑 Group Creator'
                    else if (participant?.admin === 'admin') roleLabel = '🛡️ Admin'
                    else roleLabel = '👤 Member'
                } catch (_) {}
            }

            // ── Build caption ──────────────────────────────────
            const caption =
`╔══════════════════════════╗
║  🕵️ ⚡ 𝗪𝗛𝗢 𝗜𝗦 ⚡ 🕵️  ║
╚══════════════════════════╝

👤 *User:* ${tag}
📱 *Number:* +${phone}
🆔 *JID:* ${cleanJid}

━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 *About:*
${about}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ *Role:* ${roleLabel}
💼 *Account Type:* ${isBusiness ? '🏢 Business Account' : '👤 Personal Account'}${bizCategory ? `\n📂 *Business Category:* ${bizCategory}` : ''}${bizDesc ? `\n📝 *Business Bio:* ${bizDesc}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━

${CREDIT}`

            // ── Send with pic or text ──────────────────────────
            if (ppUrl) {
                await sock.sendMessage(from, {
                    image:    { url: ppUrl },
                    caption,
                    mentions: [cleanJid],
                }, { quoted: msg })
            } else {
                await sock.sendMessage(from, {
                    text:     caption,
                    mentions: [cleanJid],
                }, { quoted: msg })
            }

        } catch (err) {
            console.error('[WHOIS]', err.message)
            await sock.sendMessage(from, {
                react: { text: '❌', key: msg.key }
            }).catch(() => {})
            await sock.sendMessage(from, {
                text: `❌ *Failed to fetch user info.*\n_${err.message}_\n\n${CREDIT}`,
            }, { quoted: msg })
        }
    }
}
