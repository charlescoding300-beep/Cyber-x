"use strict"

// ─────────────────────────────────────────────────────────────
// commands/setprefix.js — 𝗭Ξ𝗡 𝗫 SESSION PREFIX
//
// The prefix belongs to the individual WhatsApp session.
// It is persisted through settings.forUser(phone).
//
// Usage:
//   .setprefix !
//   .setprefix #
//   .setprefix reset
//   .prefix !
// ─────────────────────────────────────────────────────────────

module.exports = {
  pattern: "setprefix",
  alias: ["changeprefix", "prefix"],
  desc: "Change this session's command prefix",
  usage: ".setprefix ! | .setprefix reset",
  category: "utility",

  async run({ sock, from, msg, args, settings, isOwner }) {
    const reply = (text) =>
      sock.sendMessage(
        from,
        { text },
        { quoted: msg }
      )

    if (!isOwner) {
      return reply(
`❌ *ACCESS DENIED*

> Only the session owner can change the prefix.

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    }

    const input = String(args?.[0] || "").trim()

    // ── RESET ────────────────────────────────────────────────
    if (!input || input.toLowerCase() === "reset" || input.toLowerCase() === "default") {
      const defaultPrefix = process.env.BOT_PREFIX || "."

      try {
        settings.set("prefix", defaultPrefix)

        if (typeof settings.flush === "function") {
          settings.flush()
        }

        return reply(
`╔════════════════════╗
║  🔄 *PREFIX RESET*  ║
╚════════════════════╝

> Prefix: *${defaultPrefix}*
> 💾 Saved for this session
> 🔄 Survives VPS/PM2 restarts
> 🌐 Works in DMs and groups

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      } catch (error) {
        console.error("[PREFIX] Reset save failed:", error)

        return reply(
`❌ *PREFIX SAVE FAILED*

> The prefix could not be saved.

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
        )
      }
    }

    // ── VALIDATION ──────────────────────────────────────────
    if (input.length > 3) {
      return reply(
`❌ *INVALID PREFIX*

> Prefix must contain *1–3 characters*.

> Examples: *.  !  /  #  $*

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    }

    // ── SAVE ────────────────────────────────────────────────
    try {
      settings.set("prefix", input)

      if (typeof settings.flush === "function") {
        settings.flush()
      }

      return reply(
`╔════════════════════╗
║  ✅ *PREFIX SAVED*  ║
╚════════════════════╝

> New prefix: *${input}*
> 💾 Saved for this session
> 🔄 Survives VPS/PM2 restarts
> 🌐 Works in DMs and groups

> Use *${input}menu* to test it.

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    } catch (error) {
      console.error("[PREFIX] Save failed:", error)

      return reply(
`❌ *PREFIX SAVE FAILED*

> The new prefix could not be saved.

> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`
      )
    }
  }
}
