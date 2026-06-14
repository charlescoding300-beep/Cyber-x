// ─────────────────────────────────────────────────────────────────────────────
// lib/guard.js  —  CYBER X
//
// Piggybacks on the handleAntilink hook that index.js already calls for
// EVERY message. We use it to:
//   1. Enforce PRIVATE MODE — silently drop commands from non-owners
//   2. Pass through everything else untouched
//
// index.js calls:  lib.handleAntilink(sock, m, extractBody)
// So this file exports handleAntilink and it gets merged into lib automatically.
// ─────────────────────────────────────────────────────────────────────────────

async function handleAntilink(sock, msg, extractBody) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  if (msg.key.fromMe) return

  const settings = require("./settings")

  // ── Private mode — silently ignore non-owner commands ─────────────────────
  if (settings.get("mode") === "private") {
    const body = extractBody(msg)
    const prefix = settings.get("prefix") || "."
    if (body.startsWith(prefix)) {
      const from   = msg.key.remoteJid
      const sender = msg.key.participant || from
      const ownerBase = (settings.get("owner") || "").replace(/\D/g, "")
      const isOwner   = ownerBase
        ? sender === ownerBase ||
          sender.startsWith(`${ownerBase}@`) ||
          sender.indexOf(ownerBase) !== -1
        : false

      if (!isOwner) {
        // Silent drop — owner hasn't made the bot public
        // Optionally send a hint (commented out — enable if you want):
        // await sock.sendMessage(from, { text: "🔒 Bot is in private mode." })
        return
      }
    }
  }

  // ── Anti-link (if you have a separate antilink lib, call it here) ─────────
  // If lib/antilink.js exists separately, its handleAntilink is already in lib
  // This guard only adds private mode on top — no double processing
}

module.exports = { handleAntilink }
