require("dotenv").config()

const fs = require("fs")
const path = require("path")
const http = require("http")
const https = require("https")
const Pino = require("pino")

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────
// SAFETY
// ─────────────────────────────

process.on("uncaughtException", err => console.log("⚠️", err.message))
process.on("unhandledRejection", err => console.log("⚠️", err?.message || err))

// ─────────────────────────────
// PATHS
// ─────────────────────────────

const CMD_DIR = path.join(__dirname, "commands")
const SESSION_DIR = path.join(__dirname, "session")

if (!fs.existsSync(CMD_DIR)) fs.mkdirSync(CMD_DIR, { recursive: true })
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

// ─────────────────────────────
// SETTINGS
// ─────────────────────────────

const settings = {
  botName: process.env.BOT_NAME || "CYBER X",
  prefix: process.env.PREFIX || ".",
  owner: process.env.OWNER_NUMBER || ""
}

// ─────────────────────────────
// WEB SERVER (RENDER KEEP ALIVE BASE)
// ─────────────────────────────

const PORT = process.env.PORT || 3000
const BASE_URL =
  process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`

let pingCount = 0

http.createServer((req, res) => {
  if (req.url === "/") return res.end("CYBER X ONLINE")
  if (req.url === "/ping") return res.end("pong")

  if (req.url === "/status") {
    return res.end(JSON.stringify({
      bot: settings.botName,
      uptime: process.uptime(),
      pings: pingCount
    }))
  }

  res.end("OK")
}).listen(PORT, () => {
  console.log(`[WEB] LIVE → ${PORT}`)
})

// ─────────────────────────────
// KEEP ALIVE PING SYSTEM
// ─────────────────────────────

function ping() {
  const url = `${BASE_URL}/ping`
  const lib = url.startsWith("https") ? https : http

  const req = lib.get(url, () => {
    pingCount++
    console.log(`[PING] #${pingCount}`)
  })

  req.on("error", () => {})
  req.setTimeout(8000, () => req.destroy())
}

setInterval(ping, 4 * 60 * 1000) // every 4 min

// ─────────────────────────────
// COMMAND SYSTEM (FAST LOAD)
// ─────────────────────────────

const registry = new Map()

function loadCommands() {
  registry.clear()

  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))

  for (const file of files) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]

      const cmd = require(full)
      if (!cmd?.pattern || !cmd?.run) continue

      const key = cmd.pattern
        .replace(/^[^a-z0-9]*/i, "")
        .toLowerCase()

      registry.set(key, cmd)
    } catch (e) {
      console.log("[CMD FAIL]", file)
    }
  }

  console.log(`[CMD] Loaded: ${registry.size}`)
}

loadCommands()

// reload safely (no spam loops)
fs.watch(CMD_DIR, () => loadCommands())

// ─────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────

function extractBody(msg) {
  const m = msg.message
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    ""
  )
}

async function handleMessage(sock, msg) {
  if (!msg?.message) return

  const body = extractBody(msg)
  if (!body.startsWith(settings.prefix)) return

  const from = msg.key.remoteJid
  const sender = msg.key.participant || from

  const raw = body.slice(settings.prefix.length).trim()
  const space = raw.indexOf(" ")

  const cmd = (space === -1 ? raw : raw.slice(0, space)).toLowerCase()
  const text = space === -1 ? "" : raw.slice(space + 1)

  const command = registry.get(cmd)
  if (!command) return

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      text,
      args: text ? text.split(/\s+/) : [],
      settings
    })
  } catch (e) {
    console.log("[CMD ERROR]", e.message)
  }
}

// ─────────────────────────────
// BOT CORE (STABLE + FAST)
// ─────────────────────────────

let running = false
let retries = 0

async function startBot() {
  if (running) return
  running = true

  console.log("[WA] Starting...")

  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION_DIR)

  const { version } =
    await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        Pino({ level: "silent" })
      )
    },
    logger: Pino({ level: "silent" }),
    printQRInTerminal: true
  })

  loadCommands()

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) handleMessage(sock, m)
  })

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(`⚡ ${settings.botName} ONLINE`)
      retries = 0
    }

    if (connection === "close") {
      running = false

      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut

      if (loggedOut) return console.log("Session expired")

      if (retries < 10) {
        retries++
        setTimeout(startBot, 2000)
      } else {
        process.exit(1)
      }
    }
  })

  sock.ev.on("creds.update", saveCreds)
}

startBot()
