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

process.on("uncaughtException",  err => console.error("[CRASH]",   err.message))
process.on("unhandledRejection", err => console.error("[PROMISE]", err?.message || err))

// ─────────────────────────────────────────────────────────
// MANUAL IN-MEMORY STORE (group metadata lives here in RAM)
// Replaces makeInMemoryStore which was removed in newer Baileys
// ─────────────────────────────────────────────────────────

const store = { groupMetadata: {} }

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

const settings = lib.settings || {
  botName: process.env.BOT_NAME     || "CYBER X",
  prefix:  process.env.PREFIX       || ".",
  owner:   process.env.OWNER_NUMBER || ""
}

if (!settings.owner) {
  console.warn("[WARN] OWNER_NUMBER is not set — owner-only commands won't work!")
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
  const req    = libReq.get(url, () => {
    pingCount++
    lastPing = new Date().toISOString()
    console.log(`[PING] ✔ #${pingCount}`)
  })
  req.on("error", e => console.warn("[PING] ✗", e.message))
  req.setTimeout(10000, () => { req.destroy(); console.warn("[PING] ✗ timeout") })
}

function startPinger() {
  setTimeout(() => { ping(); setInterval(ping, 4 * 60 * 1000) }, 10000)
  console.log("[PING] AUTO PING ENABLED (4 min)")
}

// ─────────────────────────────────────────────────────────
// COMMAND REGISTRY
// ─────────────────────────────────────────────────────────

const registry = {
  map:     new Map(),
  list:    [],
  details: []
}

const isValidCmd = m =>
  m && typeof m.pattern === "string" && typeof m.run === "function"

const toKey = p =>
  p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

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

function rebuildLists() {
  const mods = [...registry.map.values()]

  registry.list = mods
    .map(c => c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`)
    .sort()

  registry.details = mods.map(c => ({
    pattern:  c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`,
    desc:     c.desc     || "",
    usage:    c.usage    || "",
    category: c.category || "general",
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

async function loadCommands() {
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))
  registry.map.clear()

  const t       = Date.now()
  const results = await Promise.all(files.map(f => Promise.resolve(loadFile(f))))
  const ok      = results.filter(Boolean).length
  const fail    = results.length - ok

  rebuildLists()

  console.log(`[CMD] ⚡ ${ok} OK | ${fail} FAIL | ${Date.now() - t}ms`)
  console.log(`[CMD] Keys: ${[...registry.map.keys()].join(", ")}`)
}

let watchStarted = false
function watchCommands() {
  if (watchStarted) return
  watchStarted = true
  let timer = null
  fs.watch(CMD_DIR, { persistent: false }, (_, filename) => {
    if (!filename?.endsWith(".js")) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      loadFile(filename)
      rebuildLists()
      console.log(`[CMD] ↺ Hot reloaded: ${filename}`)
    }, 150)
  })
}

// ─────────────────────────────────────────────────────────
// BODY EXTRACTOR
// ─────────────────────────────────────────────────────────

function extractBody(msg) {
  const m = msg.message
  return (
    m?.conversation                                           ||
    m?.extendedTextMessage?.text                             ||
    m?.imageMessage?.caption                                 ||
    m?.videoMessage?.caption                                 ||
    m?.buttonsResponseMessage?.selectedButtonId              ||
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  )
}

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────

const PREFIX_LEN  = settings.prefix.length
const PREFIX_CHAR = settings.prefix[0]

