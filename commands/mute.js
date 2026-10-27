// ─────────────────────────────────────────────────────────
// commands/mute.js — ZEN X MUTE COMMAND
//
// Usage:
//   .mute           → mute forever
//   .mute 10m       → mute for 10 minutes then auto-unmute
//   .mute 1h        → mute for 1 hour
//   .mute 30s       → mute for 30 seconds
//   .mute 2h30m     → mute for 2 hours 30 minutes
// ─────────────────────────────────────────────────────────

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
const { sendMessageUnstyled } = require('../core/responseTextStyle')

// Active mute timers — shared with unmute.js via lib or module cache
const muteTimers = new Map()   // groupJid → { timeoutId, endsAt, label }

// ── Parse duration string → milliseconds ─────────────────
// Supports: 30s  10m  2h  1h30m  2h15m30s
function parseDuration(str) {
  if (!str) return null
  str = String(str).toLowerCase().trim()

  // Plain integers mean minutes.
  if (/^\d+$/.test(str)) {
    const minutes = Number(str)
    const ms = minutes * 60000
    return Number.isSafeInteger(minutes) && minutes > 0 && Number.isSafeInteger(ms) ? ms : null
  }

  // Accept complete h/m/s expressions only; malformed input must not become a permanent mute.
  if (!/^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(str) || !/\d/.test(str)) return null
  const h = Number(str.match(/(\d+)h/)?.[1] || 0)
  const m = Number(str.match(/(\d+)m/)?.[1] || 0)
  const sec = Number(str.match(/(\d+)s/)?.[1] || 0)
  const ms = h * 3600000 + m * 60000 + sec * 1000
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null
}

// ── Human-readable duration ───────────────────────────────
function fmtDuration(ms) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (s) parts.push(`${s}s`)
  return parts.join(" ") || "0s"
}

function durationWords(ms) {
  let seconds = Math.max(1, Math.floor(ms / 1000))
  const parts = []
  for (const [unit, size] of [["HOUR", 3600], ["MINUTE", 60], ["SECOND", 1]]) {
    const amount = Math.floor(seconds / size)
    if (amount) {
      parts.push(amount + " " + unit + (amount === 1 ? "" : "S"))
      seconds %= size
    }
  }
  return parts.join(" ")
}

function styledDuration(value) {
  return Array.from(value, char => {
    if (char >= "A" && char <= "Z") return String.fromCodePoint(0x1D670 + char.charCodeAt(0) - 65)
    if (char >= "0" && char <= "9") return String.fromCodePoint(0x1D7F6 + char.charCodeAt(0) - 48)
    return char
  }).join("")
}

module.exports = {
  pattern:  "mute",
  aliases:  ["lock"],
  desc:     "Mute the group — only admins can send messages",
  usage:    ".mute | .mute 10m | .mute 1h | .mute 2h30m",
  category: 'group',

  // expose timers so unmute.js can cancel them
  muteTimers,

  async run({ sock, from, msg, sender, args, lib, isAdmin, isBotAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `> ❌ *Mute only works in groups.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Independent admin re-check ─────────────────────────
    // Don't only trust the isAdmin flag passed in from index.js — fetch
    // fresh group metadata here and verify the sender is actually listed
    // as admin/superadmin. This protects against a stale or incorrect
    // upstream isAdmin flag (e.g. cached groupCache, JID mismatch).
    let adminContext
    try {
      adminContext = await adminLib.getGroupAdminContext(
        sock, from, sender,
        msg.key?.participantPn || msg.key?.participantAlt || msg.participantPn || msg.participantAlt,
      )
    } catch (e) {
      console.error('[MUTE] group role check failed:', e.message)
    }
    if (!adminContext?.available) {
      return sock.sendMessage(from, {
        text: `> ⚠️ *I could not verify current group permissions. Please try again.*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }
    const verifiedAdmin = isOwner || adminContext.senderAdmin

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: `> ❌ *Only group admins can use this command.*\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    if (!adminContext.botAdmin) {
      return sendBotNotAdmin(sock, from, msg)
    }

    const durationStr = args[0] || null
    const duration    = durationStr ? parseDuration(durationStr) : null

    if (durationStr && !duration) {
      return sock.sendMessage(from, {
        text: "> ❌ *Invalid duration.* Use .mute 10m, .mute 1h, or .mute 2h30m.\n>\n" + CREDIT,
        quoted: msg,
      })
    }

    // ── Mute the group ────────────────────────────────────
    try {
      await sock.groupSettingUpdate(from, "announcement")
    } catch (e) {
      return sock.sendMessage(from, {
        text: `> ❌ *Failed to mute:* ${e.message}\n>\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Clear any existing timer for this group ───────────
    if (muteTimers.has(from)) {
      clearTimeout(muteTimers.get(from).timeoutId)
      muteTimers.delete(from)
    }

    // ── No duration — mute forever ────────────────────────
    if (!duration) {
      return sendMessageUnstyled(sock, from, {
        text: '*🔇 𝙶𝚁𝙾𝚄𝙿 𝙼𝚄𝚃𝙴𝙳 𝙵𝙾𝚁 (𝙵𝙾𝚁𝙴𝚅𝙴𝚁.)*\n*— 𝙾𝙽𝙻𝚈 𝙰𝙳𝙼𝙸𝙽𝚂 𝙲𝙰𝙽 𝚂𝙴𝙽𝙳 𝙼𝙴𝚂𝚂𝙰𝙶𝙴𝚂.*',
      }, { quoted: msg })
    }

    // ── Timed mute — auto-unmute when timer expires ───────
    const label  = fmtDuration(duration)
    const endsAt = Date.now() + duration

    const timeoutId = setTimeout(async () => {
      muteTimers.delete(from)
      try {
        await sock.groupSettingUpdate(from, "not_announcement")
      } catch (e) {
        console.error(`[MUTE] auto-unmute failed for ${from}:`, e.message)
        try {
          await sock.sendMessage(from, {
            text: `╭───「 GROUP MUTE EXPIRED 」───╮
│ ⚠️ The mute timer expired, but I couldn't reopen the group.
│ 👮 Please check that I am still a group admin.
╰──────────────────────────────╯

${CREDIT}`
          }, { quoted: msg })
        } catch {}
        return
      }

      try {
        await sock.sendMessage(from, {
          text: `╭───「 GROUP MUTE EXPIRED 」───╮
│ ⏱️ The mute timer has expired.
│ 🔓 Members can send messages again.
╰──────────────────────────────╯

${CREDIT}`
        }, { quoted: msg })
      } catch (e) {
        console.error(`[MUTE] expiry notice failed for ${from}:`, e.message)
      }
    }, duration)

    muteTimers.set(from, { timeoutId, endsAt, label })

    const longLabel = styledDuration(durationWords(duration))
    return sendMessageUnstyled(sock, from, {
      text: '*🔇 𝙶𝚁𝙾𝚄𝙿 𝙼𝚄𝚃𝙴𝙳 𝙵𝙾𝚁 (' + longLabel + '.)*\n*— 𝙾𝙽𝙻𝚈 𝙰𝙳𝙼𝙸𝙽𝚂 𝙲𝙰𝙽 𝚂𝙴𝙽𝙳 𝙼𝙴𝚂𝚂𝙰𝙶𝙴𝚂.*',
    }, { quoted: msg })
  }
}
