"use strict"
module.exports = {
  pattern:  "mode",
  desc:     "Switch bot between public and private mode (owner only)",
  usage:    ".mode public  |  .mode private",
  category: "settings",

  async run({ sock, from, msg, args, settings, helper, isOwner }) {
    if (!isOwner) return helper.reply(sock, msg, "❌ Owner only.")

    const m = args[0]?.toLowerCase()
    if (!m || !["public", "private"].includes(m))
      return helper.reply(sock, msg, "❌ Usage: .mode public  or  .mode private")

    settings.set("mode", m)
    return helper.reply(sock, msg,
      `🌐 Bot mode: *${m.toUpperCase()}*\n${
        m === "private"
          ? "Only you (owner) can use commands now."
          : "Everyone can use commands now."
      }`)
  }
}
