// ─────────────────────────────────────────────────────────────────────────────
// commands/settings.js  —  CYBER X  |  Settings Command
//
// RULES (critical — read before editing):
//   • Commands ALWAYS fire INSTANTLY — zero delay, zero auto-typing side effect
//   • Auto-typing/recording only triggers on ordinary NON-command messages
//   • Owner-only: all setting changes
//   • pattern must match what the user types after the prefix
// ─────────────────────────────────────────────────────────────────────────────

const VALID_KEYS = {
  // key             friendly label             type
  autoTyping:      ["Auto Typing",       "bool"],
  autoRecording:   ["Auto Recording",    "bool"],
  autoReply:       ["Auto Reply",        "bool"],
  autoReplyText:   ["Auto Reply Text",   "text"],
  autoViewStatus:  ["Auto View Status",  "bool"],
  autoReactStatus: ["Auto React Status", "bool"],
  statusReactEmoji:["Status React Emoji","text"],
  autoRead:        ["Auto Read",         "bool"],
  antiLink:        ["Anti-Link",         "bool"],
  antiSpam:        ["Anti-Spam",         "bool"],
  welcome:         ["Welcome Message",   "bool"],
  goodbye:         ["Goodbye Message",   "bool"],
  alwaysOnline:    ["Always Online",     "bool"],
  blockNonContact: ["Block Non-Contact", "bool"],
  groupOnly:       ["Group-Only Mode",   "bool"],
  dmOnly:          ["DM-Only Mode",      "bool"],
  mode:            ["Bot Mode",          "mode"],   // public | private
  prefix:          ["Command Prefix",    "text"],
  botName:         ["Bot Name",          "text"],
}

// ── Emoji status helpers ──────────────────────────────────────────────────────
const ON  = "✅"
const OFF = "❌"
const dot = v => (v ? ON : OFF)

function buildMenu(s) {
  const S = s.getAll()

  return `╔══════════════════════════════╗
║   ⚙️  ${S.botName} SETTINGS         
╠══════════════════════════════╣
║ 🌐 MODE : ${S.mode.toUpperCase().padEnd(19)}║
║ 🔑 PREFIX : ${S.prefix.padEnd(17)}║
╠══════════╦═══════════════════╣
║ FEATURE  ║ STATUS            ║
╠══════════╬═══════════════════╣
║ Auto Typing     ║ ${dot(S.autoTyping)} ${S.autoTyping ? "ON " : "OFF"}          ║
║ Auto Recording  ║ ${dot(S.autoRecording)} ${S.autoRecording ? "ON " : "OFF"}          ║
║ Auto Reply      ║ ${dot(S.autoReply)} ${S.autoReply ? "ON " : "OFF"}          ║
║ Auto View Status║ ${dot(S.autoViewStatus)} ${S.autoViewStatus ? "ON " : "OFF"}          ║
║ Auto React Stat.║ ${dot(S.autoReactStatus)} ${S.autoReactStatus ? "ON " : "OFF"}          ║
║ Auto Read       ║ ${dot(S.autoRead)} ${S.autoRead ? "ON " : "OFF"}          ║
║ Anti-Link       ║ ${dot(S.antiLink)} ${S.antiLink ? "ON " : "OFF"}          ║
║ Anti-Spam       ║ ${dot(S.antiSpam)} ${S.antiSpam ? "ON " : "OFF"}          ║
║ Welcome         ║ ${dot(S.welcome)} ${S.welcome ? "ON " : "OFF"}          ║
║ Goodbye         ║ ${dot(S.goodbye)} ${S.goodbye ? "ON " : "OFF"}          ║
║ Always Online   ║ ${dot(S.alwaysOnline)} ${S.alwaysOnline ? "ON " : "OFF"}          ║
║ Block Non-Cont. ║ ${dot(S.blockNonContact)} ${S.blockNonContact ? "ON " : "OFF"}          ║
║ Group-Only      ║ ${dot(S.groupOnly)} ${S.groupOnly ? "ON " : "OFF"}          ║
║ DM-Only         ║ ${dot(S.dmOnly)} ${S.dmOnly ? "ON " : "OFF"}          ║
╠══════════════════════════════╣
║  USAGE (owner only)          ║
║  .settings                   ║
║  .settings on <feature>      ║
║  .settings off <feature>     ║
║  .settings set <key> <val>   ║
║  .settings mode public       ║
║  .settings mode private      ║
║  .settings prefix !          ║
║  .settings reset             ║
╚══════════════════════════════╝`
}

