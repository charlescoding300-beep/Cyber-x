// commands/goodbye.js — CYBER X
// .goodbye on | off | set <msg> | reset | view

module.exports = {
  pattern:  "goodbye",
  category: "GROUP",
  desc:     "Manage goodbye messages for this group",
  usage:    ".goodbye on | off | set <message> | reset | view",

  async run({ sock, from, msg, args, isAdmin, isOwner }) {
    if (!from.endsWith("@g.us"))
      return sock.sendMessage(from, { text: "👋 .goodbye only works in groups!" }, { quoted: msg })

    if (!isAdmin && !isOwner)
      return sock.sendMessage(from, { text: "🚫 Only admins can change goodbye settings." }, { quoted: msg })

    const phone    = sock?.user?.id?.split("@")[0]?.replace(/:\d+$/, "") || ""
    const greetGet = global.__greetGet
    const greetSet = global.__greetSet
    const defMsg   = global.__GREET_DEFAULT_GOODBYE
    const sub      = (args[0] || "").toLowerCase()

    if (sub === "on") {
      greetSet(phone, from, "goodbye", { enabled: true })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👣 *GOODBYE ENABLED* 〕━━━╮\n┃\n┃ ✅ Goodbye messages are now *ON*\n┃ Members leaving get a farewell\n┃ with their tag!\n┃\n┃ *.goodbye set <msg>* to customize\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "off") {
      greetSet(phone, from, "goodbye", { enabled: false })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👣 *GOODBYE DISABLED* 〕━━━╮\n┃\n┃ ❌ Goodbye messages are *OFF*\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "reset") {
      greetSet(phone, from, "goodbye", { message: null })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👣 *GOODBYE RESET* 〕━━━╮\n┃\n┃ ✅ Reset to default message!\n┃\n┃ ${defMsg}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "view") {
      const s = greetGet(phone, from, "goodbye")
      return sock.sendMessage(from, {
        text: `╭━━━〔 👣 *GOODBYE SETTINGS* 〕━━━╮\n┃\n┃ Status: ${s?.enabled ? "✅ ON" : "❌ OFF"}\n┃\n┃ Message:\n┃ ${s?.message || defMsg}\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    if (sub === "set") {
      const customMsg = args.slice(1).join(" ").trim()
      if (!customMsg) {
        return sock.sendMessage(from, {
          text: `╭━━━〔 👣 *SET GOODBYE* 〕━━━╮\n┃\n┃ ⚠ Provide a message!\n┃\n┃ Example:\n┃ .goodbye set Goodbye {name}! 👋\n┃ We'll miss you in {group}.\n┃ Now {members} members remain.\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg })
      }
      greetSet(phone, from, "goodbye", { message: customMsg, enabled: true })
      return sock.sendMessage(from, {
        text: `╭━━━〔 👣 *GOODBYE MESSAGE SET* 〕━━━╮\n┃\n┃ ✅ Saved! Goodbye is now *ON*\n┃\n┃ Your message:\n┃ ${customMsg}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }

    // help
    return sock.sendMessage(from, {
      text: `╭━━━〔 👣 *GOODBYE HELP* 〕━━━╮\n┃\n┃ .goodbye on\n┃ .goodbye off\n┃ .goodbye set <message>\n┃ .goodbye reset\n┃ .goodbye view\n┃\n┃ Placeholders:\n┃ {name} {group} {desc}\n┃ {members} {tag}\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
    }, { quoted: msg })
  }
}
