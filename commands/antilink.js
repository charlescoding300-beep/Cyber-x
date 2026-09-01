// commands/antilink.js
module.exports = {
  pattern: "antilink",
  alias: ["anti-link"],
  category: "group",
  desc: "Delete, warn, or kick users who post links in this group",
  usage: ".antilink on | .antilink off | .antilink warn | .antilink kick | .antilink delete",

  async run({ sock, from, msg, args, isGroup, isAdmin, isOwner, helper }) {
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works in groups.")
    if (!isAdmin && !isOwner) return helper.reply(sock, msg, "❌ Only group admins can use this.")

    const sub   = (args[0] || "").toLowerCase()
    const phone = (sock.user?.id || "").split("@")[0].split(":")[0]

    if (sub === "off") {
      global.__antilinkDisable?.(phone, from)
      return helper.reply(sock, msg, "*Antilink DISABLED SUCCESSFULLY ✅*")
    }
    if (["on", "warn", "kick", "delete"].includes(sub)) {
      const action = sub === "on" ? "warn" : sub
      global.__antilinkEnable?.(phone, from, action)
      return helper.reply(sock, msg, `*Antilink ENABLED SUCCESSFULLY ✅*\n\nAction: *${action}*`)
    }

    const enabled = global.__antilinkIsEnabled?.(phone, from)
    const action  = global.__antilinkGetAction?.(phone, from)
    return helper.reply(
      sock, msg,
      `*Antilink settings*\nStatus: ${enabled ? "✅ ON" : "🚫 OFF"}${enabled ? `\nAction: ${action}` : ""}\n\n` +
      "Usage:\n.antilink on\n.antilink off\n.antilink warn\n.antilink kick\n.antilink delete"
    )
  },
}
