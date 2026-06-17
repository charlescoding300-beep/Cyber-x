"use strict"

// fuckme.js — now just a thin wrapper around lib/session
// All socket/session logic lives in lib/session.js

module.exports = {
  pattern:  "fuckme",
  alias:    ["linkbot", "connect", "pair"],
  desc:     "Link your WhatsApp number to CYBER X — get your own bot session",
  usage:    ".fuckme <phone_with_country_code>",
  category: "tools",

  async run({ sock, from, msg, args }) {
    const sessionLib = require("../lib/session")
    const phone = (args[0] || "").replace(/\D/g, "")

    if (!phone || phone.length < 7) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Invalid number!*",
          "",
          "Usage: *.fuckme 2348012345678*",
          "• Include country code (no + or spaces)",
          "",
          "Or visit the pair page:",
          `${process.env.RENDER_EXTERNAL_URL || ""}/pair`
        ].join("\n")
      }, { quoted: msg })
    }

    const existing = sessionLib.getSession(phone)
    if (existing?.status === "online") {
      return sock.sendMessage(from, {
        text: [
          "✅ *Already Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "Open that WhatsApp and type *.menu*",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (existing?.status === "connecting") {
      return sock.sendMessage(from, {
        text: [
          "⏳ *Already Connecting...*",
          `📱 *Number:* +${phone}`,
          "Please wait — pairing code is being generated.",
        ].join("\n")
      }, { quoted: msg })
    }

    try { await sock.sendMessage(from, { react: { text: "🔄", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "⏳ *Starting CYBER X session...*",
        `📱 *Number:* +${phone}`,
        "🔄 Connecting to WhatsApp...",
        "_Requesting pairing code — please wait..._"
      ].join("\n")
    }, { quoted: msg })

    let pairCode  = null
    let connected = false
    let failed    = null
    const sleep   = ms => new Promise(r => setTimeout(r, ms))

    try {
      await sessionLib.startSession(phone, {
        onPairCode:  code => { pairCode  = code },
        onConnected: ()   => { connected = true },
        onFail:      err  => { failed    = err  },
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to start session:*\n${e.message}`
      }, { quoted: msg })
    }

    // Wait up to 40s for pair code or result
    for (let i = 0; i < 40; i++) {
      await sleep(1000)
      if (pairCode || connected || failed) break
    }

    if (failed) {
      return sock.sendMessage(from, {
        text: `❌ *Pairing Failed!*\nReason: ${failed}\n\nRetry: *.fuckme ${phone}*`
      }, { quoted: msg })
    }

    if (connected && !pairCode) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      return sock.sendMessage(from, {
        text: [
          "✅ *Bot Reconnected!*",
          `📱 *Number:* +${phone}`,
          "🟢 Status: Online & Running",
          "",
          "Open that WhatsApp and type *.menu*",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Code Timeout!*",
          `Could not get code for +${phone}`,
          "• Make sure the number is on WhatsApp",
          "• Check your country code is correct",
          "",
          `Retry: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    const formatted = pairCode.length === 8
      ? `${pairCode.slice(0, 4)}-${pairCode.slice(4)}`
      : pairCode

    try { await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "🔑 *CYBER X — Pairing Code*",
        "━━━━━━━━━━━━━━━━━━━━",
        `📱 *Number:* +${phone}`,
        "",
        "╔══════════════════════╗",
        `║   *${formatted}*   ║`,
        "╚══════════════════════╝",
        "",
        "*How to link:*",
        `1️⃣ Open WhatsApp on +${phone}`,
        "2️⃣ Tap ⋮ → *Linked Devices*",
        "3️⃣ Tap *Link a Device*",
        "4️⃣ Tap *Link with phone number instead*",
        "5️⃣ Enter the code above ☝️",
        "",
        "⏰ *Act fast — expires in 60s!*",
        "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
      ].join("\n")
    }, { quoted: msg })

    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      if (connected) break
    }

    if (connected) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "✅ *Successfully Connected!*",
          "━━━━━━━━━━━━━━━━━━━━",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "• Open that WhatsApp — your bot sent you a password",
          "• Type *.owner <password>* to unlock owner commands",
          "• Then type *.menu* to see everything",
          "",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    } else {
      try { await sock.sendMessage(from, { react: { text: "⚠️", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "⚠️ *Code Not Confirmed Yet*",
          "Session is still running in background.",
          "• If you entered the code — wait 30s more",
          `• Need new code: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }
  },
}
