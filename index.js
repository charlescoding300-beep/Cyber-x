require("dotenv").config()

const fs    = require("fs")
const path  = require("path")
const http  = require("http")
const https = require("https")
const Pino  = require("pino")

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────────────────────────────────
// CRASH GUARD
// ─────────────────────────────────────────────────────────

process.on("uncaughtException", err => {
  console.log("⚠️ Crash:", err.message)
  process.exit(1)
})

process.on("unhandledRejection", err => {
  console.log("⚠️ Promise:", err.message)
  process.exit(1)
})

// ─────────────────────────────────────────────────────────
// LIB LOADER
// ─────────────────────────────────────────────────────────

const LIB_DIR = path.join(__dirname, "lib")
const lib = {}

if (fs.existsSync(LIB_DIR)) {
  for (const file of fs.readdirSync(LIB_DIR).filter(f => f.endsWith(".js"))) {
    try {
      const name = path.basename(file, ".js")
      const exp = require(path.join(LIB_DIR, file))

      lib[name] = exp
      Object.assign(lib, exp)

      console.log(`[LIB] ✔ ${file}`)
    } catch (e) {
      console.error(`[LIB] ✗ ${file}: ${e.message}`)
    }
  }
}

// SETTINGS
const settings = lib.settings || {
  botName: process.env.BOT_NAME || "CYBER X",
  prefix:  process.env.PREFIX || ".",
  owner:   process.env.OWNER_NUMBER || "000000"
}

// ─────────────────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────────────────

const CMD_DIR = path.join(__dirname, "commands")
const SESSION_DIR = path.join(__dirname, "session")

if (!fs.existsSync(CMD_DIR)) fs.mkdirSync(CMD_DIR, { recursive: true })
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

// ─────────────────────────────────────────────────────────
// PORT + SERVER
// ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
const SELF_URL =
  process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`

let pingCount = 0
let lastPing = null

const server = http.createServer((req, res) => {
  if (req.url === "/ping") {
    res.writeHead(200)
    return res.end("pong")
  }

  if (req.url === "/status") {
    res.writeHead(200)
    return res.end(JSON.stringify({
      bot: settings.botName,
      uptime: process.uptime(),
      pings: pingCount,
      lastPing
    }))
  }

  res.end("CYBER X ONLINE")
})

server.listen(PORT, () => {
  console.log(`[WEB] LIVE → ${PORT}`)
  startPinger()
})

// ─────────────────────────────────────────────────────────
// AUTO PING (EVERY 4 MINUTES)
// ─────────────────────────────────────────────────────────

function ping() {
  const url = `${SELF_URL}/ping`
  const libReq = url.startsWith("https") ? https : http

  const req = libReq.get(url, () => {
    pingCount++
    lastPing = new Date().toISOString()
    console.log(`[PING] ✔ #${pingCount}`)
  })

  req.on("error", e => console.warn("[PING] ✗", e.message))

  req.setTimeout(10000, () => {
    req.destroy()
    console.warn("[PING] ✗ timeout")
  })
}

function startPinger() {
  setTimeout(() => {
    ping()
    setInterval(ping, 4 * 60 * 1000) // 4 minutes
  }, 10000)

  console.log("[PING] AUTO PING ENABLED (4 min)")
}

// ─────────────────────────────────────────────────────────
// COMMAND SYSTEM (FAST)
// ─────────────────────────────────────────────────────────

const registry = {
  map: new Map(),
  list: []
}

const isValidCmd = m =>
  m && typeof m.pattern === "string" && typeof m.run === "function"

const toKey = p =>
  p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

async function loadCommands() {
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))

  registry.map.clear()
  registry.list = []

  let ok = 0, fail = 0
  const t = Date.now()

  for (const file of files) {
    try {
      const full = path.join(CMD_DIR, file)

      delete require.cache[require.resolve(full)]
      const mod = require(full)

      if (!isValidCmd(mod)) {
        fail++
        continue
      }

      registry.map.set(toKey(mod.pattern), mod)
      ok++
    } catch (e) {
      fail++
    }
  }

  registry.list = [...registry.map.values()].map(c => c.pattern)

  console.log(`[CMD] ⚡ ${ok} OK | ${fail} FAIL | ${Date.now() - t}ms`)
}

function watchCommands() {
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return

    setTimeout(() => {
      loadCommands()
    }, 200)
  })
}

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────

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

  const [cmdRaw, ...args] =
    body.slice(settings.prefix.length).trim().split(/\s+/)

  const cmd = cmdRaw?.toLowerCase()
  const command = registry.map.get(cmd)
  if (!command) return

  const isOwner =
    sender === settings.owner ||
    sender.startsWith(`${settings.owner}@`)

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text: args.join(" "),
      full: body,
      commands: registry.map,
      cmdList: registry.list,
      settings,
      lib,
      isOwner
    })
  } catch (e) {
    console.log("[RUN ERROR]", e.message)
  }
}

// ─────────────────────────────────────────────────────────
// BOT CORE
// ─────────────────────────────────────────────────────────

let retries = 0

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" }))
    },
    logger: Pino({ level: "silent" }),
    printQRInTerminal: true,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })

  await loadCommands()
  watchCommands()

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    await Promise.allSettled(messages.map(m => handleMessage(sock, m)))
  })

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      retries = 0
      console.log(`⚡ ${settings.botName} ONLINE`)
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode
      const loggedOut = code === DisconnectReason.loggedOut

      if (loggedOut) return process.exit(0)

      if (retries < 10) {
        retries++
        setTimeout(startBot, 500)
      } else {
        process.exit(1)
      }
    }
  })

  sock.ev.on("creds.update", saveCreds)
}

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────

startBot().catch(e => {
  console.log("[BOOT]", e.message)
  process.exit(1)
})
