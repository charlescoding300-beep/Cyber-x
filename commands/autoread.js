"use strict"
module.exports = {
  pattern:  "autoreply",
  desc:     "Toggle auto reply or set reply text (owner only)",
  usage:    ".autoreply  |  .autoreply Hey I am busy!",
  category: "settings",

  async run({ sock, from, msg, args, settings, helper, isOwner }) {
    if (!isOwner) return helper.reply(sock, msg, "❌ Owner only.")

    const text = args.join(" ").trim()
    if (text) {
      settings.set("autoReplyText", text)
      settings.set("autoReply", true)
      return helper.reply(sock, msg, `✅ Auto Reply *ON* with text:\n"${text}"`)
    }

    const val = settings.toggle("autoReply")
    return helper.reply(sock, msg, `${val ? "✅" : "❌"} Auto Reply *${val ? "ON" : "OFF"}*`)
  }
}
