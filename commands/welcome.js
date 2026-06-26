// commands/welcome.js — CYBER X
// .welcome on | off | set <msg> | reset | view

module.exports = {
  pattern:  "welcome",
  category: "GROUP",
  desc:     "Manage welcome messages for this group",
  usage:    ".welcome on | off | set <message> | reset | view",

  async run({ sock, from, msg, args, isAdmin, isOwner }) {
    if (!from.endsWith("@g.us"))
      return sock.sendMessage(from, { text: "👋 .welcome only works in groups!" }, { quoted: msg })

    if (!isAdmin && !isOwner)
      return sock.sendMessage(from, { text: "🚫 Only admins can change welcome settings." }, { quoted: msg })

    const phone = sock?.user?.id?.split("@")[0]?.replace(/:\d+$/, "") || ""
    const greetGet  = global.__greetGet
    const greetSet  = global.__greetSet
    const defMsg    = global.__GREET_DEFAULT_WELCOME
    const sub       = (args[0] || "").toLowerCase()

    if (sub === "on") {
      greetSet(phone, from, "welcome", { enabled: true })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👋 *WELCOME ENABLED* 〕━━━╮\n┃\n┃ ✅ Welcome messages are now *ON*\n┃ New members get greeted with\n┃ their profile picture + tag!\n┃\n┃ *.welcome set <msg>* to customize\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "off") {
      greetSet(phone, from, "welcome", { enabled: false })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👋 *WELCOME DISABLED* 〕━━━╮\n┃\n┃ ❌ Welcome messages are *OFF*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "reset") {
      greetSet(phone, from, "welcome", { message: null })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👋 *WELCOME RESET* 〕━━━╮\n┃\n┃ ✅ Reset to default message!\n┃\n┃ ${defMsg}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "view") {
      const s = greetGet(phone, from, "welcome")
      return sock.sendMessage(from, {
        text: `╭━━━〔 👋 *WELCOME SETTINGS* 〕━━━╮\n┃\n┃ Status: ${s?.enabled ? "✅ ON" : "❌ OFF"}\n┃\n┃ Message:\n┃ ${s?.message || defMsg}\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "set") {
      const customMsg = args.slice(1).join(" ").trim()
      if (!customMsg) {
        return sock.sendMessage(from, {
          text: `╭━━━〔 👋 *SET WELCOME* 〕━━━╮\n┃\n┃ ⚠ Provide a message!\n┃\n┃ Example:\n┃ .welcome set Welcome {name}!\n┃ You joined {group} 🎉\n┃ We now have {members} members!\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg })
      }
      greetSet(phone, from, "welcome", { message: customMsg, enabled: true })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👋 *WELCOME MESSAGE SET* 〕━━━╮\n┃\n┃ ✅ Saved! Welcome is now *ON*\n┃\n┃ Your message:\n┃ ${customMsg}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    // help
    return sock.sendMessage(from, {
      text: `╭━━━〔 👋 *WELCOME HELP* 〕━━━╮\n┃\n┃ .welcome on\n┃ .welcome off\n┃ .welcome set <message>\n┃ .welcome reset\n┃ .welcome view\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
    }, { quoted: msg })
  }
}
