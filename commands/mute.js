// ─────────────────────────────────────────────────────────
// commands/mute.js — CYBER X MUTE COMMAND
//
// Usage:
//   .mute           → mute forever
//   .mute 10m       → mute for 10 minutes then auto-unmute
//   .mute 1h        → mute for 1 hour
//   .mute 30s       → mute for 30 seconds
//   .mute 2h30m     → mute for 2 hours 30 minutes
// ─────────────────────────────────────────────────────────

// Active mute timers — shared with unmute.js via lib or module cache
const muteTimers = new Map()   // groupJid → { timeoutId, endsAt, label }

// ── Parse duration string → milliseconds ─────────────────
// Supports: 30s  10m  2h  1h30m  2h15m30s
function parseDuration(str) {
  if (!str) return null
  str = str.toLowerCase().trim()

  let ms = 0
  const pattern = /(\d+)(h|m|s)/g
  let match
  while ((match = pattern.exec(str)) !== null) {
    const n    = parseInt(match[1])
    const unit = match[2]
    if (unit === "h") ms += n * 3600000
    if (unit === "m") ms += n * 60000
    if (unit === "s") ms += n * 1000
  }

  // fallback: plain number → treat as minutes
  if (ms === 0 && /^\d+$/.test(str)) ms = parseInt(str) * 60000

  return ms > 0 ? ms : null
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

module.exports = {
  pattern:  "mute",
  desc:     "Mute the group — only admins can send messages",
  usage:    ".mute | .mute 10m | .mute 1h | .mute 2h30m",
  category: "group",

  // expose timers so unmute.js can cancel them
  muteTimers,

  async run({ sock, from, msg, sender, args, lib, isAdmin, isBotAdmin, isOwner, isGroup }) {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ *Mute only works in groups.*",
        quoted: msg
      })
    }

    // ── Independent admin re-check ─────────────────────────
    // Don't only trust the isAdmin flag passed in from index.js — fetch
    // fresh group metadata here and verify the sender is actually listed
    // as admin/superadmin. This protects against a stale or incorrect
    // upstream isAdmin flag (e.g. cached groupCache, JID mismatch).
    let verifiedAdmin = isOwner
    if (!verifiedAdmin) {
      try {
        const meta = await sock.groupMetadata(from)
        const senderNum = (sender || "").split("@")[0].split(":")[0]
        verifiedAdmin = meta.participants.some(p => {
          const pNum = (p.id || "").split("@")[0].split(":")[0]
          return pNum === senderNum && (p.admin === "admin" || p.admin === "superadmin")
        })
      } catch (e) {
        // Can't verify → fail closed, do NOT allow the mute.
        verifiedAdmin = false
      }
    }

    if (!verifiedAdmin) {
      return sock.sendMessage(from, {
        text: "❌ *Only group admins can use this command.*",
        quoted: msg
      })
    }

    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: "❌ *I need to be an admin to mute the group.*",
        quoted: msg
      })
    }

    const durationStr = args[0] || null
    const duration    = durationStr ? parseDuration(durationStr) : null

    // ── Mute the group ────────────────────────────────────
    try {
      await sock.groupSettingUpdate(from, "announcement")
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to mute:* ${e.message}`,
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
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔇 *GROUP MUTED*  ║
╚════════════════════╝

┌─────〔 🔒 *LOCKED* 〕─────
│ 🔇 Only *admins* can send messages
│ ⏱️ Duration: *Forever*
│
│ 💡 Use *.unmute* to unlock
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    // ── Timed mute — auto-unmute when timer expires ───────
    const label  = fmtDuration(duration)
    const endsAt = Date.now() + duration

    const timeoutId = setTimeout(async () => {
      muteTimers.delete(from)
      try {
        await sock.groupSettingUpdate(from, "not_announcement")
        await sock.sendMessage(from, {
          text:
`╔════════════════════╗
║  🔊 *AUTO UNMUTED* ║
╚════════════════════╝

┌─────〔 ⏱️ *TIMER DONE* 〕─────
│ ✅ Mute timer expired
│ 🔊 Group is now *open*
│ 💬 Everyone can send messages
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
        })
      } catch {}
    }, duration)

    muteTimers.set(from, { timeoutId, endsAt, label })

    return sock.sendMessage(from, {
      text:
`╔════════════════════╗
║  🔇 *GROUP MUTED*  ║
╚════════════════════╝

┌─────〔 ⏱️ *TIMED MUTE* 〕─────
│ 🔇 Only *admins* can send messages
│ ⏱️ Duration: *${label}*
│ 🔓 Auto-unmute in *${label}*
│
│ 💡 Use *.unmute* to unlock early
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
      quoted: msg
    })
  }
}
