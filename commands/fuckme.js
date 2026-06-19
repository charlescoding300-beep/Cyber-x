'use strict'

module.exports = {
  pattern:  "fuckme",
  alias:    ["addbot", "connect"],
  desc:     "Connect a WhatsApp number to CYBER X",
  category: "System",

  async run({ sock, from, msg, sender, args, helper, lib, isOwner }) {
    // ── Owner gate ─────────────────────────────────────────────
    // Checks context isOwner first (set per-message in index.js),
    // falls back to lib/isAdmin.js directly. This keeps the command
    // locked down even if it ever gets called from somewhere that
    // doesn't pass isOwner in — e.g. a future website bridge.
    const ownerOk = isOwner || (typeof lib?.isOwner === "function" && lib.isOwner(sender))
    if (!ownerOk)
      return helper.reply(sock, msg, "❌ Only the bot owner can add sessions.")

    const phone = args[0]?.replace(/\D/g, "")
    if (!phone || phone.length < 7) {
      return helper.reply(sock, msg,
        helper.box("⚡ FUCKME — ADD BOT", [
          "Usage: .fuckme <phone>",
          "Example: .fuckme 2348012345678",
          "• Include country code",
          "• No + or spaces",
        ])
      )
    }

    await helper.react(sock, msg, "⏳")

    try {
      const { addSession } = require("../index")
      const result = await addSession(phone)

      await helper.react(sock, msg, "✅")
      await helper.reply(sock, msg,
        helper.box("📱 BOT ADDED", [
          `Phone: ${result.phone}`,
          result.pairingCode ? `Code:  *${result.pairingCode}*` : result.message,
          "",
          result.pairingCode ? "Open WA > Linked Devices > Link Device" : "",
        ].filter(Boolean))
      )
    } catch (e) {
      await helper.react(sock, msg, "❌")
      await helper.reply(sock, msg, `❌ Failed: ${e.message}`)
    }
  },
}
