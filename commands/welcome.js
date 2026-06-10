// ─────────────────────────────────────────────────────────
// commands/welcome.js — Admin welcome configuration
// Usage:
//   .welcome on
//   .welcome off
//   .welcome set Welcome to {group}, {tag}! You are member {count} 🎉
//   .welcome reset
//   .welcome test
//   .welcome status
//   .welcome vars
// ─────────────────────────────────────────────────────────

const { readConfig, writeConfig, DEFAULT_MSG } = require("../lib/welcome")

const VARS_HELP = [
  "*Available variables:*",
  "",
  "  `{tag}`    — mentions the member",
  "  `{name}`   — member's display name",
  "  `{number}` — member's phone number",
  "  `{group}`  — group name",
  "  `{count}`  — total members in group",
  "  `{date}`   — date they joined",
  "  `{time}`   — time they joined",
  "",
  "*WhatsApp formatting:*",
  "  `*bold*`  _italic_  ~strikethrough~",
  "",
  "*Example:*",
  "`.welcome set 🎉 Welcome {tag} to {group}! You're member #{count}`",
].join("\n")

module.exports = {
  pattern:  "welcome",
  desc:     "Configure auto-welcome messages for new members",
  usage:    ".welcome on | off | set <msg> | reset | test | status | vars",
  category: "admin",

  async run({ sock, from, sender, args, text, isOwner, isGroup, lib }) {
    if (!isGroup) {
      return sock.sendMessage(from, { text: "❌ This command only works in groups." })
    }

    // check if sender is admin
    const isAdmin = typeof lib.isUserAdmin === "function"
      ? await lib.isUserAdmin(from, sender)
      : isOwner

    if (!isAdmin && !isOwner) {
      return sock.sendMessage(from, { text: "❌ Admins only." })
    }

    const sub = (args[0] || "").toLowerCase()
    const cfg = readConfig()
    if (!cfg[from]) cfg[from] = { enabled: false, message: DEFAULT_MSG }

    // ── .welcome on ────────────────────────────────────────
    if (sub === "on") {
      cfg[from].enabled = true
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 ✅ *WELCOME ENABLED* 」══╗",
          "",
          "  Auto-welcome is now *ON* for this group.",
          "  New members will be greeted automatically.",
          "",
          "  Use `.welcome set <msg>` to customise.",
          "  Use `.welcome vars` to see template variables.",
          "",
          "╚══「 *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    // ── .welcome off ───────────────────────────────────────
    if (sub === "off") {
      cfg[from].enabled = false
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 🔕 *WELCOME DISABLED* 」══╗",
          "",
          "  Auto-welcome is now *OFF* for this group.",
          "",
          "╚══「 *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    // ── .welcome set <message> ─────────────────────────────
    if (sub === "set") {
      const newMsg = text.slice(4).trim()  // strip "set "
      if (!newMsg) {
        return sock.sendMessage(from, {
          text: "❌ Provide a message.\n\nExample:\n`.welcome set 🎉 Hey {tag}, welcome to {group}!`"
        })
      }
      cfg[from].message = newMsg
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 ✏️ *WELCOME MESSAGE SET* 」══╗",
          "",
          "  Your new welcome message:",
          "",
          `  _${newMsg}_`,
          "",
          "  Use `.welcome test` to preview it.",
          "",
          "╚══「 *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    // ── .welcome reset ─────────────────────────────────────
    if (sub === "reset") {
      cfg[from].message = DEFAULT_MSG
      writeConfig(cfg)
      return sock.sendMessage(from, {
        text: [
          "╔══「 🔄 *WELCOME RESET* 」══╗",
          "",
          "  Welcome message reset to default.",
          "",
          "╚══「 *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    // ── .welcome test ──────────────────────────────────────
    if (sub === "test") {
      const { handleGroupUpdate } = require("../lib/welcome")
      // Simulate a join event for the person who ran the command
      await handleGroupUpdate(sock, {
        id:           from,
        participants: [sender],
        action:       "add",
      })
      return  // handleGroupUpdate sends the message
    }

    // ── .welcome status ────────────────────────────────────
    if (sub === "status") {
      const g = cfg[from]
      return sock.sendMessage(from, {
        text: [
          "╔══「 📊 *WELCOME STATUS* 」══╗",
          "",
          `  *Status:*  ${g?.enabled ? "✅ ON" : "🔕 OFF"}`,
          "",
          "  *Current message:*",
          `  _${(g?.message || DEFAULT_MSG).slice(0, 200)}${(g?.message || DEFAULT_MSG).length > 200 ? "…" : ""}_`,
          "",
          "╚══「 *CYBER X* 」══╝",
        ].join("\n")
      })
    }

    // ── .welcome vars ──────────────────────────────────────
    if (sub === "vars") {
      return sock.sendMessage(from, { text: VARS_HELP })
    }

    // ── no subcommand — show help ──────────────────────────
    return sock.sendMessage(from, {
      text: [
        "╔══「 👋 *WELCOME COMMAND* 」══╗",
        "",
        "  `.welcome on`          — enable auto-welcome",
        "  `.welcome off`         — disable auto-welcome",
        "  `.welcome set <msg>`   — set custom message",
        "  `.welcome reset`       — restore default",
        "  `.welcome test`        — preview welcome",
        "  `.welcome status`      — show current config",
        "  `.welcome vars`        — show template variables",
        "",
        "╚══「 *CYBER X* 」══╝",
      ].join("\n")
    })
  }
}
