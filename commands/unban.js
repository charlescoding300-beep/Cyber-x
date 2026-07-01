'use strict'

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

async function getRedis() {
  try {
    const backup = require('../lib/sessionBackup')
    if (backup?.redis) return backup.redis
    const { Redis } = require('@upstash/redis')
    return new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  } catch {
    return null
  }
}

function banListKey(sessionPhone) {
  return `banlist:${sessionPhone}`
}

async function loadBanned(sessionPhone) {
  try {
    const redis = await getRedis()
    if (!redis) return {}
    const data = await redis.get(banListKey(sessionPhone))
    return data ? (typeof data === 'string' ? JSON.parse(data) : data) : {}
  } catch {
    return {}
  }
}

async function saveBanned(sessionPhone, data) {
  try {
    const redis = await getRedis()
    if (!redis) return false
    await redis.set(banListKey(sessionPhone), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

module.exports = {
  pattern:  'unban',
  category: 'group/admin',
  desc:     'Unban a user from the bot',
  usage:    '.unban (reply to message) | .unban @user',

  run: async ({ sock, from, msg, sender, args,
                isOwner, isAdmin, isGroup }) => {

    // ── Get session phone ──
    const sessionPhone = sock.user?.id
      ?.replace(/:[^@]+/, '')
      ?.replace('@s.whatsapp.net', '') || 'unknown'

    const sessionJid = `${sessionPhone}@s.whatsapp.net`

    // ── Permission check ──
    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, {
        text: `❌ *Access Denied!*\nOnly admins and owner can unban users.\n\n${CREDIT}`,
        quoted: msg
      })
    }

    if (!isOwner && isAdmin && !isGroup) {
      return sock.sendMessage(from, {
        text: `❌ *Admins can only use .unban inside groups!*\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Get target ──
    const quotedCtx    = msg.message?.extendedTextMessage?.contextInfo
    const quotedJid    = quotedCtx?.participant || quotedCtx?.remoteJid
    const msgMentioned = quotedCtx?.mentionedJid || []

    let targetJid = null

    if (quotedJid) {
      targetJid = quotedJid
    } else if (msgMentioned.length) {
      targetJid = msgMentioned[0]
    } else {
      const numArg = args.find(a => /^\d{7,}/.test(a.replace(/[^0-9]/g, '')))
      if (numArg) {
        const clean = numArg.replace(/[^0-9]/g, '')
        if (clean) targetJid = `${clean}@s.whatsapp.net`
      }
    }

    if (!targetJid) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  ✅ *UNBAN COMMAND*        ║
╚═══════════════════════════╝

*How to use:*
• *Reply to a message + .unban*
• *.unban @user*
• *.unban 234XXXXXXXXXX*

*Who can use:*
• 👑 Owner — anywhere
• 👮 Admins — groups only

${CREDIT}`,
        quoted: msg
      })
    }

    const userPhone       = targetJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '')
    const targetDisplayJid = `${userPhone}@s.whatsapp.net`

    // ── Check if actually banned ──
    const banned = await loadBanned(sessionPhone)

    if (!banned[userPhone]) {
      return sock.sendMessage(from, {
        text: `⚠️ *@${userPhone} is not banned!*\n\n${CREDIT}`,
        mentions: [targetDisplayJid],
        quoted: msg
      })
    }

    // ── Unban ──
    const banInfo = banned[userPhone]
    delete banned[userPhone]
    await saveBanned(sessionPhone, banned)

    // ── React ──
    await sock.sendMessage(from, {
      react: { text: '✅', key: msg.key }
    }).catch(() => {})

    // ── Success message ──
    await sock.sendMessage(from, {
      text:
`╔═══════════════════════════╗
║  ✅ *USER UNBANNED*        ║
╚═══════════════════════════╝

🎉 @${userPhone} you have been unbanned by @${sessionPhone}

📝 *Was banned for:* ${banInfo?.reason || 'No reason'}
📅 *Unbanned on:* ${new Date().toLocaleDateString()}
✅ *Status:* Can use bot again

${CREDIT}`,
      mentions: [
        targetDisplayJid,
        sessionJid,
      ],
      quoted: msg
    })

    // ── Notify unbanned user ──
    try {
      await sock.sendMessage(targetDisplayJid, {
        text:
`✅ *You have been unbanned from CYBER X!*

You can now use all bot commands again.
Welcome back! 🎉

${CREDIT}`
      })
    } catch {}
  }
}
