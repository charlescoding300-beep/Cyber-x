"use strict"
module.exports = {
  pattern:  "setprefix",
  alias:    ["changeprefix", "prefix"],
  desc:     "Change the bot's global command prefix (owner only)",
  usage:    ".setprefix !  |  .setprefix reset",
  category: "settings",

  async run({ sock, from, msg, args, settings, helper, isOwner }) {
    if (!isOwner) return helper.reply(sock, msg, "❌ Only the bot owner can change the prefix.")

    const input = args[0]?.trim()

    if (!input || input === "reset" || input === "default") {
      settings.set("prefix", process.env.BOT_PREFIX || ".")
      return helper.reply(sock, msg,
        `✅ Prefix reset to default: *${settings.prefix}*\nWorks everywhere — DMs and groups.`)
    }

    if (input.length > 3) {
      return helper.reply(sock, msg, "❌ Prefix must be 1–3 characters.\nExamples: . ! / # $")
    }

    settings.set("prefix", input)
    return helper.reply(sock, msg,
      `✅ Global prefix changed to: *${input}*\nNow works everywhere — DMs, groups, anywhere.`)
  }
}
