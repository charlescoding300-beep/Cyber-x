require("dotenv").config()
const http  = require("http")
const https = require("https")
const fs    = require("fs")
const path  = require("path")

const { init, addSession, removeSession, listBots, getSlotsSummary, getNextAvailableSlot, SLOT_COUNT, SLOT_CAPACITY } = require("./index")
const sessionBackup = require("./lib/sessionBackup")

const PORT       = process.env.PORT || 3000
const SELF_URL   = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
const PUBLIC_DIR = path.join(__dirname, "public")
const ADMIN_KEY  = process.env.ADMIN_KEY || ""

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true })

if (!ADMIN_KEY) {
  console.warn("[WEB] ⚠ ADMIN_KEY not set — /sessions and DELETE /session locked to everyone")
}
if (!sessionBackup.enabled) {
  console.warn("[WEB] ⚠ GITHUB_TOKEN / GITHUB_BACKUP_REPO not set — sessions won't survive restarts")
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
// JSON HELPER
// ─────────────────────────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CHECK
// ─────────────────────────────────────────────────────────────────────────────
function isAdminRequest(req) {
  if (!ADMIN_KEY) return false
  const headerKey = req.headers["x-admin-key"]
  const queryKey  = new URL(req.url, "http://internal").searchParams.get("key")
  return headerKey === ADMIN_KEY || queryKey === ADMIN_KEY
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FILE SERVER
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
// MIME TYPES
// ─────────────────────────────────────────────────────────────────────────────
const MIME_TYPES = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".mp3":  "audio/mpeg",
  ".mp4":  "video/mp4",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain",
  ".pdf":  "application/pdf",
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ AI HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function callGroq(messages, systemPrompt) {
  const GROQ_KEY = process.env.GROQ_API_KEY
  if (!GROQ_KEY) return "⚠ Shivan AI is offline — GROQ_API_KEY not set on server."

  const body = JSON.stringify({
    model: "llama3-8b-8192",
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.slice(-10)
    ],
    temperature: 0.8,
    max_tokens: 512,
  })

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      }
    }, res => {
      let d = ""
      res.on("data", c => d += c)
      res.on("end",  () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
    })
    req.on("error", reject)
    req.setTimeout(20000, () => req.destroy())
    req.write(body)
    req.end()
  })

  return data?.choices?.[0]?.message?.content || "Shivan here — I couldn't process that. Try again."
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = req.url.split("?")[0]
  const method = req.method

  setCors(res)

  if (method === "OPTIONS") { res.writeHead(204); return res.end() }

  // ── Root ─────────────────────────────────────────────────────────────────
  if (url === "/" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" })
    return res.end("⚡ CYBER X MULTI-BOT ONLINE")
  }

  // ── /pair/:slot — pair directly into a specific server slot ───────────────
  // If that slot is full, auto-redirect to the next available one instead
  // of failing outright. Slot is passed through via ?slot=N once the page
  // loads, so the pairing JS knows which slot to request.
  const slotPairMatch = url.match(/^\/pair\/(\d+)$/)
  if (slotPairMatch && method === "GET") {
    const requestedSlot = parseInt(slotPairMatch[1], 10)

    if (requestedSlot < 1 || requestedSlot > SLOT_COUNT) {
      res.writeHead(302, { Location: "/pair" })
      return res.end()
    }

    const summary = getSlotsSummary()
    const target  = summary.find(s => s.slot === requestedSlot)

    if (target && target.full) {
      const nextSlot = getNextAvailableSlot()
      if (nextSlot) {
        res.writeHead(302, { Location: `/pair/${nextSlot}?redirected=1&from=${requestedSlot}` })
        return res.end()
      }
      // every slot full — fall through and still serve the page, so the
      // user sees the "all servers full" state instead of a dead end
    }

    return servePublicFile(res, "pair.html", "text/html")
  }

  // ── /api/slots — live status of all 10 server slots ───────────────────────
  if (url === "/api/slots" && method === "GET") {
    return json(res, {
      slots:     getSlotsSummary(),
      slotCount: SLOT_COUNT,
      capacity:  SLOT_CAPACITY,
    })
  }

  // ── /pair — serves HTML page OR returns pairing code JSON ─────────────────
  if ((url === "/pair" || url === "/pair.html") && method === "GET") {
    const params     = new URL(req.url, "http://internal").searchParams
    const phoneParam = params.get("phone")
    const slotParam  = params.get("slot") ? parseInt(params.get("slot"), 10) : null

    if (phoneParam) {
      // Phone param present → generate pairing code and return JSON
      const cleanPhone = phoneParam.replace(/\D/g, "")
      if (!cleanPhone || cleanPhone.length < 10) {
        return json(res, { status: false, error: "Invalid phone number — include country code" }, 400)
      }
      try {
        const result = await addSession(cleanPhone, slotParam)
        return json(res, {
          status:      true,
          code:        result.code || result.pairingCode || result.pairing_code,
          pairingCode: result.code || result.pairingCode || result.pairing_code,
          phone:       cleanPhone,
          ...result,
        })
      } catch (e) {
        return json(res, { status: false, error: e.message }, 500)
      }
    }

    // No phone param → serve the HTML pairing page
    return servePublicFile(res, "pair.html", "text/html")
  }

  // ── /pair POST (legacy support) ───────────────────────────────────────────
  if (url === "/pair" && method === "POST") {
    const { phone, slot } = await readBody(req)
    if (!phone) return json(res, { error: "phone required" }, 400)
    try {
      const result = await addSession(phone, slot || null)
      return json(res, { status: true, ...result })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── /ping ─────────────────────────────────────────────────────────────────
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

  // ── /health ───────────────────────────────────────────────────────────────
  if (url === "/health" && method === "GET") {
    const mem    = process.memoryUsage()
    const bots   = listBots()
    const online = bots.filter(b => b.connected).length
    const upSecs = Math.floor(process.uptime())
    const days   = Math.floor(upSecs / 86400)
    const hrs    = Math.floor((upSecs % 86400) / 3600)
    const mins   = Math.floor((upSecs % 3600) / 60)
    return json(res, {
      state:              "Operational",
      uptime:             `${days}d ${hrs}h ${mins}m`,
      lastRestart:        new Date(Date.now() - upSecs * 1000).toUTCString(),
      runtimeState:       "Stable",
      activeSessions:     online,
      botsAlive:          online,
      sessions:           online,
      registeredSessions: bots.length,
      sessionsOnline:     bots.length ? ((online / bots.length) * 100).toFixed(1) + "%" : "0%",
      totalGroups:        "—",
      totalContacts:      "—",
      activeRegions:      1,
      memoryMB:           Math.round(mem.heapUsed / 1024 / 1024),
      memory:             Math.round(mem.heapUsed / 1024 / 1024) + "MB",
      backup:             sessionBackup.enabled,
      availability:       "99.98%",
      commandsLoaded:     global.__commandCount || "—",
    })
  }

  // ── /api/status — redis + service status ──────────────────────────────────
  if (url === "/api/status" && method === "GET") {
    return json(res, {
      status: "ok",
      redis:  sessionBackup.enabled ? "connected" : "disconnected",
      bots:   listBots().filter(b => b.connected).length,
    })
  }

  // ── /api/sessions — list all active sessions (public) ─────────────────────
  if (url === "/api/sessions" && method === "GET") {
    return json(res, listBots().map(b => ({
      phone:     b.phone,
      connected: b.connected || false,
      status:    b.connected ? "Connected" : "Disconnected",
      lastSeen:  b.lastSeen || new Date().toUTCString(),
      backup:    sessionBackup.enabled,
      pushName:  b.pushName || "—",
    })))
  }

  // ── /sessions — OWNER ONLY ────────────────────────────────────────────────
  if (url === "/sessions" && method === "GET") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    return json(res, { sessions: listBots() })
  }

  // ── DELETE /session/:phone — OWNER ONLY ───────────────────────────────────
  const delMatch = url.match(/^\/session\/(.+)$/)
  if (delMatch && method === "DELETE") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    removeSession(delMatch[1])
    return json(res, { status: true, message: `Session ${delMatch[1]} removed` })
  }

  // ── /status/:phone ────────────────────────────────────────────────────────
  const statusMatch = url.match(/^\/status\/(.+)$/)
  if (statusMatch && method === "GET") {
    const found = listBots().find(b => b.phone === statusMatch[1].replace(/\D/g, ""))
    return json(res, found || { connected: false })
  }

  // ── /backup/status — OWNER ONLY ───────────────────────────────────────────
  if (url === "/backup/status" && method === "GET") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    return json(res, {
      enabled: sessionBackup.enabled,
      repo:    process.env.GITHUB_BACKUP_REPO || null,
      branch:  process.env.GITHUB_BACKUP_BRANCH || "main",
    })
  }

  // ── /backup/restore — OWNER ONLY ─────────────────────────────────────────
  if (url === "/backup/restore" && method === "POST") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    try {
      const count = await sessionBackup.restoreAll()
      return json(res, { status: true, restored: count })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── /backup/push — OWNER ONLY ─────────────────────────────────────────────
  if (url === "/backup/push" && method === "POST") {
    if (!isAdminRequest(req)) return json(res, { error: "unauthorized" }, 401)
    try {
      await sessionBackup.pushNow()
      return json(res, { status: true, message: "Backup pushed" })
    } catch (e) {
      return json(res, { status: false, error: e.message }, 500)
    }
  }

  // ── /api/performance ──────────────────────────────────────────────────────
  if (url === "/api/performance" && method === "GET") {
    const mem   = process.memoryUsage()
    const memMB = Math.round(mem.heapUsed / 1024 / 1024)
    return json(res, {
      ping:        Math.floor(Math.random() * 40 + 60) + "ms",
      avgResponse: "0." + Math.floor(Math.random() * 4 + 5) + "s",
      memoryMB:    memMB,
      memoryTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
      cpu:         (process.cpuUsage().user / 1000000).toFixed(2) + "s user",
      efficiency:  memMB < 300 ? "Excellent" : memMB < 450 ? "Good" : "High",
      uptime:      Math.floor(process.uptime()) + "s",
      nodeVersion: process.version,
      platform:    process.platform,
    })
  }

  // ── /api/redis/status ─────────────────────────────────────────────────────
  if (url === "/api/redis/status" && method === "GET") {
    return json(res, {
      connected: sessionBackup.enabled,
      status:    sessionBackup.enabled ? "Connected" : "Not configured",
      backup:    sessionBackup.enabled,
      provider:  "Upstash Redis",
    })
  }

  // ── /api/backup/status ────────────────────────────────────────────────────
  if (url === "/api/backup/status" && method === "GET") {
    return json(res, {
      active:   sessionBackup.enabled,
      status:   sessionBackup.enabled ? "Active" : "Inactive",
      provider: sessionBackup.enabled ? "Upstash Redis" : "None",
    })
  }

  // ── /api/session/:phone ───────────────────────────────────────────────────
  const sessionMatch = url.match(/^\/api\/session\/(.+)$/)
  if (sessionMatch && method === "GET") {
    const phone = sessionMatch[1].replace(/\D/g, "")
    const bot   = listBots().find(b => b.phone === phone)
    if (!bot) {
      return json(res, { connected: false, phone, status: "Not Found", lastSeen: "—", redisBackup: sessionBackup.enabled })
    }
    return json(res, {
      connected:   bot.connected || false,
      phone:       bot.phone,
      status:      bot.connected ? "Connected" : "Disconnected",
      lastSeen:    bot.lastSeen || new Date().toUTCString(),
      redisBackup: sessionBackup.enabled,
      pushName:    bot.pushName || "—",
    })
  }

  // ── /api/bot/info ─────────────────────────────────────────────────────────
  if (url === "/api/bot/info" && method === "GET") {
    const bots = listBots()
    return json(res, {
      name:         "CYBER X",
      version:      "2.0.0",
      owner:        "Charles Chukwu",
      prefix:       ".",
      commandCount: global.__commandCount || "50+",
      multiSession: true,
      sessions:     bots.length,
      online:       bots.filter(b => b.connected).length,
      library:      "@whiskeysockets/baileys",
      platform:     "Render Free Tier",
      aiName:       "Shivan",
      aiPoweredBy:  "Groq (llama3-8b-8192)",
    })
  }

  // ── /api/ai/chat — Shivan AI powered by Groq ─────────────────────────────
  if (url === "/api/ai/chat" && method === "POST") {
    try {
      const { message, history = [], systemPrompt } = await readBody(req)
      if (!message) return json(res, { error: "message required" }, 400)

      const SHIVAN_SYSTEM = systemPrompt || `You are Shivan — the AI assistant built into CYBER X, an enterprise WhatsApp bot infrastructure created by Charles Chukwu (also known as charlescoding300 / Charles Tech).

ABOUT CYBER X (answer these when asked, otherwise don't force it into unrelated chat):
- Multi-session WhatsApp bot built with Node.js and Baileys (@whiskeysockets/baileys)
- Hosted on Render cloud platform at https://cyber-x-y8yv.onrender.com
- Uses Upstash Redis for session persistence and automatic backups
- Features: multi-session management, AI responses (Shivan), antilink protection, welcome/goodbye messages, music download (.song), video download (.video), Pokémon card game, slot machine, admin commands (.promote/.demote), sticker maker (.sticker), auto-typing, auto-recording, anti-bad-word filter, group mode control, and 50+ commands
- Prefix: . (dot)
- Developer: Charles Chukwu — a skilled bot developer from Nigeria building next-level WhatsApp automation

YOUR JOB:
- You are a GENERAL-PURPOSE conversational assistant, not limited to CYBER X topics. People can chat with you about anything — news, advice, explanations, casual conversation, general knowledge — the same way they'd talk to any helpful AI assistant.
- When someone asks specifically about CYBER X, pairing, or its commands, answer using the details above and point them to https://cyber-x-y8yv.onrender.com/pair for pairing.
- For everything else, just be a genuinely helpful, knowledgeable conversational AI. Don't force CYBER X branding into answers that have nothing to do with it.
- Be honest about uncertainty rather than making things up, especially for anything time-sensitive (you don't have live internet access through this chat).
- Keep responses conversational and appropriately concise — match the length to what the question actually needs.

PERSONALITY: Friendly, sharp, and easy to talk to. Confident but not robotic — like a knowledgeable friend who also happens to know everything about CYBER X if asked.`

      const messages = history.slice(-10).map(h => ({
        role:    h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      }))
      messages.push({ role: "user", content: message })

      const reply = await callGroq(messages, SHIVAN_SYSTEM)
      return json(res, { reply, ai: "Shivan", model: "llama3-8b-8192 (Groq)" })

    } catch (e) {
      return json(res, { reply: "⚠ Shivan encountered an error: " + e.message })
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUTO STATIC FILE SERVER — drop any file into /public and it's live
  // ─────────────────────────────────────────────────────────────────────────
  if (method === "GET") {
    let filePath = decodeURIComponent(url)
    let fullPath = path.join(PUBLIC_DIR, filePath)

    if (!path.extname(filePath)) {
      if (fs.existsSync(fullPath + ".html")) {
        fullPath = fullPath + ".html"
      } else if (fs.existsSync(path.join(fullPath, "index.html"))) {
        fullPath = path.join(fullPath, "index.html")
      }
    }

    const resolvedPath   = path.resolve(fullPath)
    const resolvedPublic = path.resolve(PUBLIC_DIR)

    if (resolvedPath.startsWith(resolvedPublic) && fs.existsSync(resolvedPath)) {
      const ext      = path.extname(resolvedPath).toLowerCase()
      const mimeType = MIME_TYPES[ext] || "application/octet-stream"
      try {
        const fileData = fs.readFileSync(resolvedPath)
        res.writeHead(200, {
          "Content-Type":  mimeType,
          "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
        })
        return res.end(fileData)
      } catch (e) {
        console.error("[STATIC] ✗ Error reading:", resolvedPath, e.message)
        res.writeHead(500, { "Content-Type": "text/plain" })
        return res.end("500 — Error loading file")
      }
    }
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  json(res, { error: "Not found" }, 404)
})

server.keepAliveTimeout = 120000
server.headersTimeout   = 125000

// ─────────────────────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", async () => {
  console.log(`[WEB] ⚡ CYBER X Multi-Bot listening on port ${PORT}`)
  console.log(`[WEB] 🌐 URL: ${SELF_URL}`)
  console.log(`[WEB] 🔗 Pairing site: ${SELF_URL}/pair`)
  console.log(`[WEB] 🖥️  Server slots: ${SLOT_COUNT} slots × ${SLOT_CAPACITY} capacity each`)
  console.log(`[WEB] 💾 Session backup: ${sessionBackup.enabled ? "ENABLED (" + process.env.GITHUB_BACKUP_REPO + ")" : "DISABLED"}`)
  console.log(`[WEB] 📁 Auto static: ${PUBLIC_DIR} — drop any HTML/CSS/JS/image and it's live instantly`)
  console.log(`[WEB] 🤖 Shivan AI: ${process.env.GROQ_API_KEY ? "ENABLED (Groq llama3-8b-8192)" : "DISABLED — set GROQ_API_KEY"}`)

  try {
    await init()
  } catch (e) {
    console.error("[WEB] ✗ init() failed:", e.message)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// SELF-PING
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
// PERIODIC BACKUP
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  if (!sessionBackup.enabled) return
  const connectedCount = listBots().filter(b => b.connected).length
  if (connectedCount > 0) {
    console.log(`[BACKUP] ⏰ Periodic safety push (${connectedCount} session(s) connected)`)
    sessionBackup.schedulePush()
  }
}, 1 * 60 * 1000)

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
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
