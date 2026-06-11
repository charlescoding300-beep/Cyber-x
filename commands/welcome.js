// ════════════════════════════════════════════════════════════════════
//  commands/welcome.js  —  CYBER X  |  Welcome & Goodbye Config
//
//  .welcome               → show current settings
//  .welcome on            → enable welcome messages
//  .welcome off           → disable welcome messages
//  .welcome set [msg]     → set custom welcome message
//
//  .welcome goodbye on    → enable goodbye
//  .welcome goodbye off   → disable goodbye
//  .welcome goodbye set [msg] → set custom goodbye message
//
//  Placeholders: {tag} {user}
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  "welcome",
  desc:     "Configure welcome & goodbye messages for the group",
  usage:    ".welcome on/off/set | .welcome goodbye on/off/set",
  category: "group",

  run: async ({ sock, from, msg, sender, args, isGroup, isOwner, lib }) => {

    // ── Groups only ───────────────────────────────────────────────
    if (!isGroup) {
      return sock.sendMessage(from, {
        text: "❌ This command only works in groups.",
      }, { quoted: msg })
    }

    // ── Admin check — uses lib/isAdmin.js (already in your lib) ──
    const adminCheck = isOwner || (
      typeof lib?.isAdmin === "function"
        ? await lib.isAdmin(sock, from, sender).catch(() => false)
        : false
    )

    if (!adminCheck) {
      return sock.sendMessage(from, {
        text: "❌ *Admins only.*",
      }, { quoted: msg })
    }

    // ── Resolve welcome lib ───────────────────────────────────────
    const wLib = lib?.welcome
    if (!wLib || typeof wLib.setCfg !== "function") {
      return sock.sendMessage(from, {
        text: "❌ Welcome lib not loaded. Make sure *lib/welcome.js* exists.",
      }, { quoted: msg })
    }

    const { getCfg, setCfg } = wLib
    const sub = (args[0] || "").toLowerCase()
    const c   = getCfg(from)

    // ══════════════════════════════════════════
    //  .welcome on
    // ══════════════════════════════════════════
    if (sub === "on") {
      setCfg(from, { welcomeOn: true })
      return sock.sendMessage(from, {
        text:
          "✅ *Welcome messages ON*\n\n" +
          "New members will be greeted with their profile picture.\n\n" +
          "Customise: *.welcome set [message]*\n" +
          "Placeholders: *{tag}* *{user}*",
      }, { quoted: msg })
    }

    // ══════════════════════════════════════════
    //  .welcome off
    // ══════════════════════════════════════════
    if (sub === "off") {
      setCfg(from, { welcomeOn: false })
      return sock.sendMessage(from, {
        text: "🔕 *Welcome messages OFF*",
      }, { quoted: msg })
    }

    // ══════════════════════════════════════════
    //  .welcome set [message]
    // ══════════════════════════════════════════
    if (sub === "set") {
      const newMsg = args.slice(1).join(" ").trim()
      if (!newMsg) {
        return sock.sendMessage(from, {
          text:
            "❌ *Provide a message after .welcome set*\n\n" +
            "Example:\n*.welcome set Welcome {tag}! 🎉*\n\n" +
            "Placeholders:\n*{tag}* → @mention\n*{user}* → phone number",
        }, { quoted: msg })
      }
      setCfg(from, { welcomeMsg: newMsg })
      return sock.sendMessage(from, {
        text: `✅ *Welcome message saved:*\n\n${newMsg}`,
      }, { quoted: msg })
    }

    // ══════════════════════════════════════════
    //  .welcome goodbye [on/off/set]
    // ══════════════════════════════════════════
    if (sub === "goodbye" || sub === "bye") {
      const action = (args[1] || "").toLowerCase()

      if (action === "on") {
        setCfg(from, { goodbyeOn: true })
        return sock.sendMessage(from, {
          text:
            "✅ *Goodbye messages ON*\n\n" +
            "Bot will farewell members who leave or get removed.\n\n" +
            "Customise: *.welcome goodbye set [message]*",
        }, { quoted: msg })
      }

      if (action === "off") {
        setCfg(from, { goodbyeOn: false })
        return sock.sendMessage(from, {
          text: "🔕 *Goodbye messages OFF*",
        }, { quoted: msg })
      }

      if (action === "set") {
        const newMsg = args.slice(2).join(" ").trim()
        if (!newMsg) {
          return sock.sendMessage(from, {
            text:
              "❌ *Provide a message after .welcome goodbye set*\n\n" +
              "Example:\n*.welcome goodbye set Bye {tag} 👋*\n\n" +
              "Placeholders: *{tag}* *{user}*",
          }, { quoted: msg })
        }
        setCfg(from, { goodbyeMsg: newMsg })
        return sock.sendMessage(from, {
          text: `✅ *Goodbye message saved:*\n\n${newMsg}`,
        }, { quoted: msg })
      }

      // .welcome goodbye — show goodbye status
      return sock.sendMessage(from, {
        text:
          `╔═══════════════════════════╗\n` +
          `║  🚪  GOODBYE SETTINGS     ║\n` +
          `╚═══════════════════════════╝\n\n` +
          `Status: ${c.goodbyeOn ? "🟢 ON" : "🔴 OFF"}\n\n` +
          `Message:\n${c.goodbyeMsg || "(default)"}\n\n` +
          `*.welcome goodbye on*\n` +
          `*.welcome goodbye off*\n` +
          `*.welcome goodbye set [text]*`,
      }, { quoted: msg })
    }

    // ══════════════════════════════════════════
    //  .welcome — show full status
    // ══════════════════════════════════════════
    return sock.sendMessage(from, {
      text:
        `╔═══════════════════════════╗\n` +
        `║  👋  WELCOME SETTINGS     ║\n` +
        `╚═══════════════════════════╝\n\n` +
        `👋 *Welcome:* ${c.welcomeOn ? "🟢 ON" : "🔴 OFF"}\n` +
        `🚪 *Goodbye:* ${c.goodbyeOn ? "🟢 ON" : "🔴 OFF"}\n\n` +
        `📝 *Welcome msg:*\n${c.welcomeMsg || "(default)"}\n\n` +
        `📝 *Goodbye msg:*\n${c.goodbyeMsg || "(default)"}\n\n` +
        `─────────────────────────\n` +
        `*.welcome on / off*\n` +
        `*.welcome set [message]*\n` +
        `*.welcome goodbye on / off*\n` +
        `*.welcome goodbye set [message]*\n\n` +
        `Placeholders: *{tag}*  *{user}*`,
    }, { quoted: msg })
  },
}
