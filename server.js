require("dotenv").config()
const http  = require("http")
const https = require("https")
const bot   = require("./index")

const { init, addSession, removeSession, listBots } = bot

const PORT     = process.env.PORT || 3000
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`

function readBody(req) {
  return new Promise((res, rej) => {
    let d = ""
    req.on("data", c => d += c)
    req.on("end",  () => { try { res(JSON.parse(d || "{}")) } catch { res({}) } })
    req.on("error", rej)
  })
}

// ── CORS — lets pairingcyber.com (or any frontend) call this API ────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

const server = http.createServer(async (req, res) => {
  const url    = req.url.split("?")[0]
  const method = req.method
  setCors(res)
  res.setHeader("Content-Type", "application/json")

  if (method === "OPTIONS") {
    res.writeHead(204)
    return res.end()
  }

  if (url === "/" && method === "GET") {
    res.setHeader("Content-Type", "text/plain")
    return res.end("⚡ CYBER X MULTI-BOT ONLINE")
  }

  if (url === "/ping" && method === "GET") {
    return res.end(JSON.stringify({
      status:  "online",
      bots:    listBots().length,
      uptime:  Math.floor(process.uptime()),
      memory:  Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    }))
  }

  if (url === "/sessions" && method === "GET")
    return res.end(JSON.stringify({ sessions: listBots() }))

  if (url === "/pair" && method === "POST") {
    const { phone } = await readBody(req)
    if (!phone) return res.end(JSON.stringify({ error: "phone required" }))
    try {
      const result = await addSession(phone)
      return res.end(JSON.stringify({ status: true, ...result }))
    } catch (e) {
      return res.end(JSON.stringify({ status: false, error: e.message }))
    }
  }

  const delMatch = url.match(/^\/session\/(.+)$/)
  if (delMatch && method === "DELETE") {
    removeSession(delMatch[1])
    return res.end(JSON.stringify({ status: true }))
  }

  const statusMatch = url.match(/^\/status\/(.+)$/)
  if (statusMatch && method === "GET") {
    const found = listBots().find(b => b.phone === statusMatch[1].replace(/\D/g, ""))
    return res.end(JSON.stringify(found || { connected: false }))
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: "Not found" }))
})

server.keepAliveTimeout = 120000
server.headersTimeout   = 125000

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`[WEB] ⚡ CYBER X Multi-Bot on port ${PORT}`)
  // ── FIX: bot.restoreAllSessions never existed — that's why commands
  // never loaded on this path. bot.init() runs loadCommands(), starts the
  // command-file watcher, and restores every previously-linked session
  // from sessions/_meta.json.
  if (typeof init === "function") {
    await init()
  } else {
    console.error("[WEB] ✗ init not found — check index.js exports")
  }
})

let pingCount = 0
function selfPing() {
  const mod = SELF_URL.startsWith("https") ? https : http
  const req = mod.get(`${SELF_URL}/ping`, () => {
    pingCount++
    console.log(`[PING] ✔ #${pingCount}`)
  })
  req.on("error", () => {})
  req.setTimeout(10000, () => req.destroy())
}
setTimeout(() => { selfPing(); setInterval(selfPing, 4 * 60 * 1000) }, 15000)

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))
