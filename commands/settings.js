// commands/settings.js  —  CYBER X
// ─────────────────────────────────────────────────────────────────────────────
// All presence/bot settings commands.
// OWNER ONLY — checked inside every single command.
// Each command reads/writes state.settings = settingsLib.forUser(phone)
// so every linked session has its own independent settings.
//
// On bot startup these load automatically from data/users/<phone>.json
// so whatever was set before a restart stays active — no re-typing needed.
// ─────────────────────────────────────────────────────────────────────────────

"use strict"

const ON  = new Set(["on",  "true",  "yes", "1", "enable",  "open"])
const OFF = new Set(["off", "false", "no",  "0", "disable", "close"])

function parseBool(val = "") {
  const v = val.trim().toLowerCase()
  if (ON.has(v))  return true
  if (OFF.has(v)) return false
  return null
}

function icon(val) { return val ? "✅ *ON*" : "❌ *OFF*" }

// ── Shared toggle runner ──────────────────────────────────────────────────────
async function toggle(key, label, { sock, msg, args, settings, helper, isOwner }) {
  // OWNER ONLY
  if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")

  const input = (args[0] || "").toLowerCase()

  if (!input) {
    const cur = settings.get(key)
    return helper.reply(sock, msg,
      `${label}\nCurrent: ${icon(cur)}\n\nUsage: .${label.toLowerCase().replace(/\s+/g, "")} on/off`
    )
  }

  const val = parseBool(input)
  if (val === null) return helper.reply(sock, msg, "❌ Use *on* or *off*")

  settings.set(key, val)
  return helper.reply(sock, msg, `${label} → ${icon(val)}`)
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = [

  // ── .autotyping on/off ───────────────────────────────────────────────────
  // Shows "typing..." in the chat the moment anyone messages this session.
  // Pauses automatically after 5 seconds.
  {
    pattern:  "autotyping",
    alias:    ["autotype", "typing"],
    desc:     "Show typing presence when messages arrive",
    usage:    ".autotyping on/off",
    category: 'owner',
    run: (ctx) => toggle("autoTyping", "Auto Typing", ctx),
  },

  // ── .autorecording on/off ────────────────────────────────────────────────
  // Shows "recording audio..." — same as autoTyping but for voice feel.
  // If autoTyping is ON this is skipped (can't show both at once).
  {
    pattern:  "autorecording",
    alias:    ["autorecord", "recording"],
    desc:     "Show recording presence when messages arrive",
    usage:    ".autorecording on/off",
    category: 'owner',
    run: (ctx) => toggle("autoRecording", "Auto Recording", ctx),
  },

  // ── .alwaysonline on/off ─────────────────────────────────────────────────
  // Pushes "available" presence to every chat that messages this session.
  // Makes this session always appear online to anyone who checks.
  {
    pattern:  "alwaysonline",
    alias:    ["online", "setonline"],
    desc:     "Always appear online",
    usage:    ".alwaysonline on/off",
    category: 'owner',
    run: (ctx) => toggle("alwaysOnline", "Always Online", ctx),
  },

  // ── .autoread on/off ─────────────────────────────────────────────────────
  // Marks every incoming message as read (blue ticks) immediately.
  {
    pattern:  "autoread",
    alias:    ["autoread"],
    desc:     "Auto read all incoming messages",
    usage:    ".autoread on/off",
    category: 'owner',
    run: (ctx) => toggle("autoRead", "Auto Read", ctx),
  },

  // ── .autoviewstatus on/off ───────────────────────────────────────────────
  // Auto-views WhatsApp statuses posted by contacts.
  {
    pattern:  "autoviewstatus",
    alias:    ["viewstatus", "autoview"],
    desc:     "Auto view WhatsApp statuses",
    usage:    ".autoviewstatus on/off",
    category: 'owner',
    run: (ctx) => toggle("autoViewStatus", "Auto View Status", ctx),
  },

  // ── .autoreactstatus on/off ──────────────────────────────────────────────
  // Auto-reacts to statuses with the configured emoji.
  {
    pattern:  "autoreactstatus",
    alias:    ["reactstatus", "autoreact"],
    desc:     "Auto react to WhatsApp statuses",
    usage:    ".autoreactstatus on/off",
    category: 'owner',
    run: (ctx) => toggle("autoReactStatus", "Auto React Status", ctx),
  },

  // ── .statusemoji <emoji> ─────────────────────────────────────────────────
  // Sets the emoji used when auto-reacting to statuses.
  {
    pattern:  "statusemoji",
    alias:    ["reactemoji", "setemoji"],
    desc:     "Set emoji for auto status react",
    usage:    ".statusemoji 🔥",
    category: 'owner',
    async run({ sock, msg, text, settings, helper, isOwner }) {
      if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")
      if (!text) return helper.reply(sock, msg,
        `Status react emoji: *${settings.get("statusReactEmoji") || "🔥"}*\n\nUsage: .statusemoji <emoji>`
      )
      settings.set("statusReactEmoji", text.trim())
      return helper.reply(sock, msg, `✅ Status emoji set to: ${text.trim()}`)
    },
  },

  // ── .autoreply on/off ────────────────────────────────────────────────────
  {
    pattern:  "autoreply",
    alias:    ["autorespond"],
    desc:     "Auto reply to non-command messages",
    usage:    ".autoreply on/off",
    category: 'owner',
    run: (ctx) => toggle("autoReply", "Auto Reply", ctx),
  },

  // ── .autoreplytext <message> ─────────────────────────────────────────────
  {
    pattern:  "autoreplytext",
    alias:    ["setreply", "replytext"],
    desc:     "Set the auto reply message",
    usage:    ".autoreplytext Hey! Type .menu for commands.",
    category: 'owner',
    async run({ sock, msg, text, settings, helper, isOwner }) {
      if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")
      if (!text) return helper.reply(sock, msg,
        `Current auto reply:\n\n${settings.get("autoReplyText")}\n\nSend .autoreplytext <message> to change.`
      )
      settings.set("autoReplyText", text)
      return helper.reply(sock, msg, `✅ Auto reply text updated:\n\n${text}`)
    },
  },

  // ── .antilink on/off ─────────────────────────────────────────────────────
  {
    pattern:  "antilink",
    alias:    ["antilnk"],
    desc:     "Delete links posted in groups",
    usage:    ".antilink on/off",
    category: 'owner',
    run: (ctx) => toggle("antiLink", "Anti Link", ctx),
  },

  // ── .antispam on/off ─────────────────────────────────────────────────────
  {
    pattern:  "antispam",
    desc:     "Block spam messages",
    usage:    ".antispam on/off",
    category: 'owner',
    run: (ctx) => toggle("antiSpam", "Anti Spam", ctx),
  },

  // ── .welcome on/off ──────────────────────────────────────────────────────
  {
    pattern:  "welcome",
    alias:    ["setwelcome"],
    desc:     "Welcome new group members",
    usage:    ".welcome on/off",
    category: 'owner',
    run: (ctx) => toggle("welcome", "Welcome", ctx),
  },

  // ── .goodbye on/off ──────────────────────────────────────────────────────
  {
    pattern:  "goodbye",
    alias:    ["bye"],
    desc:     "Goodbye message for leaving members",
    usage:    ".goodbye on/off",
    category: 'owner',
    run: (ctx) => toggle("goodbye", "Goodbye", ctx),
  },

  // ── .mode public/private ─────────────────────────────────────────────────
  {
    pattern:  "mode",
    alias:    ["botmode", "setmode"],
    desc:     "Set bot mode: public or private",
    usage:    ".mode public  OR  .mode private",
    category: 'owner',
    async run({ sock, msg, args, settings, helper, isOwner }) {
      if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")
      const val = (args[0] || "").toLowerCase()
      if (!val) return helper.reply(sock, msg,
        `Current mode: *${settings.get("mode")}*\n\nUsage: .mode public/private`
      )
      if (!["public", "private"].includes(val))
        return helper.reply(sock, msg, "❌ Use *public* or *private*")
      settings.set("mode", val)
      return helper.reply(sock, msg,
        val === "private"
          ? "🔒 Bot is now *PRIVATE* — only owner can use commands."
          : "🌍 Bot is now *PUBLIC* — everyone can use commands."
      )
    },
  },

  // ── .prefix <char> ───────────────────────────────────────────────────────
  {
    pattern:  "prefix",
    alias:    ["setprefix", "changeprefix"],
    desc:     "Change the bot command prefix",
    usage:    ".prefix !",
    category: 'owner',
    async run({ sock, msg, args, settings, helper, isOwner }) {
      if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")
      const val = args[0]
      if (!val) return helper.reply(sock, msg,
        `Current prefix: *${settings.get("prefix")}*\n\nUsage: .prefix <character>`
      )
      if (val.length > 3) return helper.reply(sock, msg, "❌ Prefix must be 1–3 characters.")
      settings.set("prefix", val)
      return helper.reply(sock, msg, `✅ Prefix changed to: *${val}*`)
    },
  },

  // ── .settings — view all ─────────────────────────────────────────────────
  {
    pattern:  "settings",
    alias:    ["botsettings", "config"],
    desc:     "View all current bot settings for this session",
    usage:    ".settings",
    category: 'owner',
    async run({ sock, msg, settings, helper, isOwner }) {
      if (!isOwner) return helper.reply(sock, msg, "❌ This command is *owner only*.")
      const s = settings.getAll()
      return helper.reply(sock, msg, helper.box("⚙️ SESSION SETTINGS", [
        `Prefix:          *${s.prefix}*`,
        `Mode:            *${s.mode}*`,
        `Auto Typing:     ${s.autoTyping      ? "✅" : "❌"}`,
        `Auto Recording:  ${s.autoRecording   ? "✅" : "❌"}`,
        `Always Online:   ${s.alwaysOnline    ? "✅" : "❌"}`,
        `Auto Read:       ${s.autoRead        ? "✅" : "❌"}`,
        `Auto View Status:${s.autoViewStatus  ? "✅" : "❌"}`,
        `Auto React:      ${s.autoReactStatus ? "✅" : "❌"}`,
        `React Emoji:     ${s.statusReactEmoji || "🔥"}`,
        `Auto Reply:      ${s.autoReply       ? "✅" : "❌"}`,
        `Anti Link:       ${s.antiLink        ? "✅" : "❌"}`,
        `Anti Spam:       ${s.antiSpam        ? "✅" : "❌"}`,
        `Welcome:         ${s.welcome         ? "✅" : "❌"}`,
        `Goodbye:         ${s.goodbye         ? "✅" : "❌"}`,
      ]))
    },
  },

]

