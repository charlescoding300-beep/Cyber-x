"use strict"

// ─────────────────────────────────────────────────────────────
// commands/mode.js — 𝗭Ξ𝗡 𝗫 SESSION MODE
//
// Each WhatsApp session has its OWN persistent mode.
// The setting is stored through settings.forUser(phone), so
// private/public mode survives PM2/VPS restarts.
//
// Usage:
//   .mode private  → only the session owner can use commands
//   .mode public   → everyone can use commands
//   .mode status   → show current mode
//   .mode          → show current mode
// ─────────────────────────────────────────────────────────────

module.exports = {
  pattern: "mode",
  desc: "Set this session to private or public",
  category: "settings",

  async run({ sock, from, msg, settings, args, isOwner }) {
    // ── Every response is quoted to the command sender ─────────
    const reply = (text) =>
      sock.sendMessage(
        from,
        { text },
        { quoted: msg }
      )

    // ── Only the session owner may change the mode ─────────────
    if (!isOwner) {
      return reply(
`❌ *ACCESS DENIED*

> Only the *session owner* can change this setting.
> Your message has not changed the current mode.

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    }

    const sub = String(args?.[0] || "")
      .toLowerCase()
      .trim()

    // ── Current persistent mode ────────────────────────────────
    const current = String(settings.get("mode") || "public")
      .toLowerCase()

    // ── PRIVATE MODE ──────────────────────────────────────────
    if (sub === "private") {
      try {
        settings.set("mode", "private")

        // Immediately flush the per-session file when supported.
        // This prevents the setting from waiting for the debounce.
        if (typeof settings.flush === "function") {
          settings.flush()
        }

        return reply(
`╔════════════════════╗
║  🔒 *PRIVATE MODE*  ║
╚════════════════════╝

┌─────〔 ✅ *SAVED* 〕─────
│ 🔐 Only YOU can trigger commands
│ 👥 Everyone else is ignored
│ 💾 Setting is saved for this session
│ 🔄 It survives VPS/PM2 restarts
│
│ 🌐 Use *.mode public* to reverse this
└──────────────────────────

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      } catch (error) {
        console.error("[MODE] Failed to save private mode:", error)

        return reply(
`❌ *MODE SAVE FAILED*

> The private mode could not be saved.
> Current mode remains: *${current.toUpperCase()}*

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      }
    }

    // ── PUBLIC MODE ───────────────────────────────────────────
    if (sub === "public") {
      try {
        settings.set("mode", "public")

        // Immediately flush the per-session file when supported.
        if (typeof settings.flush === "function") {
          settings.flush()
        }

        return reply(
`╔════════════════════╗
║  🌐 *PUBLIC MODE*   ║
╚════════════════════╝

┌─────〔 ✅ *SAVED* 〕─────
│ 👥 Anyone can trigger commands
│ 🔓 Session is publicly usable
│ 💾 Setting is saved for this session
│ 🔄 It survives VPS/PM2 restarts
│
│ 🔒 Use *.mode private* to restrict this
└──────────────────────────

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      } catch (error) {
        console.error("[MODE] Failed to save public mode:", error)

        return reply(
`❌ *MODE SAVE FAILED*

> The public mode could not be saved.
> Current mode remains: *${current.toUpperCase()}*

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      }
    }

    // ── STATUS / NO ARGUMENT / INVALID ARGUMENT ───────────────
    if (sub && sub !== "status") {
      return reply(
`❌ *INVALID MODE*

> Current mode: *${current.toUpperCase()}*

> Use:
> *.mode private*
> *.mode public*
> *.mode status*

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    }

    return reply(
`╔════════════════════╗
║  📊 *MODE STATUS*   ║
╚════════════════════╝

┌─────〔 ℹ️ *SESSION* 〕─────
│ Current mode: *${current.toUpperCase()}*
│
│ 🔒 *.mode private*
│    Owner-only commands
│
│ 🌐 *.mode public*
│    Everyone can use commands
│
│ 💾 Persistent per session
└──────────────────────────

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
    )
  }
}
