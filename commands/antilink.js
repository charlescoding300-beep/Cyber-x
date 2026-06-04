~/mybot $ cat index.js
// ─────────────────────────────────────────────────────────
//  CYBER X — ULTRA FAST STABLE LOADER  [Termux Optimised]
// ─────────────────────────────────────────────────────────

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
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys")

const { settings } = require("./lib/settings")

// ─────────────────────────────────────────────────────────
//  KEEP-ALIVE SERVER  (port 3000 + auto-ping every 4 min)
// ─────────────────────────────────────────────────────────

const PORT      = process.env.PORT || 3000
const SELF_URL  = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
const PING_MS   = 4 * 60 * 1000   // 4 minutes

let pingCount   = 0
let lastPing    = null
let serverReady = false

// Minimal HTTP server — no extra packages needed
const server = http.createServer((req, res) => {
  const now = new Date().toISOString()

  if (req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end("pong")
    return
  }

  if (req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({
      bot:       settings.botName,
      status:    "online",
      uptime:    Math.floor(process.uptime()) + "s",
      pings:     pingCount,
      lastPing,
      time:      now,
    }))
    return
  }

  // Root — visible status page
  res.writeHead(200, { "Content-Type": "text/html" })
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="refresh" content="30">
      <title>${settings.botName}</title>
      <style>
        body { font-family: monospace; background: #0d0d0d; color: #00ff99;
               display: flex; justify-content: center; align-items: center;
               height: 100vh; margin: 0; }
        .box { border: 1px solid #00ff99; padding: 2rem; border-radius: 8px;
               min-width: 300px; }
        h1   { margin: 0 0 1rem; font-size: 1.4rem; }
        p    { margin: .3rem 0; color: #aaa; }
        span { color: #00ff99; }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>⚡ ${settings.botName}</h1>
        <p>Status  : <span>ONLINE</span></p>
        <p>Uptime  : <span>${Math.floor(process.uptime())}s</span></p>
        <p>Pings   : <span>${pingCount}</span></p>
        <p>Last ping: <span>${lastPing ?? "—"}</span></p>
        <p>Port    : <span>${PORT}</span></p>
        <p style="margin-top:1rem;font-size:.75rem;color:#555">
          Auto-refreshes every 30s
        </p>
      </div>
    </body>
    </html>
  `)
})

server.listen(PORT, () => {
  serverReady = true
  console.log(`[WEB] ✔ Server live → http://localhost:${PORT}`)
  console.log(`[WEB] ✔ Status page → ${SELF_URL}`)
  startPinger()
})

// ── Auto-pinger ───────────────────────────────────────────

function ping() {
  const url = `${SELF_URL}/ping`
  const lib  = url.startsWith("https") ? https : http

  const req = lib.get(url, (res) => {
    pingCount++
    lastPing = new Date().toISOString()
    console.log(`[PING] ✔ #${pingCount} — ${lastPing}`)
  })

  req.on("error", (e) => {
    console.warn(`[PING] ✗ ${e.message}`)
  })

  req.setTimeout(10_000, () => {
    req.destroy()
    console.warn("[PING] ✗ Timeout after 10s")
  })
}

function startPinger() {
  // First ping after 10s (let bot connect first), then every 4 min
  setTimeout(() => {
    ping()
    setInterval(ping, PING_MS)
  }, 10_000)

  console.log(`[PING] ✔ Auto-ping every ${PING_MS / 60000} min → ${SELF_URL}/ping`)
}

// ─────────────────────────────────────────────────────────
//  COMMAND REGISTRY
// ─────────────────────────────────────────────────────────

const CMD_DIR = path.join(__dirname, "commands")

const registry = {
  map:  new Map(),   // key → command object
  list: [],          // flat list of patterns (for !menu etc.)
}

// Validate a required command shape
function isValidCmd(mod) {
  return (
    mod &&
    typeof mod.pattern === "string" &&
    typeof mod.run     === "function"
  )
}

// Normalise a pattern → lookup key
function toKey(pattern) {
  return pattern.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()
}

// Load ONE file — safe, returns true on success
function loadFile(file) {
  const fullPath = path.join(CMD_DIR, file)
  try {
    // Bust require cache so edits are picked up on reload
    delete require.cache[require.resolve(fullPath)]
    const mod = require(fullPath)

    if (!isValidCmd(mod)) return false

    const key = toKey(mod.pattern)
    registry.map.set(key, mod)
    return true
  } catch (e) {
    console.error(`[CMD] ✗ ${file}: ${e.message}`)
    return false
  }
}

// Full load — reads directory once, loads in parallel chunks
// Chunking prevents Termux from hitting the per-process file-descriptor cap
async function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) fs.mkdirSync(CMD_DIR, { recursive: true })

  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))
  if (!files.length) {
    console.log("[CMD] No commands found in ./commands/")
    return
  }

  registry.map.clear()
  registry.list = []

  const CHUNK = 10          // files per micro-batch (safe for Termux)
  let ok = 0, fail = 0

  const t = Date.now()

  for (let i = 0; i < files.length; i += CHUNK) {
    const batch = files.slice(i, i + CHUNK)

    // Use Promise.allSettled so one bad file never blocks the batch
    await Promise.allSettled(
      batch.map(f => Promise.resolve(loadFile(f) ? ok++ : fail++))
    )
  }

  // Build flat list AFTER map is fully populated
  registry.list = [...registry.map.values()].map(c => c.pattern)

  const ms = Date.now() - t
  console.log(
    `[CMD] ✔ ${ok} loaded${fail ? ` | ✗ ${fail} failed` : ""} — ${ms}ms`
  )
}

