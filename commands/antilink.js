// ─────────────────────────────────────────
//   commands/antilink.js — CYBER X Antilink Command
// ─────────────────────────────────────────

const {
  containsLink,
  enableAntilink,
  disableAntilink,
  isAntilinkEnabled,
  getAction,
  addWarning,
  getWarnings,
  resetWarnings,
} = require("../lib/antilink")

module.exports = {
  pattern: ".antilink",

  run: async ({ sock, from, msg, sender, args, isGroup, isAdmin, isBotAdmin }) => {

    const tag = sender.split("@")[0]

    // ───────── MUST BE IN A GROUP ─────────
    if (!isGroup) {
      return await sock.sendMessage(from, {
        text:
`┌─────〔 ⚠️ *ERROR* 〕─────
│ ❌ This command only works in groups!
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
      }, { quoted: msg })
    }

    // ───────── MUST BE ADMIN ─────────
    if (!isAdmin) {
      return await sock.sendMessage(from, {
        text:
`┌─────〔 🚫 *ACCESS DENIED* 〕─────
│ 👮 Only *Group Admins* can use this!
│ 👤 User: @${tag}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      }, { quoted: msg })
    }

    const option = args?.[0]?.toLowerCase()

    // ───────── SHOW HELP IF NO ARGS ─────────
    if (!option) {
      const status = isAntilinkEnabled(from) ? "✅ ON" : "❌ OFF"
      const action = getAction(from)
      return await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔗 *𝘾𝙔𝘽𝙀𝙍 𝙓 ANTILINK*  ║
╚════════════════════╝

┌─────〔 📋 *STATUS* 〕─────
│ 🔗 *Antilink:* ${status}
│ ⚙️ *Action:* ${action.toUpperCase()}
└──────────────────────────

┌─────〔 📖 *USAGE* 〕─────
│ ◈ *.antilink on* — Enable & delete links
│ ◈ *.antilink warn* — Enable & warn user
│ ◈ *.antilink kick* — Enable & kick on 3rd warn
│ ◈ *.antilink off* — Disable antilink
└──────────────────────────

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
      }, { quoted: msg })
    }

    // ───────── ANTILINK OFF ─────────
    if (option === "off") {
      disableAntilink(from)
      return await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔗 *ANTILINK DISABLED*  ║
╚════════════════════╝

┌─────〔 ✅ *SUCCESS* 〕─────
│ ❌ *Antilink:* Turned OFF
│ 👤 *By:* @${tag}
│ ℹ️ Links are now allowed in this group
└──────────────────────────

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      }, { quoted: msg })
    }

    // ───────── ANTILINK ON / WARN / KICK ─────────
    if (["on", "warn", "kick"].includes(option)) {
      const action = option === "on" ? "delete" : option
      enableAntilink(from, action)

      const actionText = {
        delete: "🗑️ Links will be *deleted* instantly",
        warn: "⚠️ Users will be *warned* (auto-kick at 3 warnings)",
        kick: "👢 Users will be *kicked* on 3rd warning"
      }[action]

      return await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  🔗 *ANTILINK ENABLED*  ║
╚════════════════════╝

┌─────〔 ✅ *ACTIVATED* 〕─────
│ ✅ *Antilink:* Turned ON
│ ⚙️ *Mode:* ${action.toUpperCase()}
│ 👤 *By:* @${tag}
└──────────────────────────

┌─────〔 ℹ️ *ACTION* 〕─────
│ ${actionText}
└──────────────────────────

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      }, { quoted: msg })
    }

    // ───────── INVALID OPTION ─────────
    await sock.sendMessage(from, {
      text:
`┌─────〔 ⚠️ *INVALID OPTION* 〕─────
│ Use: *.antilink on/warn/kick/off*
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
    }, { quoted: msg })
  }
}
