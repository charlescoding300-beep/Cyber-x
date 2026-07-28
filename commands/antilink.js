/**
 * .antilink — the missing piece: index.js already has the full antilink
 * DETECTION engine (patterns, OCR, channel support, button/template
 * parsing) wired up as global functions, but nothing in commands/ was
 * actually calling them. This is that missing command.
 *
 * Requires: isGroup, isAdmin/isOwner, and the bot itself must be a group
 * admin (botAdminNeeded) — antilink can only delete/kick if the bot has
 * admin rights in that group.
 */

module.exports = {
  name:     "antilink",
  aliases:  ["anti-link"],
  desc:     "Configure antilink protection (delete/kick/warn) — deletes links, WhatsApp Channel/group invites, and shortened links, including inside images (OCR) and button/template posts.",
  usage:    ".antilink on | .antilink off | .antilink set delete|kick|warn | .antilink get",
  category: "admin",

  async run({ sock, from, msg, args, isGroup, isOwner, isAdmin, isBotAdmin, helper }) {
    if (!isGroup) {
      return helper.reply(sock, msg, "❌ This command only works inside a group.")
    }
    if (!isOwner && !isAdmin) {
      return helper.reply(sock, msg, "❌ Only group admins or the bot owner can change this.")
    }

    if (typeof global.__antilinkEnable !== "function") {
      return helper.reply(sock, msg, "❌ Antilink engine isn't loaded — check that index.js ran `init()` correctly.")
    }

    const sub = (args[0] || "").toLowerCase()
    const ocrNote = global.__antilinkOcrAvailable
      ? "🔍 OCR: available (scans images/screenshots too)"
      : "🔍 OCR: unavailable — run `npm install tesseract.js` on the server"

    if (!sub) {
      const enabled = global.__antilinkIsEnabled(from, from)
      const action  = global.__antilinkGetAction(from, from)
      return helper.reply(sock, msg, helper.box("🔗 ANTILINK STATUS", [
        `Status: ${enabled ? "✅ ON" : "❌ OFF"}`,
        `Action: ${action}`,
        ocrNote,
        "",
        "Commands:",
        ".antilink on / .antilink off",
        ".antilink set delete | kick | warn",
      ]))
    }

    if (!isBotAdmin) {
      return helper.reply(sock, msg, "⚠️ I need to be a group admin here for antilink to actually delete/kick anyone. Make me admin first.")
    }

    if (sub === "on") {
      global.__antilinkEnable(from, from, "delete") // default action = delete-with-reason
      return helper.reply(sock, msg, helper.box("🔗 ANTILINK — ENABLED", [
        "Antilink is now ON for this group.",
        "Default action: delete (with reason shown)",
        "Change it anytime with: .antilink set kick | warn",
      ]))
    }

    if (sub === "off") {
      global.__antilinkDisable(from, from)
      return helper.reply(sock, msg, helper.box("🔗 ANTILINK — DISABLED", [
        "Antilink is now OFF for this group.",
      ]))
    }

    if (sub === "set") {
      const action = (args[1] || "").toLowerCase()
      if (!["delete", "kick", "warn"].includes(action)) {
        return helper.reply(sock, msg, "❌ Choose one: .antilink set delete | kick | warn")
      }
      global.__antilinkEnable(from, from, action)
      const desc = {
        delete: "Deletes every link, always shows the reason. No kicks.",
        kick:   "Deletes AND kicks instantly on the first link — no warnings.",
        warn:   "Deletes + warns; 3 warnings in this group auto-kicks.",
      }[action]
      return helper.reply(sock, msg, helper.box(`🔗 ANTILINK — MODE: ${action.toUpperCase()}`, [desc]))
    }

    if (sub === "get") {
      const enabled = global.__antilinkIsEnabled(from, from)
      const action  = global.__antilinkGetAction(from, from)
      return helper.reply(sock, msg, `*Antilink:* ${enabled ? "ON" : "OFF"}\n*Action:* ${action}`)
    }

    return helper.reply(sock, msg, "❌ Use .antilink for usage.")
  },
}
