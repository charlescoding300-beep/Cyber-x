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
  console.error("[CRASH]", err.message)
  // Do NOT exit — let the bot stay alive
})

process.on("unhandledRejection", err => {
  console.error("[PROMISE]", err?.message || err)
  // Do NOT exit — let the bot stay alive
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
      const exp  = require(path.join(LIB_DIR, file))
      lib[name]  = exp
      Object.assign(lib, exp)
      console.log(`[LIB] ✔ ${file}`)
    } catch (e) {
      console.error(`[LIB] ✗ ${file}: ${e.message}`)
    }
  }
}

// SETTINGS
const settings = lib.settings || {
  botName: process.env.BOT_NAME     || "CYBER X",
  prefix:  process.env.PREFIX       || ".",
  owner:   process.env.OWNER_NUMBER || "000000"
}

// ─────────────────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────────────────

const CMD_DIR     = path.join(__dirname, "commands")
const SESSION_DIR = path.join(__dirname, "session")

if (!fs.existsSync(CMD_DIR))     fs.mkdirSync(CMD_DIR,     { recursive: true })
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true })

// ─────────────────────────────────────────────────────────
// PORT + SERVER
// ─────────────────────────────────────────────────────────

const PORT     = process.env.PORT || 3000
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`

let pingCount = 0
let lastPing  = null

const server = http.createServer((req, res) => {
  if (req.url === "/ping") {
    res.writeHead(200)
    return res.end("pong")
  }
  if (req.url === "/status") {
    res.writeHead(200)
    return res.end(JSON.stringify({
      bot:      settings.botName,
      uptime:   process.uptime(),
      pings:    pingCount,
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
  const url    = `${SELF_URL}/ping`
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
    setInterval(ping, 4 * 60 * 1000)
  }, 10000)
  console.log("[PING] AUTO PING ENABLED (4 min)")
}

// ─────────────────────────────────────────────────────────
// COMMAND SYSTEM — ULTRA FAST ⚡
// ─────────────────────────────────────────────────────────

const registry = { map: new Map(), list: [] }

const isValidCmd = m =>
  m && typeof m.pattern === "string" && typeof m.run === "function"

const toKey = p =>
  p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

// ── Load a single file (used by full load + hot reload) ──
function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (!isValidCmd(mod)) return false
    registry.map.set(toKey(mod.pattern), mod)
    return true
  } catch (e) {
    console.error(`[CMD] ✗ ${file}: ${e.message}`)
    return false
  }
}

// ── Full load: ALL files in parallel ──
async function loadCommands() {
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))
  registry.map.clear()

  const t = Date.now()

  const results = await Promise.all(
    files.map(f => Promise.resolve(loadFile(f)))
  )

  const ok   = results.filter(Boolean).length
  const fail = results.length - ok

  registry.list = [...registry.map.values()].map(c => c.pattern)
  console.log(`[CMD] ⚡ ${ok} OK | ${fail} FAIL | ${Date.now() - t}ms`)
}

// ── Watch: reload ONLY the changed file ──
function watchCommands() {
  let debounceTimer = null
  fs.watch(CMD_DIR, { persistent: false }, (_, filename) => {
    if (!filename?.endsWith(".js")) return
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const ok = loadFile(filename)
      registry.list = [...registry.map.values()].map(c => c.pattern)
      console.log(`[CMD] ${ok ? "✔" : "✗"} Hot reloaded: ${filename}`)
    }, 150)
  })
}

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLER — OPTIMIZED ⚡
// ─────────────────────────────────────────────────────────

// Cached once at start — never recalculated per message
const PREFIX_LEN  = settings.prefix.length
const PREFIX_CHAR = settings.prefix[0]

function extractBody(msg) {
  const m = msg.message
  return (
    m?.conversation              ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption     ||
    m?.videoMessage?.caption     ||
    ""
  )
}

async function handleMessage(sock, msg) {
  if (!msg?.message) return

  const body = extractBody(msg)

  // ── Fast reject: char check before full startsWith ──
  if (!body || body[0] !== PREFIX_CHAR) return
  if (!body.startsWith(settings.prefix)) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from

  // ── Parse without regex — fastest possible split ──
  const slice    = body.slice(PREFIX_LEN).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  // ── Unknown command — bail immediately ──
  const command = registry.map.get(cmd)
  if (!command) return

  const isOwner =
    sender === settings.owner ||
    sender.startsWith(`${settings.owner}@`)

  let isAdmin    = false
  let isBotAdmin = false
  const isGroup  = from.endsWith("@g.us")

  if (isGroup) {
    try {
      const groupMeta = await sock.groupMetadata(from)
      const admins    = groupMeta.participants
        .filter(p => p.admin).map(p => p.id)
      isAdmin    = isOwner || admins.includes(sender)
      isBotAdmin = admins.includes(sock.user?.id?.replace(/:.*@/, "@"))
    } catch {}
  }

  try {
    await command.run({
      sock, from, msg, sender, args,
      text:     rest,
      full:     body,
      commands: registry.map,
      cmdList:  registry.list,
      settings, lib,
      isOwner, isGroup, isAdmin, isBotAdmin,
      extractBody
    })
  } catch (e) {
    console.error("[RUN ERROR]", e.message)
  }
}

// ─────────────────────────────────────────────────────────
// BOT CORE — STABLE RECONNECT ⚡
// ─────────────────────────────────────────────────────────

let retries    = 0
let botSocket  = null
const MAX_RETRIES = 20

// Exponential backoff: 1s → 2s → 4s → ... max 30s
function getDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 30000)
}

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
    const { version }          = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" }))
      },
      logger:                  Pino({ level: "silent" }),
      printQRInTerminal:       true,
      markOnlineOnConnect:     false,
      syncFullHistory:         false,
      keepAliveIntervalMs:     25000,   // ← keeps connection alive
      connectTimeoutMs:        60000,   // ← longer timeout before giving up
      retryRequestDelayMs:     2000,    // ← pause before retrying failed requests
      maxMsgRetryCount:        5,       // ← retry failed message sends
    })

    botSocket = sock

    await loadCommands()
    watchCommands()

    // ── Inject sock into antilink lib so it can act independently ──
    if (typeof lib.setSocket === "function") lib.setSocket(sock)

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      await Promise.allSettled(messages.map(m => handleMessage(sock, m)))

      // ── Antilink: delegated fully to lib/antilink.js ──
      if (typeof lib.handleAntilink === "function") {
        await Promise.allSettled(
          messages.map(m => lib.handleAntilink(sock, m, extractBody))
        )
      }
    })

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) console.log("[QR] Scan to connect")

      if (connection === "open") {
        retries = 0  // ← reset on successful connect
        console.log(`⚡ ${settings.botName} ONLINE`)
      }

      if (connection === "close") {
        const code      = lastDisconnect?.error?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        const forbidden = code === DisconnectReason.forbidden

        // Only hard-exit if truly logged out
        if (loggedOut || forbidden) {
          console.log("[BOT] Logged out — stopping")
          return process.exit(0)
        }

        if (retries < MAX_RETRIES) {
          const delay = getDelay(retries)
          console.log(`[BOT] ↺ Reconnecting in ${delay}ms (attempt ${retries + 1}/${MAX_RETRIES}) | code: ${code}`)
          retries++
          setTimeout(startBot, delay)
        } else {
          console.log("[BOT] Max retries hit — exiting for process manager restart")
          process.exit(1)
        }
      }
    })

    sock.ev.on("creds.update", saveCreds)

  } catch (e) {
    const delay = getDelay(retries)
    console.error("[BOOT ERROR]", e.message, `— retry in ${delay}ms`)
    retries++
    setTimeout(startBot, delay)
  }
}

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────

startBot()