// ─────────────────────────────────────────────────────────
//  HOT-RELOAD WATCHER  (lightweight, Termux-safe)
// ─────────────────────────────────────────────────────────

let reloadTimer = null

function watchCommands() {
  // fs.watch is lighter than chokidar — fine for Termux
  fs.watch(CMD_DIR, { persistent: false }, (event, filename) => {
    if (!filename?.endsWith(".js")) return

    // Debounce: only reload once even if many files change together
    clearTimeout(reloadTimer)
    reloadTimer = setTimeout(async () => {
      console.log(`[CMD] ♻️  Change detected (${filename}) — reloading…`)
      await loadCommands()
    }, 400)
  })
}

// ─────────────────────────────────────────────────────────
//  MESSAGE HANDLER
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

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from

  const sliced = body.slice(settings.prefix.length).trim()
  const [rawCmd, ...args] = sliced.split(/\s+/)
  const cmd = rawCmd?.toLowerCase()
  if (!cmd) return

  const command = registry.map.get(cmd)
  if (!command) return

  // Owner check — exact JID match, no partial-string false positives
  const isOwner = sender === settings.owner || sender.startsWith(`${settings.owner}@`)

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:      args.join(" "),   // clean arg string (no command word)
      full:      sliced,           // full text after prefix if needed
      commands:  registry.map,
      cmdList:   registry.list,
      settings,
      isOwner,
    })
  } catch (e) {
    console.error(`[RUN] ✗ ${cmd}: ${e.message}`)
  }
}

// ─────────────────────────────────────────────────────────
//  BOT CORE
// ─────────────────────────────────────────────────────────

let retries = 0
const MAX_RETRIES = 10

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./session")
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      // makeCacheableSignalKeyStore reduces repeated disk reads — big win on Termux
      keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" }))
    },
    logger:            Pino({ level: "silent" }),
    printQRInTerminal: true,
    markOnlineOnConnect: false,   // saves battery / data on mobile
    syncFullHistory:   false,
    generateHighQualityLinkPreview: false,
  })

  // Load commands once, then watch for changes
  await loadCommands()
  watchCommands()

  // ── Events ─────────────────────────────────────────────

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    // Process messages concurrently — fine for a small bot
    await Promise.allSettled(messages.map(m => handleMessage(sock, m)))
  })

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (connection === "open") {
      retries = 0
      console.log(`⚡ ${settings.botName} ONLINE`)
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode
      const out  = code === DisconnectReason.loggedOut

      console.log(`[NET] Disconnected — code ${code ?? "unknown"}`)

      if (out) {
        console.log("❌ Logged out. Delete ./session and restart.")
        process.exit(0)
      }

      if (retries < MAX_RETRIES) {
        retries++
        const delay = Math.min(3000 * retries, 30_000)  // back-off up to 30 s
        console.log(`♻️  Reconnecting in ${delay / 1000}s… (attempt ${retries}/${MAX_RETRIES})`)
        setTimeout(startBot, delay)
      } else {
        console.log("❌ Max retries reached. Exiting.")
        process.exit(1)
      }
    }
  })

  sock.ev.on("creds.update", saveCreds)
}

// ─────────────────────────────────────────────────────────
//  ENTRY
// ─────────────────────────────────────────────────────────

startBot().catch(e => {
  console.error("[BOOT]", e.message)
  process.exit(1)
})
~/mybot $
