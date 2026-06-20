require("dotenv").config()
const http  = require("http")
const https = require("https")
const fs    = require("fs")
const path  = require("path")

// ── Single entry point: everything boots from here via `node server.js` ──────
const { init, addSession, removeSession, listBots } = require("./index")
const sessionBackup = require("./lib/sessionBackup")

const PORT       = process.env.PORT || 3000
const SELF_URL   = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
const PUBLIC_DIR = path.join(__dirname, "public")
const ADMIN_KEY  = process.env.ADMIN_KEY || ""

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true })

if (!ADMIN_KEY) {
  console.warn("[WEB] ⚠ ADMIN_KEY not set in env — /sessions and DELETE /session are locked to EVERYONE (fail-closed) until you set it on Render")
}

if (!sessionBackup.enabled) {
  console.warn("[WEB] ⚠ GITHUB_TOKEN / GITHUB_BACKUP_REPO not set — sessions will NOT survive Render restarts. Set both env vars to enable backup/restore.")
}

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSER
// ─────────────────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let d = ""
    req.on("data",  c   => d += c)
    req.on("end",   ()  => { try { res(JSON.parse(d || "{}")) } catch { res({}) } })
    req.on("error", rej)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key")
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON RESPONSE HELPER
// ─────────────────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNERSHIP CHECK — protects destructive / privacy-sensitive endpoints
// Pass the key as header:  X-Admin-Key: <ADMIN_KEY>
// or query string:         ?key=<ADMIN_KEY>
// Fails CLOSED if ADMIN_KEY isn't set — better to lock yourself out and
// notice than to silently leave these endpoints open to everyone.
// ─────────────────────────────────────────────────────────────────────────────
function isAdminRequest(req) {
  if (!ADMIN_KEY) return false
  const headerKey = req.headers["x-admin-key"]
  const queryKey  = new URL(req.url, "http://internal").searchParams.get("key")
  return headerKey === ADMIN_KEY || queryKey === ADMIN_KEY
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FILE SERVER — serves the pairing website from /public
// ─────────────────────────────────────────────────────────────────────────────
function servePublicFile(res, filename, contentType) {
  try {
    const data = fs.readFileSync(path.join(PUBLIC_DIR, filename))
    res.writeHead(200, { "Content-Type": contentType })
    return res.end(data)
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" })
    return res.end(`${filename} not found — place it in ${PUBLIC_DIR}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = req.url.split("?")[0]
  const method = req.method

  setCors(res)

  // ── Preflight ────────────────────────────────────────────────────────────
  if (method === "OPTIONS") {
    res.writeHead(204)
    return res.end()
  }

  // ── Health / root ────────────────────────────────────────────────────────
  if (url === "/" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    return res.end("⚡ CYBER X MULTI-BOT ONLINE")
  }

  // ── Pairing website — public/pair.html ─────────────────────────────────────
  if ((url === "/pair" || url === "/pair.html") && method === "GET") {
    return servePublicFile(res, "pair.html", "text/html")
  }

  // ── Ping — for uptime monitors and self-ping ──────────────────────────────
  if (url === "/ping" && method === "GET") {
    return json(res, {
      status:    "online",
      bots:      listBots().length,
      connected: listBots().filter(b => b.connected).length,
      backup:    sessionBackup.enabled,
      uptime:    Math.floor(process.uptime()),
      memory:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      timestamp: new Date().toISOString(),
    })
  }

  // ── List all sessions — OWNER ONLY, leaks every linked phone number ────────
  if (url === "/sessions" && method === "GET") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    return json(res, { sessions: listBots() })
  }

  // ── Add / pair a new session — stays PUBLIC, this is the self-service flow
  if (url === "/pair" && method === "POST") {
    const { phone } = await readBody(req)
    if (!phone) return json(res, { error: "phone required" }, 400)
    try {
      const result = await addSession(phone)
      return json(res, { status: true, ...result })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── Delete a session — OWNER ONLY, otherwise anyone can kick anyone offline
  const delMatch = url.match(/^\/session\/(.+)$/)
  if (delMatch && method === "DELETE") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    removeSession(delMatch[1])
    return json(res, { status: true, message: `Session ${delMatch[1]} removed` })
  }

  // ── Get status of a single session — stays public (pair.html polls this)
  const statusMatch = url.match(/^\/status\/(.+)$/)
  if (statusMatch && method === "GET") {
    const found = listBots().find(b => b.phone === statusMatch[1].replace(/\D/g, ""))
    return json(res, found || { connected: false })
  }

  // ── Backup status — OWNER ONLY, shows whether GitHub backup is configured
  // and lets you trigger a manual restore or push on demand
  if (url === "/backup/status" && method === "GET") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    return json(res, {
      enabled: sessionBackup.enabled,
      repo:    process.env.GITHUB_BACKUP_REPO || null,
      branch:  process.env.GITHUB_BACKUP_BRANCH || "main",
    })
  }

  // ── Manual restore trigger — OWNER ONLY, pulls latest backup from GitHub
  // and restarts every restored session immediately (without waiting for
  // a full server restart). Useful if you ever need to force-resync.
  if (url === "/backup/restore" && method === "POST") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    try {
      const count = await sessionBackup.restoreAll()
      return json(res, { status: true, restored: count })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── Manual backup push trigger — OWNER ONLY, forces an immediate backup
  // instead of waiting for the normal 20s debounce
  if (url === "/backup/push" && method === "POST") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    try {
      await sessionBackup.pushNow()
      return json(res, { status: true, message: "Backup pushed" })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  json(res, { error: "Not found" }, 404)
})

server.keepAliveTimeout = 120000
server.headersTimeout   = 125000

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP — server listens, THEN bot init runs.
// init() (inside index.js) is responsible for calling sessionBackup.restoreAll()
// BEFORE starting any sessions, so this stays a single source of truth for
// startup order — server.js does not duplicate that restore call here.
// ─────────────────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", async () => {
  console.log(`[WEB] ⚡ CYBER X Multi-Bot listening on port ${PORT}`)
  console.log(`[WEB] 🌐 URL: ${SELF_URL}`)
  console.log(`[WEB] 🔗 Pairing site: ${SELF_URL}/pair`)
  console.log(`[WEB] 💾 Session backup: ${sessionBackup.enabled ? "ENABLED (" + process.env.GITHUB_BACKUP_REPO + ")" : "DISABLED"}`)

  try {
    await init()
  } catch (e) {
    console.error("[WEB] ✗ init() failed:", e.message)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// SELF-PING — keeps Render / Railway / free-tier hosts from sleeping
// ─────────────────────────────────────────────────────────────────────────────
let pingCount = 0
function selfPing() {
  const mod = SELF_URL.startsWith("https") ? https : http
  const req = mod.get(`${SELF_URL}/ping`, res => {
    pingCount++
    console.log(`[PING] ✔ #${pingCount} | bots alive: ${listBots().filter(b => b.connected).length}`)
    res.resume()
  })
  req.on("error", () => {})
  req.setTimeout(10000, () => req.destroy())
}
setTimeout(() => { selfPing(); setInterval(selfPing, 4 * 60 * 1000) }, 15000)

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC BACKUP SAFETY NET — even if individual creds.update events get
// missed for any reason, this guarantees a backup push at least once every
// 10 minutes whenever any session is connected, so nothing drifts too far
// out of sync with GitHub.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  if (!sessionBackup.enabled) return
  const connectedCount = listBots().filter(b => b.connected).length
  if (connectedCount > 0) {
    console.log(`[BACKUP] ⏰ Periodic safety push (${connectedCount} session(s) connected)`)
    sessionBackup.schedulePush()
  }
}, 10 * 60 * 1000)

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN — push a final backup before the process exits, so a
// manual restart or Render's redeploy cycle never loses the most recent
// session state even if it happens between two scheduled pushes.
// ─────────────────────────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`[WEB] ${signal} received — pushing final backup before exit...`)
  try {
    if (sessionBackup.enabled) await sessionBackup.pushNow()
  } catch (e) {
    console.error("[WEB] ✗ Final backup push failed:", e.message)
  }
  process.exit(0)
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT",  () => gracefulShutdown("SIGINT"))

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR GUARDS
// ─────────────────────────────────────────────────────────────────────────────
process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))
