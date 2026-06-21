const {
  getGroupConfig,
  setGoodbye,
  resetGoodbye,
  DEFAULT_GOODBYE,
} = require("../lib/groupParticipants")

module.exports = {
  pattern: "goodbye",
  alias: ["goodbyemsg", "setgoodbye", "bye"],
  desc: "Turn the group goodbye message on/off and customize it",
  usage: ".goodbye on | .goodbye off | .goodbye set <message> | .goodbye get | .goodbye reset",
  category: "group",

  async run({ sock, from, msg, args, text, isGroup, isAdmin, isBotAdmin, isOwner, helper }) {
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works inside a group.")
    if (!isAdmin && !isOwner)
      return helper.reply(sock, msg, "❌ Only group admins can change the goodbye settings.")
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
          helper.box("GOODBYE SETTINGS", [
            `Status  : ${cfg.goodbyeEnabled ? "✅ ON" : "❌ OFF"}`,
            `Message :`,
            cfg.goodbyeMsg,
            ``,
            `Tags: {user} {number} {group} {count} {desc}`,
            `Usage: ${this.usage}`,
          ])
        )

      case "on":
        setGoodbye(from, { enabled: true })
        return helper.reply(sock, msg, "✅ Goodbye messages are now *ON* for this group.")

      case "off":
        setGoodbye(from, { enabled: false })
        return helper.reply(sock, msg, "❌ Goodbye messages are now *OFF* for this group.")

      case "set": {
        const match  = text.match(/^\S+\s+([\s\S]*)$/)
        const newMsg = match ? match[1].trim() : ""
        if (!newMsg)
          return helper.reply(
            sock, msg,
            `❌ Provide a message.\nExample:\n.goodbye set Bye {user}, we'll miss you from *{group}* 😢\n\nTags: {user} {number} {group} {count} {desc}`
          )
        setGoodbye(from, { msg: newMsg })
        return helper.reply(sock, msg, `✅ Goodbye message updated:\n\n${newMsg}`)
      }

      case "reset":
        resetGoodbye(from)
        return helper.reply(sock, msg, `✅ Goodbye message reset to default:\n\n${DEFAULT_GOODBYE}`)

      default:
        return helper.reply(sock, msg, `❌ Unknown option.\nUsage: ${this.usage}`)
    }
  },
}
