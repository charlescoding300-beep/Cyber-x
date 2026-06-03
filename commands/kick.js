module.exports = {
  pattern: "kick",

  run: async ({ sock, from, msg, args, isOwner }) => {

    const header = `⚡ 𝘾𝙔𝘽𝙀𝙍 𝙓\n${"─".repeat(20)}\n`

    // OWNER ONLY
    if (!isOwner) {
      return sock.sendMessage(
        from,
        { text: `${header}🚫 Access denied. Owner only command.` },
        { quoted: msg }
      )
    }

    // GROUP ONLY
    if (!from.endsWith("@g.us")) {
      return sock.sendMessage(
        from,
        { text: `${header}❌ This command only works in groups.` },
        { quoted: msg }
      )
    }

    // GET TARGET — tagged user or replied-to user
    let target =
      msg.message?.extendedTextMessage?.contextInfo?.participant ||
      (args[0] ? args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null)

    if (!target) {
      return sock.sendMessage(
        from,
        { text: `${header}❌ Tag a user or reply to their message.\n\n📌 Usage: .kick @user` },
        { quoted: msg }
      )
    }

    try {
      await sock.groupParticipantsUpdate(from, [target], "remove")

      await sock.sendMessage(
        from,
        {
          text: `${header}✅ @${target.split("@")[0]} has been kicked.\n\n👢 Removed by owner.`,
          mentions: [target]
        },
        { quoted: msg }
      )

    } catch (error) {
      await sock.sendMessage(
        from,
        { text: `${header}❌ Failed to kick:\n${error.message}` },
        { quoted: msg }
      )
    }
  }
}
