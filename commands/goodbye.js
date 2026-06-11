// ════════════════════════════════════════════════════════════════════
//  commands/goodbye.js — CYBER X | Goodbye Config
// ════════════════════════════════════════════════════════════════════

const { isAdmin }                              = require("../lib/isAdmin")
const { readConfig, writeConfig, DEFAULT_MSG } = require("../lib/goodbye")

const VARS = [
  "╔══「 📋 *GOODBYE VARIABLES* 」══╗",
  "",
  "  `{tag}`    — mentions the member",
  "  `{name}`   — their display name",
  "  `{number}` — their phone number",
  "  `{group}`  — group name",
  "  `{count}`  — remaining members",
  "  `{date}`   — date they left",
  "  `{time}`   — time they left",
  "",
  "  *Example:*",
  "  `.goodbye set 💔 {name} left *{group}*. {count} members remain.`",
  "",
  "╚══「 ⚡ *CYBER X* 」══╝",
].join("\n")

module.exports = {
  pattern:  "goodbye",
  desc:     "Configure auto-goodbye when members leave",
  usage:    ".goodbye on/off/set/reset/test/status/vars",
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
          "╔══「 ✅ *GOODBYE ON* 」══╗",
          "",
          "  Auto-goodbye is *enabled* for this group.",
          "  Use `.goodbye set <msg>` to customise.",
          "  Use `.goodbye vars` to see variables.",
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
          "╔══「 🔕 *GOODBYE OFF* 」══╗",
          "",
          "  Auto-goodbye is *disabled*.",
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "set") {
      const msg = text.slice(4).trim()
      if (!msg) return sock.sendMessage(from, { text: "❌ Usage: `.goodbye set <your message>`" })
      cfg[from].message = msg
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 ✏️ *MESSAGE SAVED* 」══╗",
          "",
          `  _${msg}_`,
          "",
          "  Run `.goodbye test` to preview.",
          "",
          "╚══「 ⚡ *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    if (sub === "reset") {
      cfg[from].message = DEFAULT_MSG
      writeConfig(cfg)
      return sock.sendMessage(from, { text: "✅ Goodbye message reset to default." })
    }

    if (sub === "test") {
      const { handleGoodbye } = require("../lib/goodbye")
      return handleGoodbye(sock, { id: from, participants: [sender], action: "remove" })
    }

    if (sub === "status") {
      const g = cfg[from]
      return sock.sendMessage(from, {
        text: [
          "╔══「 📊 *GOODBYE STATUS* 」══╗",
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
        "╔══「 👋 *GOODBYE HELP* 」══╗",
        "",
        "  `.goodbye on`        — enable",
        "  `.goodbye off`       — disable",
        "  `.goodbye set <msg>` — custom message",
        "  `.goodbye reset`     — restore default",
        "  `.goodbye test`      — preview",
        "  `.goodbye status`    — current config",
        "  `.goodbye vars`      — template variables",
        "",
        "╚══「 ⚡ *CYBER X* 」══╝",
      ].join("\n")
    })
  }
}
