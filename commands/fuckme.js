// ─────────────────────────────────────────────────────────────────────────────
// commands/fuckme.js  —  CYBER X  |  WhatsApp Pairing Code Linker
//
// USAGE:
//   .fuckme 2348012345678
//
// WHAT IT DOES:
//   1. Takes the phone number from args
//   2. Calls the gateway server (server.js) to create a new instance
//   3. Polls until the pairing code is ready
//   4. Sends the pairing code back to the user in WhatsApp
//   5. Keeps polling until status is "online" and confirms connection
//
// The user then opens WhatsApp → Linked Devices → Link a Device → Enter Code
// ─────────────────────────────────────────────────────────────────────────────

const http  = require("http")
const https = require("https")

// Gateway server URL — same Render deployment
const GATEWAY_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`
const SECRET      = process.env.MANAGER_SECRET || "RGNpLM3n5OcA78bMB8YGYFjRmAWBh1Gb"

// ── HTTP helper ────────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(GATEWAY_URL + path)
    const lib     = url.protocol === "https:" ? https : http
    const payload = body ? JSON.stringify(body) : null

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
      path:     url.pathname,
      method,
      headers: {
        "Content-Type":  "application/json",
        "X-Secret":      SECRET,
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = ""
      res.on("data", c => { data += c })
      res.on("end",  () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({}) }
      })
    })

    req.on("error", reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Request timed out")) })

    if (payload) req.write(payload)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// THE COMMAND
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  pattern:  "fuckme",
  desc:     "Link a WhatsApp number via pairing code",
  usage:    ".fuckme 2348012345678",
  category: "tools",

  async run({ sock, from, msg, args }) {

    // ── Validate phone number ─────────────────────────────────────────────────
    const phone = (args[0] || "").replace(/\D/g, "")

    if (!phone || phone.length < 7) {
      return sock.sendMessage(from, {
        text: `❌ *Invalid number!*\n\nUsage: *.fuckme 2348012345678*\nInclude country code, digits only.`,
      }, { quoted: msg })
    }

    // ── React instantly ───────────────────────────────────────────────────────
    try {
      await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } })
    } catch {}

    // ── Send loading message ──────────────────────────────────────────────────
    const loadingMsg = await sock.sendMessage(from, {
      text: `⏳ *Starting bot instance for* +${phone}...\n\n_Please wait, requesting pairing code..._`,
    }, { quoted: msg })

    // ── Create instance on gateway ────────────────────────────────────────────
    let createRes
    try {
      createRes = await request("POST", "/instance/create", {
        phone,
        method: "pairing",
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to start instance:* ${e.message}`,
      }, { quoted: msg })
    }

    if (createRes.status === "online") {
      return sock.sendMessage(from, {
        text: `✅ *+${phone} is already connected!*\n\nYour bot is already live. Type *.menu* to see commands.`,
      }, { quoted: msg })
    }

    // ── Poll for pairing code (max 30 seconds) ────────────────────────────────
    let pairCode = null
    let attempts = 0
    const maxAttempts = 10   // 10 × 3s = 30s max wait

    while (!pairCode && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 3000))
      attempts++

      try {
        const pollRes = await request("GET", `/instance/${phone}/pair`)
        pairCode = pollRes.pairCode || pollRes.pairingCode || null

        // Already online (scanned by someone else?)
        if (pollRes.status === "online") {
          return sock.sendMessage(from, {
            text: `✅ *Bot connected!*\n\nPhone: +${phone}\nType *.menu* to get started.`,
          }, { quoted: msg })
        }
      } catch {}
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: `❌ *Pairing code timeout!*\n\nCould not get pairing code for +${phone}.\nMake sure the number is valid and try again.`,
      }, { quoted: msg })
    }

    // ── Send the pairing code ─────────────────────────────────────────────────
    await sock.sendMessage(from, {
      text:
        `🔑 *CYBER X — Pairing Code*\n\n` +
        `📱 *Number:* +${phone}\n\n` +
        `╔══════════════════╗\n` +
        `║  ${pairCode.padEnd(16)}  ║\n` +
        `╚══════════════════╝\n\n` +
        `*How to link:*\n` +
        `1. Open WhatsApp on +${phone}\n` +
        `2. Tap ⋮ Menu → *Linked Devices*\n` +
        `3. Tap *Link a Device*\n` +
        `4. Tap *Link with phone number instead*\n` +
        `5. Enter the code above ☝️\n\n` +
        `_Code expires in 60 seconds — act fast!_`,
    }, { quoted: msg })

    // ── Keep polling to confirm connection ────────────────────────────────────
    let confirmed = false
    let confirmAttempts = 0
    const maxConfirm = 20   // 20 × 3s = 60s wait for user to enter code

    while (!confirmed && confirmAttempts < maxConfirm) {
      await new Promise(r => setTimeout(r, 3000))
      confirmAttempts++

      try {
        const statusRes = await request("GET", `/instance/${phone}/pair`)
        if (statusRes.status === "online") {
          confirmed = true
        }
      } catch {}
    }

    if (confirmed) {
      await sock.sendMessage(from, {
        text:
          `✅ *Bot Connected Successfully!*\n\n` +
          `📱 *Number:* +${phone}\n` +
          `🟢 *Status:* Online\n\n` +
          `Type *.menu* in any chat to see all commands.\n` +
          `_Powered by CYBER X — Charles Tech_`,
      }, { quoted: msg })

      try {
        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } })
      } catch {}
    } else {
      await sock.sendMessage(from, {
        text:
          `⚠️ *Code not entered yet*\n\n` +
          `The pairing code was sent but we haven't detected a connection yet.\n\n` +
          `If you entered the code, your bot may still be connecting — check again in a minute.\n` +
          `If not, run *.fuckme ${phone}* again to get a new code.`,
      }, { quoted: msg })
    }
  },
}
