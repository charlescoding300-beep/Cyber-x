"use strict"
// commands/fuckme.js — Multi-user pairing command
// Uses users/index.js engine for real WhatsApp sessions per user

const path = require("path")
const {
  sessions,
  startUserSession,
  restoreAllSessions,
  encodeUserSession,
  sleep,
} = require("../users/index")

module.exports = {
  pattern:  "pair",
  alias:    ["connect", "linkbot", "addbot"],
  desc:     "Link your WhatsApp number to get your own CYBER X bot session",
  usage:    ".pair <phone_with_country_code>",
  category: "tools",

  async run({ sock, from, msg, args, isOwner }) {
    const phone = (args[0] || "").replace(/\D/g, "")

    // ── Validation ────────────────────────────────────────────────────────────
    if (!phone || phone.length < 7) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Invalid number!*",
          "",
          "Usage: *.pair 2348012345678*",
          "Include country code, digits only.",
          "",
          "Example: *.pair 2348012345678*"
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Already online ────────────────────────────────────────────────────────
    const existing = sessions.get(phone)
    if (existing?.status === "online") {
      const sid = encodeUserSession(phone)
      return sock.sendMessage(from, {
        text: [
          "✅ *Already Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          sid
            ? `🔑 *Session ID:*\n${sid}\n\n_Save this in Render as SESSION_ID_${phone}_`
            : "Type *.menu* to see commands.",
          "",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (existing?.status === "connecting") {
      return sock.sendMessage(from, {
        text: [
          "⏳ *Already Connecting...*",
          `📱 *Number:* +${phone}`,
          "Please wait — pairing in progress."
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Start session ─────────────────────────────────────────────────────────
    try { await sock.sendMessage(from, { react: { text: "🔄", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "⏳ *Starting your CYBER X session...*",
        `📱 *Number:* +${phone}`,
        "🔄 Connecting to WhatsApp...",
        "",
        "_Requesting pairing code — wait 10–30s..._"
      ].join("\n")
    }, { quoted: msg })

    let pairCode  = null
    let connected = false
    let failed    = null

    try {
      await startUserSession(phone, {
        onCode:    code => { pairCode  = code },
        onConnect: ()   => { connected = true },
        onFail:    err  => { failed    = err  },
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to start session:*\n${e.message}`
      }, { quoted: msg })
    }

    // Wait up to 35s for code or instant connect (saved creds)
    for (let i = 0; i < 35; i++) {
      await sleep(1000)
      if (pairCode || connected || failed) break
    }

    if (failed) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Failed!*",
          `Reason: ${failed}`,
          "",
          `Retry: *.pair ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // Saved creds reconnected instantly — no code needed
    if (connected && !pairCode) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      const sid = encodeUserSession(phone)
      return sock.sendMessage(from, {
        text: [
          "✅ *Bot Reconnected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          sid
            ? `🔑 *Your Session ID:*\n\`${sid}\`\n\n_Paste as Render env var → SESSION_ID_${phone}_\n_Bot restores forever without pairing._`
            : "Type *.menu* for commands.",
          "",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Code Timeout!*",
          `Could not get code for +${phone}`,
          "• Check number is on WhatsApp",
          "• Check country code is correct",
          "",
          `Retry: *.pair ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Send pairing code ─────────────────────────────────────────────────────
    const fmt = pairCode.length === 8
      ? `${pairCode.slice(0, 4)}-${pairCode.slice(4)}`
      : pairCode

    try { await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "🔑 *CYBER X — Pairing Code*",
        "━━━━━━━━━━━━━━━━━━━━━━━━",
        `📱 *Number:* +${phone}`,
        "",
        "╔══════════════════════════╗",
        `║   *${fmt}*          ║`,
        "╚══════════════════════════╝",
        "",
        "*Steps to link:*",
        `1️⃣ Open WhatsApp on +${phone}`,
        "2️⃣ Tap ⋮ → *Linked Devices*",
        "3️⃣ Tap *Link a Device*",
        "4️⃣ Tap *Link with phone number instead*",
        "5️⃣ Enter the code above ☝️",
        "",
        "⏰ *Code expires in 60s — act fast!*",
        "",
        "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
      ].join("\n")
    }, { quoted: msg })

    // Wait up to 60s for user to enter code
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      if (connected) break
    }

    if (connected) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      const sid = encodeUserSession(phone)
      await sock.sendMessage(from, {
        text: [
          "✅ *Successfully Connected!*",
          "━━━━━━━━━━━━━━━━━━━━━━━━",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "• Type *.menu* for all commands",
          "• Prefix: *.*",
          "• Works in DMs and groups",
          "",
          sid
            ? `🔑 *Save your Session ID:*\n\`${sid}\`\n\n_Add to Render: SESSION_ID_${phone}=${sid}_\n_Your bot will never need pairing again._`
            : "",
          "",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].filter(l => l !== null).join("\n")
      }, { quoted: msg })
    } else {
      try { await sock.sendMessage(from, { react: { text: "⚠️", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "⚠️ *Code Not Confirmed Yet*",
          "",
          "Session is still running in background.",
          "• If you entered the code — wait 30s more",
          `• Get new code: *.pair ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }
  }
}
