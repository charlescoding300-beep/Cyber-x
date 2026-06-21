// ─────────────────────────────────────────────────────────────────────────────
// commands/owner.js  —  CYBER X
//
// USAGE:
//   .owner   → sends a tappable vCard contact card for THIS bot's own linked
//              WhatsApp number. Tapping it opens a chat with that number.
//
// Multi-session aware: reads sock.user.id, which is THIS session's own
// connected account — not a fixed OWNER_NUMBER from .env. So each linked
// bot account returns its own number, correctly, with zero index.js edits.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  "owner",
  alias:    ["creator", "dev", "botowner"],
  desc:     "Show this bot's own linked WhatsApp number as a contact card",
  usage:    ".owner",
  category: "general",

  async run({ sock, from, msg }) {
    // sock.user.id looks like "1234567890:12@s.whatsapp.net" — strip the
    // device suffix (":12") and domain, same normalization index.js already
    // does in normalizeNum().
    const rawId = sock.user?.id || ""
    const num   = rawId.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()

    if (!num) {
      return sock.sendMessage(from, {
        text: "❌ Could not read this bot's linked number."
      }, { quoted: msg })
    }

    const displayName = sock.user?.name || sock.user?.notify || "CYBER X"

    const vcard =
      `BEGIN:VCARD\n` +
      `VERSION:3.0\n` +
      `FN:${displayName}\n` +
      `TEL;type=CELL;type=VOICE;waid=${num}:+${num}\n` +
      `END:VCARD`

    return sock.sendMessage(from, {
      contacts: {
        displayName,
        contacts: [{ vcard }],
      }
    }, { quoted: msg })
  },
}
