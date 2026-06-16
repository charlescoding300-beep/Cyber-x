const http  = require("http")
const https = require("https")

// Points to server.js (port 4000)
const GATEWAY = process.env.GATEWAY_URL
  || `http://localhost:${process.env.GATEWAY_PORT || 4000}`
const SECRET  = process.env.MANAGER_SECRET || "RGNpLM3n5OcA78bMB8YGYFjRmAWBh1Gb"

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(GATEWAY + endpoint)
    const isHttps = url.protocol === "https:"
    const lib     = isHttps ? https : http
    const payload = body ? JSON.stringify(body) : null

    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Secret":     SECRET,
      },
    }
    if (payload) options.headers["Content-Length"] = Buffer.byteLength(payload)

    const req = lib.request(options, res => {
      let data = ""
      res.on("data", c => data += c)
      res.on("end", () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }) }
        catch { resolve({ ok: false, status: res.statusCode, data: {} }) }
      })
    })

    req.on("error", e => reject(e))
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")) })
    if (payload) req.write(payload)
    req.end()
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = {
  pattern:  "fuckme",
  alias:    ["linkbot", "connect"],
  desc:     "Link a WhatsApp number to CYBER X bot via pairing code",
  usage:    ".fuckme 2348012345678",
  category: "tools",

  async run({ sock, from, msg, args }) {
    const phone = (args[0] || "").replace(/\D/g, "")

    if (!phone || phone.length < 7) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Invalid number!*",
          "",
          "Usage: *.fuckme 2348012345678*",
          "• Include country code",
          "• Digits only, no + or spaces",
          "",
          "Example: *.fuckme 2348012345678*"
        ].join("\n")
      }, { quoted: msg })
    }

    // React to show we received it
    try { await sock.sendMessage(from, { react: { text: "🔄", key: msg.key } }) } catch {}

    // ── Check if already connected ──────────────────────────
    try {
      const check = await request("GET", `/instance/${phone}`)
      if (check.data?.status === "online") {
        try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
        return sock.sendMessage(from, {
          text: [
            "✅ *Already Connected!*",
            "",
            `📱 *Number:* +${phone}`,
            "🟢 *Status:* Online",
            "",
            "Your bot is already live and running!",
            "Type *.menu* to see all commands."
          ].join("\n")
        }, { quoted: msg })
      }
    } catch {}

    // ── Send starting message ───────────────────────────────
    await sock.sendMessage(from, {
      text: [
        "⏳ *Starting CYBER X for your number...*",
        "",
        `📱 Number: +${phone}`,
        "🔄 Status: Initializing...",
        "",
        "_This takes 10-30 seconds. Hang on..._"
      ].join("\n")
    }, { quoted: msg })

    // ── Create instance on server.js ────────────────────────
    let created
    try {
      created = await request("POST", "/instance/create", { phone, label: `User ${phone}` })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Server error:* ${e.message}\n\nMake sure server.js is running.`
      }, { quoted: msg })
    }

    if (!created.ok && created.data?.error !== "Instance already exists") {
      return sock.sendMessage(from, {
        text: `❌ *Failed:* ${created.data?.error || "Unknown error"}`
      }, { quoted: msg })
    }

    // ── Poll for pairing code — max 40 seconds ──────────────
    let pairCode = null
    console.log(`[FUCKME] Polling for pair code: ${phone}`)

    for (let i = 0; i < 13; i++) {
      await sleep(3000)
      try {
        const poll = await request("GET", `/instance/${phone}/pair`)
        const d    = poll.data

        if (d?.status === "online") {
          try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
          return sock.sendMessage(from, {
            text: [
              "✅ *Bot Connected!*",
              "",
              `📱 *Number:* +${phone}`,
              "🟢 *Status:* Online",
              "",
              "Type *.menu* to see all commands.",
              "_Powered by CYBER X_"
            ].join("\n")
          }, { quoted: msg })
        }

        if (d?.pairCode) {
          pairCode = d.pairCode
          break
        }
      } catch {}
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing code timeout!*",
          "",
          `Could not get pairing code for +${phone}.`,
          "",
          "Possible reasons:",
          "• Number not registered on WhatsApp",
          "• Server taking too long",
          "• Invalid phone number",
          "",
          `Try again: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Send pairing code to user ───────────────────────────
    const formatted = pairCode.includes("-")
      ? pairCode
      : pairCode.slice(0, 4) + "-" + pairCode.slice(4)

    await sock.sendMessage(from, {
      text: [
        "🔑 *CYBER X — WhatsApp Pairing Code*",
        "━━━━━━━━━━━━━━━━━━━━",
        `📱 *Number:* +${phone}`,
        "",
        "╔══════════════════════╗",
        `║   ${formatted.padEnd(18)}  ║`,
        "╚══════════════════════╝",
        "",
        "*Steps to link:*",
        `1. Open WhatsApp on +${phone}`,
        "2. Tap ⋮ (3 dots) → *Linked Devices*",
        "3. Tap *Link a Device*",
        "4. Tap *Link with phone number instead*",
        "5. Enter the code above ☝️",
        "",
        "⏰ *Code expires in 60 seconds!*",
        "_Act fast before it expires_",
        "",
        "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
      ].join("\n")
    }, { quoted: msg })

    try { await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } }) } catch {}

    // ── Poll for confirmation — max 60 seconds ──────────────
    let connected = false
    for (let i = 0; i < 20; i++) {
      await sleep(3000)
      try {
        const s = await request("GET", `/instance/${phone}/pair`)
        if (s.data?.status === "online") { connected = true; break }
      } catch {}
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
          "*Your bot is now live!*",
          "• Type *.menu* to see all commands",
          "• Bot responds to prefix: *.*",
          "• Works in groups and DMs",
          "",
          "_Powered by CYBER X — All Rights Reserved_",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    } else {
      try { await sock.sendMessage(from, { react: { text: "⚠️", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "⚠️ *Code Not Entered Yet*",
          "",
          "We sent the code but no connection detected.",
          "",
          "• If you entered it — wait 30 more seconds",
          "• Bot may still be connecting in background",
          `• To retry: *.fuckme ${phone}*`,
          "",
          "If problems persist, contact the bot owner."
        ].join("\n")
      }, { quoted: msg })
    }
  }
}