async function handleMessage(sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  if (body[0] === PREFIX_CHAR) {
    const chat = msg.key.remoteJid?.endsWith("@g.us") ? "GRP" : "DM"
    const who  = (msg.key.participant || msg.key.remoteJid || "?").split("@")[0]
    console.log(`[MSG] ${chat} | from: ${who} | ${body.slice(0, 80)}`)
  }

  if (!body.startsWith(settings.prefix)) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from

  const slice    = body.slice(PREFIX_LEN).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = registry.map.get(cmd)
  if (!command) {
    console.log(`[CMD] ? unknown: ${cmd}`)
    return
  }

  const ownerBase = (settings.owner || "").replace(/\D/g, "")
  const isOwner   = ownerBase
    ? sender === ownerBase ||
      sender.startsWith(`${ownerBase}@`) ||
      sender.indexOf(ownerBase) !== -1
    : false

  const isGroup = from.endsWith("@g.us")

  console.log(`[CMD] ▶ ${cmd} | owner:${isOwner} group:${isGroup}`)

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:       rest,
      full:       body,
      commands:   registry.map,
      cmdList:    registry.list,
      cmdDetails: registry.details,
      settings,
      lib,
      isOwner,
      isGroup,
      extractBody,
    })
  } catch (e) {
    console.error(`[RUN ERROR] ${cmd}:`, e.message)
    try {
      await sock.sendMessage(from, { text: `❌ Command error: ${e.message}` })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────
// BOT CORE
// ─────────────────────────────────────────────────────────

let retries   = 0
let botSocket = null
const MAX_RETRIES = 20

function getDelay(n) { return Math.min(1000 * Math.pow(2, n), 30000) }

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
      logger:              Pino({ level: "silent" }),
      printQRInTerminal:   false,
      markOnlineOnConnect: false,
      syncFullHistory:     false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs:    60000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount:    5,
    })

    botSocket = sock

    // ── Manual store: keep group metadata in RAM ──────────────
    sock.ev.on('groups.upsert', groups => {
      for (const g of groups) store.groupMetadata[g.id] = g
    })
    sock.ev.on('groups.update', updates => {
      for (const u of updates) {
        if (store.groupMetadata[u.id]) Object.assign(store.groupMetadata[u.id], u)
      }
    })
    sock.ev.on('group-participants.update', async ({ id }) => {
      try { store.groupMetadata[id] = await sock.groupMetadata(id) } catch {}
    })

    // ── Pairing code — only fires on first run ────────────────
    if (!state.creds.registered) {
      const raw    = process.env.PAIRING_NUMBER || process.env.PHONE_NUMBER || settings.owner
      const number = (raw || "").replace(/\D/g, "")
      if (!number || number.length < 7) {
        console.error("[PAIR] ✗ Set PAIRING_NUMBER in .env to your WhatsApp number (digits only)")
        process.exit(1)
      }
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(number)
          console.log("╔══════════════════════════════╗")
          console.log("║  WHATSAPP PAIRING CODE       ║")
          console.log(`║  👉  ${code}          ║`)
          console.log("╚══════════════════════════════╝")
          console.log("[PAIR] WhatsApp → Linked Devices → Link with phone number")
          console.log("[PAIR] After pairing once, restarts auto-connect forever")
        } catch (e) {
          console.error("[PAIR] ✗", e.message)
        }
      }, 3000)
    }

    await loadCommands()
    watchCommands()

    // ── Boot libs that need the socket ────────────────────────
    if (typeof lib.setSocket      === "function") lib.setSocket(sock)
    if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)

    // ── Wire isAdmin + welcome with store ─────────────────────
    try {
      const isAdminLib = require('./lib/isAdmin')
      isAdminLib.setStore(store)
      isAdminLib.setSocket(sock)
      isAdminLib.invalidateAll()
      require('./lib/welcome').setStore(store)
      console.log("[LIB] ✔ isAdmin + welcome wired")
    } catch (e) {
      console.warn("[LIB] ✗ wire failed:", e.message)
    }

    // ─────────────────────────────────────────────────────────
    // MESSAGE LISTENER
    // ─────────────────────────────────────────────────────────
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return

      for (const m of messages) {
        if (m.key.fromMe && type === "append") continue

        if (typeof lib.handleMemory === "function") {
          lib.handleMemory(sock, m, extractBody).catch(() => {})
        }

        handleMessage(sock, m).catch(e => console.error("[MSG ERR]", e.message))

        if (typeof lib.handleAntilink === "function") {
          lib.handleAntilink(sock, m, extractBody).catch(() => {})
        }
      }
    })

    // ── Group participant changes ──────────────────────────────
    sock.ev.on("group-participants.update", async (update) => {
      if (typeof lib.handleGroupUpdate === "function") {
        lib.handleGroupUpdate(sock, update).catch(() => {})
      }
    })

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        retries = 0
        console.log(`⚡ ${settings.botName} ONLINE`)
        console.log(`[INFO] Prefix: "${settings.prefix}" | Owner: ${settings.owner || "NOT SET"}`)
      }

      if (connection === "close") {
        const code      = lastDisconnect?.error?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        const forbidden = code === DisconnectReason.forbidden

        if (loggedOut || forbidden) {
          console.log("[BOT] Logged out — delete session/ folder and re-pair")
          return process.exit(0)
        }

        if (retries < MAX_RETRIES) {
          const delay = getDelay(retries)
          console.log(`[BOT] ↺ Retry ${retries + 1}/${MAX_RETRIES} in ${delay}ms | code: ${code}`)
          retries++
          setTimeout(startBot, delay)
        } else {
          console.log("[BOT] Max retries — exiting")
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

startBot()