// ── The command ───────────────────────────────────────────────────────────────
module.exports = {
  pattern:  "settings",
  desc:     "View and change all bot settings",
  usage:    ".settings | .settings on autoTyping | .settings mode private",
  category: "owner",

  async run({ sock, from, args, settings: s, isOwner }) {

    // ── Show menu if no args ──────────────────────────────────────────────
    if (!args.length) {
      return sock.sendMessage(from, { text: buildMenu(s) })
    }

    // ── All write operations are owner-only ───────────────────────────────
    if (!isOwner) {
      return sock.sendMessage(from, { text: "❌ Owner only command." })
    }

    const sub  = args[0].toLowerCase()
    const key  = args[1] ? args[1].toLowerCase() : ""
    const val  = args.slice(2).join(" ").trim()

    // ── .settings reset ───────────────────────────────────────────────────
    if (sub === "reset") {
      s.reset()
      return sock.sendMessage(from, { text: "♻️ All settings reset to defaults." })
    }

    // ── .settings mode public|private ────────────────────────────────────
    if (sub === "mode") {
      const m = args[1]?.toLowerCase()
      if (!["public", "private"].includes(m)) {
        return sock.sendMessage(from, { text: "❌ Usage: .settings mode public | private" })
      }
      s.set("mode", m)
      return sock.sendMessage(from, {
        text: `🌐 Bot mode set to *${m.toUpperCase()}*.\n${
          m === "private"
            ? "Only you (owner) can now use commands."
            : "Everyone can use commands."
        }`
      })
    }

    // ── .settings prefix <char> ───────────────────────────────────────────
    if (sub === "prefix") {
      const p = args[1]
      if (!p || p.length > 3) {
        return sock.sendMessage(from, { text: "❌ Usage: .settings prefix !" })
      }
      s.set("prefix", p)
      return sock.sendMessage(from, { text: `🔑 Prefix changed to *${p}*` })
    }

    // ── .settings set <key> <value> ───────────────────────────────────────
    if (sub === "set") {
      // Find the real key (case-insensitive match)
      const realKey = Object.keys(VALID_KEYS).find(k => k.toLowerCase() === key)
      if (!realKey) {
        const keys = Object.keys(VALID_KEYS).join(", ")
        return sock.sendMessage(from, { text: `❌ Unknown key.\n\nValid keys:\n${keys}` })
      }
      const [label, type] = VALID_KEYS[realKey]
      if (type === "bool") {
        return sock.sendMessage(from, {
          text: `❌ "${realKey}" is a toggle. Use:\n.settings on ${realKey}\n.settings off ${realKey}`
        })
      }
      if (!val) {
        return sock.sendMessage(from, { text: `❌ Usage: .settings set ${realKey} <value>` })
      }
      s.set(realKey, val)
      return sock.sendMessage(from, { text: `✅ *${label}* set to: ${val}` })
    }

    // ── .settings on/off <feature> ────────────────────────────────────────
    if (sub === "on" || sub === "off") {
      const target = Object.keys(VALID_KEYS).find(k => k.toLowerCase() === key)
      if (!target) {
        return sock.sendMessage(from, { text: `❌ Unknown feature: ${key}\n\nUse .settings to see all features.` })
      }
      const [label, type] = VALID_KEYS[target]
      if (type !== "bool") {
        return sock.sendMessage(from, {
          text: `❌ "${target}" is not a toggle. Use:\n.settings set ${target} <value>`
        })
      }
      const newVal = sub === "on"
      s.set(target, newVal)

      // Side effects for specific toggles
      if (target === "alwaysOnline") {
        // Will be picked up by the presence loop in index
      }

      return sock.sendMessage(from, {
        text: `${newVal ? ON : OFF} *${label}* turned *${sub.toUpperCase()}*`
      })
    }

    // ── Fallback ──────────────────────────────────────────────────────────
    return sock.sendMessage(from, { text: buildMenu(s) })
  }
}
