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
  } catch (e) {
    console.error(`[BAN] Load error for ${sessionPhone}:`, e.message)
    return {}
  }
}

async function saveBanned(sessionPhone, data) {
  try {
    const redis = await getRedis()
    if (!redis) return false
    await redis.set(banListKey(sessionPhone), JSON.stringify(data))
    console.log(`[BAN:${sessionPhone}] 💾 Saved ${Object.keys(data).length} banned user(s) to Redis`)
    return true
  } catch (e) {
    console.error(`[BAN] Save error for ${sessionPhone}:`, e.message)
    return false
  }
}

async function isBanned(sessionPhone, userPhone) {
  try {
    const banned = await loadBanned(sessionPhone)
    return !!banned[userPhone]
  } catch {
    return false
  }
}

async function banUser(sessionPhone, userPhone, reason = 'No reason') {
  const banned = await loadBanned(sessionPhone)
  banned[userPhone] = {
    phone:    userPhone,
    bannedAt: new Date().toISOString(),
    reason,
    bannedBy: sessionPhone,
  }
  await saveBanned(sessionPhone, banned)
  return banned[userPhone]
}

async function getBanInfo(sessionPhone, userPhone) {
  const banned = await loadBanned(sessionPhone)
  return banned[userPhone] || null
}

// ── Export globally so index.js can check bans ──
global.__isBanned  = isBanned
global.__loadBanned = loadBanned
global.__banUser   = banUser

module.exports = {
  pattern:  'ban',
  category: 'owner',
  desc:     'Ban a user from using the bot — works in DM and groups',
  usage:    '.ban (reply to message)',

  run: async ({ sock, from, msg, sender, args, text,
                isOwner, isAdmin, isGroup, fromMe }) => {

    // ── Get session phone ──
    const sessionPhone = sock.user?.id
      ?.replace(/:[^@]+/, '')
      ?.replace('@s.whatsapp.net', '') || 'unknown'

    const sessionJid = `${sessionPhone}@s.whatsapp.net`

    // ── Permission check ──
    // Owner — can use anywhere (DM + groups)
    // Admin — can only use in groups
    // Others — blocked

    if (!isOwner && !isAdmin) {
      return sock.sendMessage(from, {
        text: `❌ *Access Denied!*\nOnly admins and owner can use this command.\n\n${CREDIT}`,
        quoted: msg
      })
    }

    if (!isOwner && isAdmin && !isGroup) {
      return sock.sendMessage(from, {
        text: `❌ *Admins can only use .ban inside groups!*\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Get target from reply ──
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
║  🚫 *BAN COMMAND*         ║
╚═══════════════════════════╝

*How to use:*
• *Reply to a message + .ban*
• *.ban @user*
• *.ban @user reason*

*Who can use:*
• 👑 Owner — anywhere (DM + groups)
• 👮 Admins — groups only

*Ban works globally:*
• DMs ✅
• Groups ✅
• Everywhere ✅

${CREDIT}`,
        quoted: msg
      })
    }

    const userPhone = targetJid
      .replace('@s.whatsapp.net', '')
      .replace(/[^0-9]/g, '')

    const targetDisplayJid = `${userPhone}@s.whatsapp.net`
    const senderPhone      = sender
      .replace('@s.whatsapp.net', '')
      .replace(/[^0-9]/g, '')

    // ── Protect owner from being banned by admins ──
    const OWNER_NUMBERS = (process.env.OWNER_NUMBER || '')
      .split(',').map(n => n.replace(/\D/g, '').trim()).filter(Boolean)

    const targetIsOwner = OWNER_NUMBERS.includes(userPhone) ||
                          userPhone === sessionPhone

    if (targetIsOwner && !isOwner) {
      return sock.sendMessage(from, {
        text: `😂 @${senderPhone} You can't ban @${sessionPhone}`,
        mentions: [
          `${senderPhone}@s.whatsapp.net`,
          sessionJid,
        ],
        quoted: msg
      })
    }

    // ── Can't ban yourself ──
    if (userPhone === senderPhone) {
      return sock.sendMessage(from, {
        text: `😂 @${senderPhone} You can't ban yourself!\n\n${CREDIT}`,
        mentions: [`${senderPhone}@s.whatsapp.net`],
        quoted: msg
      })
    }

    // ── Check already banned ──
    const existingBan = await getBanInfo(sessionPhone, userPhone)
    if (existingBan) {
      return sock.sendMessage(from, {
        text:
`⚠️ *Already banned:* @${userPhone}
📅 *Since:* ${existingBan.bannedAt?.slice(0, 10) || 'Unknown'}
📝 *Reason:* ${existingBan.reason}

${CREDIT}`,
        mentions: [targetDisplayJid],
        quoted: msg
      })
    }

    // ── Get reason ──
    const reason = args
      .filter(a => !a.startsWith('@') && !/^\d{7,}$/.test(a))
      .join(' ')
      .trim() || 'No reason provided'

    // ── React ──
    await sock.sendMessage(from, {
      react: { text: '🚫', key: msg.key }
    }).catch(() => {})

    // ── Ban the user ──
    await banUser(sessionPhone, userPhone, reason)

    // ── Success message with tags ──
    await sock.sendMessage(from, {
      text:
`╔═══════════════════════════╗
║  🚫 *USER BANNED*         ║
╚═══════════════════════════╝

✅ @${userPhone} you have successfully been banned by @${sessionPhone}

📝 *Reason:* ${reason}
📅 *Date:* ${new Date().toLocaleDateString()}
🌐 *Scope:* Global — DMs + Groups
💾 *Saved:* Redis (survives restarts)

━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ This user can no longer use
any command on this bot session.

${CREDIT}`,
      mentions: [
        targetDisplayJid,
        sessionJid,
      ],
      quoted: msg
    })

    // ── Notify banned user ──
    try {
      await sock.sendMessage(targetDisplayJid, {
        text:
`🚫 *You have been banned from CYBER X!*

*Reason:* ${reason}
*Banned by:* @${sessionPhone}
*Date:* ${new Date().toLocaleDateString()}

You can no longer use any command on this bot.

${CREDIT}`,
        mentions: [sessionJid]
      })
    } catch {}

  }
