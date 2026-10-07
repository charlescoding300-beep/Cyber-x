module.exports = {
  name: "gcjid",
  aliases: ["groupjid"],
  desc: "List all groups the bot account belongs to with their GIDs.",
  usage: ".gcjid",
  category: "owner",

  async run({ sock, msg, isOwner, helper }) {
    if (!isOwner) {
      return helper.reply(sock, msg, "> ❌ *Owner only.*")
    }

    let groups

    try {
      groups = await sock.groupFetchAllParticipating()
    } catch (e) {
      return helper.reply(
        sock,
        msg,
        `> ❌ *Couldn't fetch the group list.*\n> ${e.message}`
      )
    }

    const list = Object.values(groups || {})
      .filter(g => g?.id)
      .sort((a, b) =>
        String(a.subject || "").localeCompare(
          String(b.subject || ""),
          undefined,
          { sensitivity: "base" }
        )
      )

    if (!list.length) {
      return helper.reply(sock, msg, "> ❌ *No groups found.*")
    }

    const lines = [
      "╭───「 ZEN X GROUP LIST 」───╮",
      ""
    ]

    list.forEach((g, i) => {
      lines.push(
        `${i + 1}. ${g.subject || "Unnamed Group"}`,
        "",
        "   GID:",
        `   ${g.id}`,
        ""
      )
    })

    lines.push("╰──────────────────────────╯")

    return helper.reply(sock, msg, lines.join("\n"))
  }
}
