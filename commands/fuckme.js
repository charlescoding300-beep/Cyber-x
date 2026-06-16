const Pino  = require("pino")
const path  = require("path")
const fs    = require("fs")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys")

// Sessions stored separately per user
const SESSIONS_ROOT = path.join(__dirname, "../sessions")
if (!fs.existsSync(SESSIONS_ROOT)) fs.mkdirSync(SESSIONS_ROOT, { recursive: true })

// Track active user sessions
const userSessions = new Map()

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Load commands for a user session
function loadUserCommands(sock, sessionEntry) {
  const CMD_DIR = path.join(__dirname, "../commands")
  const map     = new Map()

  if (!fs.existsSync(CMD_DIR)) return map

  for (const file of fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))) {
    if (file === "fuckme.js") continue // skip self
    try {
      const mod = require(path.join(CMD_DIR, file))
      if (mod && typeof mod.pattern === "string" && typeof mod.run === "function") {
        const key = mod.pattern.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()
        map.set(key, mod)
        if (Array.isArray(mod.alias))
          for (const a of mod.alias)
            map.set(a.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim(), mod)
      }
    } catch {}
  }

  console.log(`[FUCKME] ⚡ ${map.size} commands loaded for session`)
  return map
}

// Handle messages for a user session
async function handleUserMessage(sock, msg, cmdMap, owner) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const m = msg.message
  const inner =
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message  ||
    m
  const body = (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption || ""
  )

  if (!body.startsWith(".")) return

  const from    = msg.key.remoteJid
  const sender  = msg.key.participant || from
  const slice   = body.slice(1).trimStart()
  const space   = slice.indexOf(" ")
  const rawCmd  = (space === -1 ? slice : slice.slice(0, space)).toLowerCase()
  const rest    = space === -1 ? "" : slice.slice(space + 1).trim()
  const args    = rest ? rest.split(/\s+/) : []

  const command = cmdMap.get(rawCmd)
  if (!command) return

  const isGroup = from.endsWith("@g.us")
  const isOwner = (sender || "").includes(owner)

  console.log(`[USER-CMD] ▶ ${rawCmd} | from:${sender.split("@")[0]}`)

  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      isOwner, isGroup,
      cmdList: [...cmdMap.keys()].map(k => `.${k}`).sort(),
    })
  } catch (e) {
    console.error(`[USER-CMD ERR] ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ Error in ${rawCmd}: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}

// Start a real WhatsApp session for a user
async function startUserSession(phone, onPairCode, onConnected, onFail) {
  const sessionDir = path.join(SESSIONS_ROOT, phone)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })),
    },
    logger:              Pino({ level: "silent" }),
    printQRInTerminal:   false,
    markOnlineOnConnect: false,
    syncFullHistory:     false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs:    60000,
  })

  // Request pairing code
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone)
        console.log(`[FUCKME] 🔑 Pair code for ${phone}: ${code}`)
        if (onPairCode) onPairCode(code)
      } catch (e) {
        console.error(`[FUCKME] Pair code error:`, e.message)
        if (onFail) onFail(e.message)
      }
    }, 3000)
  }

  const cmdMap = loadUserCommands(sock)

  const BOT_START = Math.floor(Date.now() / 1000)

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) {
      if ((Number(m.messageTimestamp) || 0) < BOT_START - 15) continue
      handleUserMessage(sock, m, cmdMap, phone).catch(() => {})
    }
  })

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(`[FUCKME] ✅ ${phone} connected!`)
      userSessions.set(phone, { sock, status: "online", cmdMap })
      if (onConnected) onConnected()
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        userSessions.delete(phone)
        try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
      }
    }
  })

  sock.ev.on("creds.update", saveCreds)

  userSessions.set(phone, { sock, status: "connecting", cmdMap })
  return sock
}

module.exports = {
  pattern:  "fuckme",
  alias:    ["linkbot", "connect", "pair"],
  desc:     "Link your WhatsApp to CYBER X bot via pairing code",
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
          "• Digits only — no + or spaces",
          "",
          "Example: *.fuckme 2348012345678*"
        ].join("\n")
      }, { quoted: msg })
    }

    // Already connected
    const existing = userSessions.get(phone)
    if (existing?.status === "online") {
      return sock.sendMessage(from, {
        text: [
          "✅ *Already Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online",
          "",
          "Your bot is already running!",
          "Type *.menu* to see commands."
        ].join("\n")
      }, { quoted: msg })
    }

    try { await sock.sendMessage(from, { react: { text: "🔄", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "⏳ *Starting CYBER X for your number...*",
        "",
        `📱 *Number:* +${phone}`,
        "🔄 *Status:* Connecting to WhatsApp...",
        "",
        "_Requesting pairing code — 10-30 seconds..._"
      ].join("\n")
    }, { quoted: msg })

    // Start real WhatsApp session
    let pairCode    = null
    let connected   = false
    let failed      = null

    try {
      await startUserSession(
        phone,
        (code) => { pairCode = code },
        ()     => { connected = true },
        (err)  => { failed = err },
      )
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to start session:*\n${e.message}`
      }, { quoted: msg })
    }

    // Wait for pairing code — max 35 seconds
    for (let i = 0; i < 35; i++) {
      await sleep(1000)
      if (pairCode || connected || failed) break
    }

    if (failed) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Failed!*",
          "",
          `Reason: ${failed}`,
          "",
          `Try again: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    if (connected) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      return sock.sendMessage(from, {
        text: [
          "✅ *Bot Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "Type *.menu* to see all commands.",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Code Timeout!*",
          "",
          `Could not get code for +${phone}`,
          "• Check the number is on WhatsApp",
          "• Make sure country code is correct",
          "",
          `Retry: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // Send pairing code to user
    const formatted = pairCode.length === 8
      ? pairCode.slice(0, 4) + "-" + pairCode.slice(4)
      : pairCode

    try { await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "🔑 *CYBER X — WhatsApp Pairing Code*",
        "━━━━━━━━━━━━━━━━━━━━",
        `📱 *Number:* +${phone}`,
        "",
        "╔══════════════════════╗",
        `║   *${formatted}*   ║`,
        "╚══════════════════════╝",
        "",
        "*How to link:*",
        `1️⃣ Open WhatsApp on +${phone}`,
        "2️⃣ Tap ⋮ Menu → *Linked Devices*",
        "3️⃣ Tap *Link a Device*",
        "4️⃣ Tap *Link with phone number instead*",
        "5️⃣ Enter the code above ☝️",
        "",
        "⏰ *Act fast — code expires in 60s!*",
        "",
        "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
      ].join("\n")
    }, { quoted: msg })

    // Wait for connection — max 60 seconds
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
          "• Type *.menu* to see all commands",
          "• Bot responds to prefix *.*",
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
          "We're still waiting for you to enter the code.",
          "Your session is still active in background.",
          "",
          `• If entered — wait 30 more seconds`,
          `• To get new code: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }
  }
}
