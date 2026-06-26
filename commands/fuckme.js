'use strict'

module.exports = {
  pattern:  "fuckme",
  alias:    ["addbot", "connect"],
  desc:     "Connect your WhatsApp number to CYBER X",
  category: "SYSTEM",

  async run({ sock, from, msg, sender, args, helper }) {

    // ── Get phone from args OR use the sender's own number ────
    let phone = args[0]?.replace(/\D/g, "")

    // If no number provided, use their own number automatically
    if (!phone || phone.length < 7) {
      phone = (msg.key.participant || msg.key.remoteJid || sender)
        .replace("@s.whatsapp.net", "")
        .replace("@g.us", "")
        .replace(/:\d+$/, "")
        .replace(/\D/g, "")
    }

    if (!phone || phone.length < 7) {
      return helper.reply(sock, msg,
        `╭━━━〔 📱 *CYBER X — CONNECT* 〕━━━╮\n` +
        `┃\n` +
        `┃ Usage: *.fuckme <your number>*\n` +
        `┃ Example: .fuckme 2348012345678\n` +
        `┃\n` +
        `┃ • Include your country code\n` +
        `┃ • No + or spaces needed\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        `© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      )
    }

    await helper.react(sock, msg, "⏳")

    try {
      const { addSession, listBots } = require("../index")
      const result = await addSession(phone)

      if (result.pairingCode) {
        // ── Send instructions ─────────────────────────────────
        await helper.reply(sock, msg,
          `╭━━━〔 📱 *CYBER X — PAIRING* 〕━━━╮\n` +
          `┃\n` +
          `┃ 📞 *Number:* +${result.phone}\n` +
          `┃ ✅ *Status:* Code Generated\n` +
          `┃\n` +
          `┃ 📋 *How to link:*\n` +
          `┃ 1. Open WhatsApp on your phone\n` +
          `┃ 2. Tap ⋮ Menu → Linked Devices\n` +
          `┃ 3. Tap *Link with phone number*\n` +
          `┃ 4. Enter the code below 👇\n` +
          `┃\n` +
          `┃ ⏳ Code expires in *60 seconds*\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        )

        // ── Send the code alone — easy to copy ────────────────
        await sock.sendMessage(from, { text: `*${result.pairingCode}*` })

        // ── Watch for 65 seconds to confirm connection ────────
        let connected = false
        for (let i = 0; i < 13; i++) {
          await new Promise(r => setTimeout(r, 5000))
          const bots = listBots()
          const bot  = bots.find(b => b.phone === result.phone)
          if (bot?.connected) { connected = true; break }
        }

        if (connected) {
          await helper.react(sock, msg, "✅")
          await helper.reply(sock, msg,
            `╭━━━〔 ✅ *CYBER X — CONNECTED* 〕━━━╮\n` +
            `┃\n` +
            `┃ 📞 *Number:* +${result.phone}\n` +
            `┃ 🟢 *Status:* Successfully Connected!\n` +
            `┃\n` +
            `┃ Your WhatsApp is now linked\n` +
            `┃ to CYBER X. Enjoy! 🔥\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
          )
        } else {
          await helper.react(sock, msg, "❌")
          await helper.reply(sock, msg,
            `╭━━━〔 ⏰ *CODE EXPIRED* 〕━━━╮\n` +
            `┃\n` +
            `┃ 📞 *Number:* +${result.phone}\n` +
            `┃ ❌ *Status:* Code Expired\n` +
            `┃\n` +
            `┃ You did not enter the code\n` +
            `┃ within 60 seconds.\n` +
            `┃\n` +
            `┃ Run *.fuckme ${result.phone}*\n` +
            `┃ again to get a new code.\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
          )
        }

      } else if (result.connected) {
        await helper.react(sock, msg, "✅")
        await helper.reply(sock, msg,
          `╭━━━〔 📱 *CYBER X — ALREADY LINKED* 〕━━━╮\n` +
          `┃\n` +
          `┃ 📞 *Number:* +${result.phone}\n` +
          `┃ 🟢 *Status:* Already Connected\n` +
          `┃\n` +
          `┃ Your WhatsApp is already\n` +
          `┃ linked to CYBER X! 🔥\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
          `© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        )
      } else {
        await helper.react(sock, msg, "❌")
        await helper.reply(sock, msg,
          `╭━━━〔 ❌ *CYBER X — FAILED* 〕━━━╮\n` +
          `┃\n` +
          `┃ 📞 *Number:* +${result.phone}\n` +
          `┃ ❌ Could not generate pairing code.\n` +
          `┃ Please try again.\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        )
      }

    } catch (e) {
      await helper.react(sock, msg, "❌")
      await helper.reply(sock, msg,
        `╭━━━〔 ❌ *CYBER X — ERROR* 〕━━━╮\n` +
        `┃\n` +
        `┃ Failed to connect:\n` +
        `┃ ${e.message}\n` +
        `┃\n` +
        `┃ Please try again or contact\n` +
        `┃ the bot owner for help.\n` +
        `┃\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━━╯`
      )
    }
  },
}
