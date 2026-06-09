// ════════════════════════════════════════════════════════════
//  commands/mute.js  —  CYBER X  |  Group Mute Command
//  Usage : .mute            → mute instantly (forever)
//          .mute 30s        → mute for 30 seconds
//          .mute 10m        → mute for 10 minutes
//          .mute 2h         → mute for 2 hours
//          .mute 3d         → mute for 3 days
//          .mute 1mo        → mute for 1 month
//          .mute 1y         → mute for 1 year
//  Requires: bot + caller must both be group admins
// ════════════════════════════════════════════════════════════

// ── Shared timer registry (survives hot-reloads via global) ──
if (!global.muteTimers) global.muteTimers = new Map()
const muteTimers = global.muteTimers

// ── Time-unit parser ────────────────────────────────────────
// Accepts:  30s  5m  2h  3d  1mo  1y
// Returns:  { ms: Number, label: String } or null on bad input

const UNITS = {
  s:  { ms: 1_000,               label: "second"  },
  m:  { ms: 60_000,              label: "minute"  },
  h:  { ms: 3_600_000,           label: "hour"    },
  d:  { ms: 86_400_000,          label: "day"     },
  mo: { ms: 2_592_000_000,       label: "month"   },
  y:  { ms: 31_536_000_000,      label: "year"    },
}

function parseDuration(raw) {
  if (!raw) return null
  // match optional integer + optional decimal, then unit (mo before m!)
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(mo|s|m|h|d|y)$/i)
  if (!match) return null

  const value = parseFloat(match[1])
  const unit  = match[2].toLowerCase()

  if (!UNITS[unit] || value <= 0 || !isFinite(value)) return null

  const ms    = Math.round(value * UNITS[unit].ms)
  const label = `${value % 1 === 0 ? value : value} ${UNITS[unit].label}${value !== 1 ? "s" : ""}`

  return { ms, label }
}

// ── Human-readable countdown builder ────────────────────────
function humanMs(ms) {
  const s  = Math.floor(ms / 1_000)
  const m  = Math.floor(s  / 60)
  const h  = Math.floor(m  / 60)
  const d  = Math.floor(h  / 24)
  const mo = Math.floor(d  / 30)
  const y  = Math.floor(d  / 365)

  if (y  >= 1)  return `${y} year${y  > 1 ? "s" : ""}`
  if (mo >= 1)  return `${mo} month${mo > 1 ? "s" : ""}`
  if (d  >= 1)  return `${d} day${d  > 1 ? "s" : ""}`
  if (h  >= 1)  return `${h} hour${h  > 1 ? "s" : ""}`
  if (m  >= 1)  return `${m} minute${m > 1 ? "s" : ""}`
  return `${s} second${s  > 1 ? "s" : ""}`
}

// ── Unlock time formatter ────────────────────────────────────
function unlockAt(ms) {
  const d = new Date(Date.now() + ms)
  return d.toLocaleString("en-US", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    hour:    "2-digit",
    minute:  "2-digit",
    hour12:  true,
  })
}

// ════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ════════════════════════════════════════════════════════════
module.exports = {
  pattern: "mute",
  desc:    "Mute the group (instantly or for a set duration). Only admins.",
  usage:   ".mute | .mute 30s | .mute 10m | .mute 2h | .mute 3d | .mute 1mo | .mute 1y",

  run: async ({ sock, from, msg, sender, args, text, isAdmin, isBotAdmin, isGroup, settings }) => {

    // ── Guard: group only ──────────────────────────────────
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  ⚠️  GROUP ONLY          ║\n` +
              `╚══════════════════════════╝\n` +
              `_.mute_ can only be used inside a group.`,
      }, { quoted: msg })
    }

    // ── Guard: caller must be admin ────────────────────────
    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🚫  ADMINS ONLY         ║\n` +
              `╚══════════════════════════╝\n` +
              `Only group admins can mute the group.`,
      }, { quoted: msg })
    }

    // ── Guard: bot must be admin ───────────────────────────
    if (!isBotAdmin) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🤖  BOT NOT ADMIN       ║\n` +
              `╚══════════════════════════╝\n` +
              `Please make *${settings.botName}* a group admin first.`,
      }, { quoted: msg })
    }

    // ── Already muted? Check existing timer ───────────────
    const existingTimer = muteTimers.get(from)
    if (existingTimer) {
      // Cancel old timer — we'll restart with new duration
      clearTimeout(existingTimer.handle)
      muteTimers.delete(from)
    }

    // ── Parse optional duration ────────────────────────────
    const raw      = (args[0] || "").trim()
    const duration = raw ? parseDuration(raw) : null

    if (raw && !duration) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  ❌  INVALID DURATION    ║\n` +
              `╚══════════════════════════╝\n\n` +
              `*Valid formats:*\n` +
              `• \`30s\`  → seconds\n` +
              `• \`10m\`  → minutes\n` +
              `• \`2h\`   → hours\n` +
              `• \`3d\`   → days\n` +
              `• \`1mo\`  → months\n` +
              `• \`1y\`   → years\n\n` +
              `*Example:* .mute 2h`,
      }, { quoted: msg })
    }

    // ── Lock the group (announcement mode) ────────────────
    try {
      await sock.groupSettingUpdate(from, "announcement")
    } catch (err) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  ❌  FAILED TO MUTE      ║\n` +
              `╚══════════════════════════╝\n` +
              `Error: ${err.message}`,
      }, { quoted: msg })
    }

    // ── Build confirmation message ─────────────────────────
    if (!duration) {
      // ── Instant / permanent mute ──
      await sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🔇  GROUP MUTED         ║\n` +
              `╚══════════════════════════╝\n\n` +
              `*Status:* 🔴 Muted\n` +
              `*Duration:* Until unmuted\n` +
              `*By:* @${sender.split("@")[0]}\n\n` +
              `Only admins can send messages.\n` +
              `Use *.unmute* to lift the mute.`,
        mentions: [sender],
      }, { quoted: msg })

    } else {
      // ── Timed mute — set auto-unmute ──
      const handle = setTimeout(async () => {
        muteTimers.delete(from)
        try {
          await sock.groupSettingUpdate(from, "not_announcement")
          await sock.sendMessage(from, {
            text: `╔══════════════════════════╗\n` +
                  `║  🔊  AUTO-UNMUTED        ║\n` +
                  `╚══════════════════════════╝\n\n` +
                  `*Status:* 🟢 Open\n` +
                  `*Reason:* Mute timer expired (${humanMs(duration.ms)})\n\n` +
                  `Everyone can send messages again.`,
          })
        } catch {
          // group may have been deleted or bot removed — silently ignore
        }
      }, duration.ms)

      muteTimers.set(from, { handle, endsAt: Date.now() + duration.ms, label: duration.label })

      await sock.sendMessage(from, {
        text: `╔══════════════════════════╗\n` +
              `║  🔇  GROUP MUTED         ║\n` +
              `╚══════════════════════════╝\n\n` +
              `*Status:*    🔴 Muted\n` +
              `*Duration:*  ${duration.label}\n` +
              `*Unlocks:*   ${unlockAt(duration.ms)}\n` +
              `*By:*        @${sender.split("@")[0]}\n\n` +
              `Only admins can send messages.\n` +
              `⏱️ Group will *automatically open* after ${duration.label}.\n` +
              `To lift early, use *.unmute*`,
        mentions: [sender],
      }, { quoted: msg })
    }
  },
}
