'use strict'
const fs = require('fs')
const path = require('path')

// ─────────────────────────────────────────────────────────────────────────────
// commands/ban.js  —  CYBER X  |  Per-Session Ban System
//
// USAGE (owner only — checked via index.js's real isOwner, same as every
// other command; NOT a manual sender-string comparison):
//   .ban (reply to a message)  → ban that user on THIS session's bot
//   .ban @user                 → ban by tag
//   .ban 234XXXXXXXXXX          → ban by number
//   .ban unban <number>         → unban
//   .ban list                   → show banned users for THIS session
//
// ── FIX 1: REAL OWNER CHECK ──────────────────────────────────────────────
// The old check compared the raw sender JID against process.env.OWNER_NUMBER
// directly, which almost never matches (JID vs bare digits), and only
// worked by accident via a loose .includes() substring match. It also
// ignored SUDO_NUMBERS and dynamic owners entirely. This now uses the
// `isOwner` flag index.js already computes correctly via checkIsOwner()
// and passes into every command's run() — the same trusted source every
// other command in this bot already relies on.
//
// ── FIX 2: PER-SESSION BAN LIST ──────────────────────────────────────────
// The old ban file was ONE shared file for every session running on this
// server (session/banned_users.json). That meant if Session A's owner
// banned someone, that person was ALSO blocked on Session B, C, D — even
// though those are different bot owners' completely separate bots.
// Bans are now stored per-session, keyed by the banning bot's own phone
// number (sock.user.id), under data/bans/<sessionPhone>.json. A user
// banned on one session can freely use the bot on any other session.
// ─────────────────────────────────────────────────────────────────────────────

const BANS_DIR = path.join(__dirname, '..', 'data', 'bans')
if (!fs.existsSync(BANS_DIR)) fs.mkdirSync(BANS_DIR, { recursive: true })

function getSessionPhone(sock) {
  return (sock.user?.id || '').split('@')[0].split(':')[0]
}

function banFilePath(sessionPhone) {
  return path.join(BANS_DIR, `${sessionPhone}.json`)
}

function loadBanned(sessionPhone) {
  try {
    const file = banFilePath(sessionPhone)
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch (e) {
    console.warn(`[BAN:${sessionPhone}] Load error:`, e.message)
  }
  return {}
}

function saveBanned(sessionPhone, data) {
  try {
    fs.writeFileSync(banFilePath(sessionPhone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[BAN:${sessionPhone}] Save error:`, e.message)
  }
}

/**
 * Checked from index.js's handleMessage() via global.__isBanned(sessionPhone, userPhone).
 * Scoped correctly: only checks THAT session's own ban list.
 */
function isBanned(sessionPhone, userPhone) {
  const banned = loadBanned(sessionPhone)
  return !!banned[userPhone]
}

module.exports = {
  pattern: 'ban',
  alias: [],
  category: 'group/admin',
  desc: 'Ban/unban users from using this bot session (owner only)',
  usage: '.ban (reply) | .ban @user | .ban unban <number> | .ban list',

  run: async ({ sock, from, msg, sender, args, isOwner }) => {

    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ *Owner only command*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    const sessionPhone = getSessionPhone(sock)
    const banned = loadBanned(sessionPhone)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage

    let targetJid = null

    if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
      targetJid = msg.message.extendedTextMessage.contextInfo.participant
    } else if (args[0]?.startsWith('@')) {
      const phoneDigits = args[0].replace('@', '').replace(/[^0-9]/g, '')
      targetJid = `${phoneDigits}@s.whatsapp.net`
    } else if (args[0] && /^\d+$/.test(args[0])) {
      targetJid = `${args[0]}@s.whatsapp.net`
    }

    if (!targetJid && args[0]?.toLowerCase() !== 'unban' && args[0]?.toLowerCase() !== 'list') {
      return sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  🚫 *BAN COMMAND*      ║\n╚════════════════════════╝\n\n⚠️ *Owner Only*\n\n*Usage:*\n• *Reply to message + .ban* — ban that user\n• *.ban @username* — ban by tag\n• *.ban 234XXXXXXXXXX* — ban by number\n\n*Commands:*\n• *.ban unban <number>* — unban user\n• *.ban list* — show banned users on this session\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (args[0]?.toLowerCase() === 'unban') {
      const phone = (args[1] || '').replace(/[^0-9]/g, '')
      if (!phone) {
        return sock.sendMessage(from, { text: `⚠️ Usage: *.ban unban <number>*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`, quoted: msg })
      }
      if (banned[phone]) {
        delete banned[phone]
        saveBanned(sessionPhone, banned)
        return sock.sendMessage(from, {
          text: `✅ *Unbanned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      return sock.sendMessage(from, {
        text: `⚠️ *User not banned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    if (args[0]?.toLowerCase() === 'list') {
      const list = Object.keys(banned)
      if (list.length === 0) {
        return sock.sendMessage(from, {
          text: `📋 *Banned Users (this session):* None\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
          quoted: msg
        })
      }
      const bannedList = list.map((p, i) => `${i + 1}. +${p}`).join('\n')
      return sock.sendMessage(from, {
        text: `📋 *Banned Users on this session (${list.length}):*\n\n${bannedList}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    const phone = targetJid.replace(/[^0-9]/g, '')

    if (banned[phone]) {
      return sock.sendMessage(from, {
        text: `⚠️ *Already banned:* +${phone}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    banned[phone] = {
      phone,
      bannedAt: new Date().toISOString(),
      reason: args.slice(1).join(' ') || 'No reason'
    }

    saveBanned(sessionPhone, banned)

    sock.sendMessage(from, {
      text: `🚫 *Banned:* +${phone}\n*Reason:* ${banned[phone].reason}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
      quoted: msg
    })

    try {
      await sock.sendMessage(`${phone}@s.whatsapp.net`, {
        text: `🚫 *You have been banned from using this bot.*\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
      })
    } catch (_) {}
  },

  isBanned,
  loadBanned,
  saveBanned,
  getSessionPhone,
}
