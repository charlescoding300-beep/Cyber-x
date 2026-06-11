// ════════════════════════════════════════════════════════════════════
//  commands/welcome.js — CYBER X | Welcome Config
// ════════════════════════════════════════════════════════════════════

const { isAdmin }                              = require("../lib/isAdmin")
const { readConfig, writeConfig, DEFAULT_MSG } = require("../lib/welcome")

const VARS = [
  "╔══「 📋 *WELCOME VARIABLES* 」══╗",
  "",
  "  `{tag}`    — mentions the new member",
  "  `{name}`   — their display name",
  "  `{number}` — their phone number",
  "  `{group}`  — group name",
  "  `{count}`  — total members",
  "  `{date}`   — date they joined",
  "  `{time}`   — time they joined",
  "",
  "  *Example:*",
  "  `.welcome set 🎉 Hey {tag}! Welcome to *{group}*. You are member #{count}!`",
  "",
  "╚══「 ⚡ *CYBER X* 」══╝",
].join("\n")

module.exports = {
  pattern:  "welcome",
  desc:     "Configure auto-welcome for new members",
  usage:    ".welcome on/off/set/reset/test/status/vars",
  category: "admin",

  async run({ sock, from, sender, args, text, isOwner, isGroup }) {
    if (!isGroup) return sock.sendMessage(from, { text: "❌ Groups only." })

    const admin = isOwner || await isAdmin(sock, from, sender)
    if (!admin) return sock.sendMessage(from, { text: "❌ Admins only." })

    const sub = (args[0] || "").toLowerCase()
    const cfg = readConfig()
    if (!cfg[from]) cfg[from] = { enabled: false, message: DEFAULT_MSG }

    if (sub === "on") {
      cfg[from].enabled = true
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 ✅ *WELCOME ON* 」══╗",
          "",
          "  Auto-welcome is *enabled* for this group.",
          "  Use `.welcome set <msg>` to customise.",
          "  Use `.welcome vars` to see variables.",
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "off") {
      cfg[from].enabled = false
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 🔕 *WELCOME OFF* 」══╗",
          "",
          "  Auto-welcome is *disabled*.",
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "set") {
      const msg = text.slice(4).trim()
      if (!msg) return sock.sendMessage(from, { text: "❌ Usage: `.welcome set <your message>`" })
      cfg[from].message = msg
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 ✏️ *MESSAGE SAVED* 」══╗",
          "",
          `  _${msg}_`,
          "",
          "  Run `.welcome test` to preview.",
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "reset") {
      cfg[from].message = DEFAULT_MSG
      writeConfig(cfg)
      return sock.sendMessage(from, { text: "✅ Welcome message reset to default." })
    }

    if (sub === "test") {
      const { handleGroupUpdate } = require("../lib/welcome")
      return handleGroupUpdate(sock, { id: from, participants: [sender], action: "add" })
    }

    if (sub === "status") {
      const g = cfg[from]
      return sock.sendMessage(from, {
        text: [
          "╔══「 📊 *WELCOME STATUS* 」══╗",
          "",
          `  *Status  :* ${g?.enabled ? "✅ ON" : "🔕 OFF"}`,
          `  *Message :* _${(g?.message || DEFAULT_MSG).slice(0, 100)}..._`,
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "vars") return sock.sendMessage(from, { text: VARS })

    return sock.sendMessage(from, {
      text: [
        "╔══「 👋 *WELCOME HELP* 」══╗",
        "",
        "  `.welcome on`        — enable",
        "  `.welcome off`       — disable",
        "  `.welcome set <msg>` — custom message",
        "  `.welcome reset`     — restore default",
        "  `.welcome test`      — preview",
        "  `.welcome status`    — current config",
        "  `.welcome vars`      — template variables",
        "",
        "╚══「 ⚡ *CYBER X* 」══╝",
      ].join("\n")
    })
  }
}
