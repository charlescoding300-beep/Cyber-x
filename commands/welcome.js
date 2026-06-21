const {
  getGroupConfig,
  setWelcome,
  resetWelcome,
  DEFAULT_WELCOME,
} = require("../lib/groupParticipants")

module.exports = {
  pattern: "welcome",
  alias: ["welcomemsg", "setwelcome"],
  desc: "Turn the group welcome message on/off and customize it",
  usage: ".welcome on | .welcome off | .welcome set <message> | .welcome get | .welcome reset",
  category: "group",

  async run({ sock, from, msg, args, text, isGroup, isAdmin, isBotAdmin, isOwner, helper }) {
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works inside a group.")
    if (!isAdmin && !isOwner)
      return helper.reply(sock, msg, "❌ Only group admins can change the welcome settings.")
    if (!isBotAdmin)
      return helper.reply(sock, msg, "❌ I need to be a group admin first — promote me, then try again.")

    const sub = (args[0] || "").toLowerCase()
    const cfg = getGroupConfig(from)

    switch (sub) {
      case "":
      case "get":
      case "status":
        return helper.reply(
          sock, msg,
          helper.box("WELCOME SETTINGS", [
            `Status  : ${cfg.welcomeEnabled ? "✅ ON" : "❌ OFF"}`,
            `Message :`,
            cfg.welcomeMsg,
            ``,
            `Tags: {user} {number} {group} {count} {desc}`,
            `Usage: ${this.usage}`,
          ])
        )

      case "on":
        setWelcome(from, { enabled: true })
        return helper.reply(sock, msg, "✅ Welcome messages are now *ON* for this group.")

      case "off":
        setWelcome(from, { enabled: false })
        return helper.reply(sock, msg, "❌ Welcome messages are now *OFF* for this group.")

      case "set": {
        const match  = text.match(/^\S+\s+([\s\S]*)$/)
        const newMsg = match ? match[1].trim() : ""
        if (!newMsg)
          return helper.reply(
            sock, msg,
            `❌ Provide a message.\nExample:\n.welcome set Welcome {user} to *{group}*! You're member #{count} 🎉\n\nTags: {user} {number} {group} {count} {desc}`
          )
        setWelcome(from, { msg: newMsg })
        return helper.reply(sock, msg, `✅ Welcome message updated:\n\n${newMsg}`)
      }

      case "reset":
        resetWelcome(from)
        return helper.reply(sock, msg, `✅ Welcome message reset to default:\n\n${DEFAULT_WELCOME}`)

      default:
        return helper.reply(sock, msg, `❌ Unknown option.\nUsage: ${this.usage}`)
    }
  },
}
