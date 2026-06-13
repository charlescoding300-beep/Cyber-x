// ─────────────────────────────────────────────────────────
// commands/owner.js — CYBER X
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "owner",
  desc:     "Show bot owner contact info",
  usage:    ".owner",
  category: "general",

  async run({ sock, from, msg, settings }) {

    const caption =
`╔══════════════════════════════╗
║      👑 *BOT OWNER INFO*      ║
╚══════════════════════════════╝

┌─────〔 📱 *CONTACT NUMBERS* 〕─────
│
│  1️⃣  *+256 700 236103*
│  2️⃣  *+234 812 038 2097*
│  3️⃣  *+234 811 775 0075*
│
│ ℹ️ _All the same owner by_
│    *CYBER X* _— different numbers_
│
└──────────────────────────────
> 🤖 *Bot:* ${settings?.botName || "CYBER X"}
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

    return sock.sendMessage(from, {
      image:   { url: "https://i.imgur.com/4m7tYk9.jpeg" },
      caption,
      quoted:  msg
    })
  }
}
