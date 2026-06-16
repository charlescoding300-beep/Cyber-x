// ─────────────────────────────────────────────────────────────────────────────
// server.js  —  CYBER X  |  Gateway + Bot Manager
//
// THIS IS THE ONLY FILE YOU RUN ON RENDER.
// Change your Render start command to:  node server.js
//
// What this file does:
//  1. Starts on Render's public PORT (so create.xyz can reach it)
//  2. Automatically spawns index.js (your bot) as a child process
//  3. Handles all gateway API routes for create.xyz
//  4. Lets users link THEIR OWN WhatsApp via QR or pairing code
//  5. Their linked bots run commands from your commands/ folder
// ─────────────────────────────────────────────────────────────────────────────

"use strict"
require("dotenv").config()

const http    = require("http")
const fs      = require("fs")
const path    = require("path")
const { spawn } = require("child_process")
const QRCode  = require("qrcode")
const Pino    = require("pino")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  (set these in Render → Environment)
// ─────────────────────────────────────────────────────────────────────────────

const PORT           = process.env.PORT           || 10000   // Render sets this automatically
const MANAGER_SECRET = process.env.MANAGER_SECRET || "RGNpLM3n5OcA78bMB8YGYFjRmAWBh1Gb"
const OWNER_PHONE    = (process.env.OWNER_NUMBER  || "2348120382097").replace(/\D/g, "")
const BOT_SCRIPT     = path.join(__dirname, "index.js")

// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS
// ─────────────────────────────────────────────────────────────────────────────

const GW_SESSIONS = path.join(__dirname, "gateway_sessions")   // user sessions
const DATA_FILE   = path.join(__dirname, "data", "gw_instances.json")
const CMD_DIR     = path.join(__dirname, "commands")

for (const dir of [GW_SESSIONS, path.dirname(DATA_FILE)]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// CRASH GUARD
// ─────────────────────────────────────────────────────────────────────────────

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — SPAWN YOUR BOT (index.js) AS A CHILD PROCESS
// This runs your own bot automatically when server.js starts.
// ─────────────────────────────────────────────────────────────────────────────

console.log("[SERVER] 🤖 Starting CYBER X bot (index.js)...")

const botProc = spawn(process.execPath, ["--expose-gc", BOT_SCRIPT], {
  env:   { ...process.env },
  cwd:   __dirname,
  stdio: "inherit",   // bot logs appear in the same Render log stream
})

botProc.on("exit", (code) => {
  console.log(`[SERVER] Bot exited (code ${code}) — restarting in 3s...`)
  setTimeout(() => {
    spawn(process.execPath, ["--expose-gc", BOT_SCRIPT], {
      env:   { ...process.env },
      cwd:   __dirname,
      stdio: "inherit",
    })
  }, 3000)
})

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — LOAD COMMANDS (shared from commands/ folder)
// Same commands your bot uses — also run for linked user instances.
// ─────────────────────────────────────────────────────────────────────────────

const cmdRegistry = new Map()

function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  cmdRegistry.clear()
  let ok = 0
  for (const file of fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (mod?.pattern && typeof mod.run === "function") {
        const key = mod.pattern.replace(/^\./, "").toLowerCase().trim()
        cmdRegistry.set(key, mod)
        ok++
      }
    } catch (e) {
      console.error(`[CMD] ✗ ${file}: ${e.message}`)
    }
  }
  console.log(`[SERVER] ✔ ${ok} commands loaded from commands/`)
}

loadCommands()

// Hot reload when commands/ changes
let cmdTimer = null
if (fs.existsSync(CMD_DIR)) {
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(cmdTimer)
    cmdTimer = setTimeout(loadCommands, 150)
  })
}

function extractBody(msg) {
  const m = msg.message
  return (
    m?.conversation                     ||
    m?.extendedTextMessage?.text        ||
    m?.imageMessage?.caption            ||
    m?.videoMessage?.caption            ||
    ""
  )
}

async function runCommand(sock, msg, phone) {
  const body = extractBody(msg).trim()
  if (!body.startsWith(".")) return

  const slice    = body.slice(1).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = cmdRegistry.get(cmd)
  if (!command) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from

  gwLog(phone, `▶ .${cmd} from ${sender.split("@")[0]}`)

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:       rest,
      full:       body,
      commands:   cmdRegistry,
      cmdList:    [...cmdRegistry.keys()].map(k => `.${k}`).sort(),
      isOwner:    sender.replace(/\D/g, "").includes(OWNER_PHONE),
      isGroup:    from.endsWith("@g.us"),
      isAdmin:    false,
      isBotAdmin: false,
      extractBody,
      settings: {
        botName: process.env.BOT_NAME || "CYBER X",
        prefix:  ".",
        owner:   OWNER_PHONE,
        get(k)  { return this[k] },
      },
    })
  } catch (e) {
    gwLog(phone, `✗ .${cmd} error: ${e.message}`)
    try {
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — USER INSTANCE MANAGER
// Each user who links their WhatsApp gets their own Baileys socket here.
// ─────────────────────────────────────────────────────────────────────────────

// phone -> { sock, status, qr, pairingCode, method, startedAt, groups,
//            msgCount, logs[], reconnectTimer }
const instances = new Map()

function gwLog(phone, line) {
  const inst = instances.get(phone)
  const ts   = new Date().toISOString()
  const full = `[${ts}] ${line}`
  console.log(`[GW:${phone}] ${line}`)
  if (!inst) return
  inst.logs.push(full)
  if (inst.logs.length > 150) inst.logs.shift()
}

function saveInstances() {
  const data = {}
  for (const [phone, s] of instances.entries()) {
    data[phone] = { method: s.method, status: s.status, startedAt: s.startedAt }
  }
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)) } catch {}
}

function instanceMeta(phone) {
  const s = instances.get(phone)
  if (!s) return null
  return {
    phone,
    status:      s.status,
    method:      s.method,
    startedAt:   s.startedAt,
    groups:      s.groups    || 0,
    msgCount:    s.msgCount  || 0,
    commands:    cmdRegistry.size,
    uptime:      s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
    memory:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    pairCode:    s.pairingCode || null,
    qr:          s.qr         || null,
  }
}

function maskPhone(phone) {
  if (phone.length <= 7) return phone
  return phone.slice(0, 4) + "****" + phone.slice(-3)
}

async function startInstance(phone, opts = {}) {
  const existing    = instances.get(phone)
  const method      = opts.method      ?? existing?.method      ?? "qr"
  const phoneNumber = opts.phoneNumber ?? existing?.phoneNumber ?? phone

  const sessionPath = path.join(GW_SESSIONS, phone)
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })),
    },
    printQRInTerminal: false,
    logger:            Pino({ level: "silent" }),
    browser:           ["CYBER X", "Chrome", "1.0"],
  })

  // Clean up old socket
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer)
  if (existing?.sock) {
    try { existing.sock.ev.removeAllListeners(); existing.sock.end(undefined) } catch {}
  }

  instances.set(phone, {
    sock,
    status:       "connecting",
    qr:           null,
    pairingCode:  null,
    method,
    phoneNumber,
    startedAt:    Date.now(),
    groups:       0,
    msgCount:     existing?.msgCount || 0,
    logs:         existing?.logs     || [],
    reconnectTimer: null,
  })

  gwLog(phone, `▶ Starting (method: ${method})`)

  // Pairing code flow
  if (method === "pairing" && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""))
        const inst = instances.get(phone)
        if (inst) inst.pairingCode = code
        gwLog(phone, `🔑 Pairing code: ${code}`)
      } catch (e) {
        gwLog(phone, `✗ Pairing code failed: ${e.message}`)
      }
    }, 1500)
  }

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const inst = instances.get(phone)
    if (!inst) return

    if (qr && method === "qr") {
      inst.qr = await QRCode.toDataURL(qr)
      gwLog(phone, "📷 QR ready — waiting for scan")
    }

    if (connection === "open") {
      inst.status      = "online"
      inst.qr          = null
      inst.pairingCode = null
      gwLog(phone, `✔ Connected as ${sock.user?.id || "unknown"}`)

      try {
        const all    = await sock.groupFetchAllParticipating()
        inst.groups  = Object.keys(all).length
      } catch {}

      saveInstances()
    }

    if (connection === "close") {
      inst.status = "stopped"
      const code  = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        gwLog(phone, "✗ Logged out — session cleared")
        instances.delete(phone)
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        saveInstances()
      } else {
        gwLog(phone, `↻ Reconnecting in 3s (code ${code})`)
        inst.reconnectTimer = setTimeout(() =>
          startInstance(phone, { method, phoneNumber }), 3000)
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      const inst = instances.get(phone)
      if (inst) inst.msgCount = (inst.msgCount || 0) + 1
      runCommand(sock, msg, phone).catch(() => {})
    }
  })
}

async function stopInstance(phone) {
  const inst = instances.get(phone)
  if (!inst) return
  if (inst.reconnectTimer) clearTimeout(inst.reconnectTimer)
  try { inst.sock?.ev?.removeAllListeners(); inst.sock?.end(undefined) } catch {}
  inst.status = "stopped"
  inst.sock   = null
  saveInstances()
  gwLog(phone, "⏹ Stopped")
}

async function deleteInstance(phone) {
  await stopInstance(phone)
  instances.delete(phone)
  try { fs.rmSync(path.join(GW_SESSIONS, phone), { recursive: true, force: true }) } catch {}
  saveInstances()
  console.log(`[GW] 🗑 Deleted: ${phone}`)
}

async function restoreInstances() {
  if (!fs.existsSync(DATA_FILE)) return
  let data = {}
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) } catch { return }
  const phones = Object.keys(data)
  console.log(`[GW] Restoring ${phones.length} saved instance(s)...`)
  for (const phone of phones) {
    const credsPath = path.join(GW_SESSIONS, phone, "creds.json")
    if (!fs.existsSync(credsPath)) continue
    try {
      await startInstance(phone, { method: data[phone].method || "qr", phoneNumber: phone })
    } catch (e) {
      console.error(`[GW] Restore ${phone} failed:`, e.message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — HTTP SERVER (create.xyz talks to this)
// ─────────────────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(resolve => {
    let b = ""
    req.on("data", d => { b += d })
    req.on("end",  () => { try { resolve(JSON.parse(b || "{}")) } catch { resolve({}) } })
    req.on("error",() => resolve({}))
  })
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Secret,Authorization")
}

function json(res, code, data) {
  setCors(res)
  res.writeHead(code, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

function checkAuth(req, res) {
  const h = req.headers["x-secret"] || (req.headers["authorization"] || "").replace("Bearer ", "")
  if (h !== MANAGER_SECRET) {
    json(res, 401, { ok: false, error: "Unauthorized" })
    return false
  }
  return true
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    setCors(res)
    res.writeHead(204)
    return res.end()
  }

  const url    = req.url.split("?")[0]
  const method = req.method

  // ── Health / ping ─────────────────────────────────────────────────────────
  if (url === "/" || url === "/health" || url === "/ping") {
    const all = [...instances.values()]
    return json(res, 200, {
      ok:       true,
      service:  "CYBER X Gateway",
      uptime:   Math.floor(process.uptime()),
      memory:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      online:   all.filter(i => i.status === "online").length,
      total:    instances.size,
      commands: cmdRegistry.size,
    })
  }

  // ── POST /instance/create  { phone, method: "qr"|"pairing" } ─────────────
  if (url === "/instance/create" && method === "POST") {
    if (!checkAuth(req, res)) return
    const body   = await readBody(req)
    const phone  = (body.phone || "").replace(/\D/g, "")
    const mth    = body.method || "qr"

    if (!phone || phone.length < 7) {
      return json(res, 400, { ok: false, error: "Valid phone number required with country code" })
    }
    if (!["qr", "pairing"].includes(mth)) {
      return json(res, 400, { ok: false, error: 'method must be "qr" or "pairing"' })
    }

    const existing = instances.get(phone)
    if (existing?.status === "online") {
      return json(res, 200, { ok: true, status: "online", message: "Already connected" })
    }

    await startInstance(phone, { method: mth, phoneNumber: phone })
    return json(res, 200, {
      ok:      true,
      phone,
      method:  mth,
      message: mth === "qr"
        ? `Poll GET /instance/${phone}/qr for the QR code`
        : `Poll GET /instance/${phone}/pair for the pairing code`,
    })
  }

  // ── GET /instance/:phone/qr ───────────────────────────────────────────────
  let m = url.match(/^\/instance\/(\d+)\/qr$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Instance not found" })
    return json(res, 200, {
      ok:     true,
      status: inst.status,
      qr:     inst.qr || null,
    })
  }

  // ── GET /instance/:phone/pair ─────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/pair$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Instance not found" })
    return json(res, 200, {
      ok:          true,
      status:      inst.status,
      pairCode:    inst.pairingCode || null,
      pairingCode: inst.pairingCode || null,
    })
  }

  // ── GET /instance/:phone/logs ─────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/logs$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const inst = instances.get(m[1])
    if (!inst) return json(res, 404, { ok: false, error: "Instance not found" })
    return json(res, 200, { ok: true, phone: m[1], logs: inst.logs.slice(-100) })
  }

  // ── GET /instance/:phone ──────────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)$/)
  if (m && method === "GET") {
    if (!checkAuth(req, res)) return
    const meta = instanceMeta(m[1])
    if (!meta) return json(res, 404, { ok: false, error: "Instance not found" })
    return json(res, 200, { ok: true, ...meta })
  }

  // ── POST /instance/:phone/stop ────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/stop$/)
  if (m && method === "POST") {
    if (!checkAuth(req, res)) return
    await stopInstance(m[1])
    return json(res, 200, { ok: true })
  }

  // ── POST /instance/:phone/restart ─────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)\/restart$/)
  if (m && method === "POST") {
    if (!checkAuth(req, res)) return
    const phone = m[1]
    const inst  = instances.get(phone)
    const mth   = inst?.method || "qr"
    await stopInstance(phone)
    setTimeout(() => startInstance(phone, { method: mth, phoneNumber: phone }), 1500)
    return json(res, 200, { ok: true, message: "Restarting..." })
  }

  // ── DELETE /instance/:phone ───────────────────────────────────────────────
  m = url.match(/^\/instance\/(\d+)$/)
  if (m && method === "DELETE") {
    if (!checkAuth(req, res)) return
    await deleteInstance(m[1])
    return json(res, 200, { ok: true, deleted: true })
  }

  // ── GET /instances  (admin — all instances) ───────────────────────────────
  if (url === "/instances" && method === "GET") {
    if (!checkAuth(req, res)) return
    return json(res, 200, {
      ok: true,
      instances: [...instances.entries()].map(([phone, s]) => ({
        phone,
        status:    s.status,
        method:    s.method,
        startedAt: s.startedAt,
        groups:    s.groups   || 0,
        msgCount:  s.msgCount || 0,
        commands:  cmdRegistry.size,
        uptime:    s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
      })),
    })
  }

  // ── GET /dashboard  (public stats) ───────────────────────────────────────
  if (url === "/dashboard" && method === "GET") {
    const all = [...instances.values()]
    return json(res, 200, {
      ok:             true,
      totalOnline:    all.filter(i => i.status === "online").length,
      totalInstances: instances.size,
      pairing:        all.filter(i => i.status === "connecting").length,
      stopped:        all.filter(i => i.status === "stopped").length,
      uptime:         Math.floor(process.uptime()),
      memory:         Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      commands:       cmdRegistry.size,
      instances: [...instances.entries()].map(([phone, s]) => ({
        phone:  maskPhone(phone),
        status: s.status,
      })),
    })
  }

  // ── GET /commands ─────────────────────────────────────────────────────────
  if (url === "/commands" && method === "GET") {
    return json(res, 200, {
      ok:       true,
      total:    cmdRegistry.size,
      commands: [...cmdRegistry.values()].map(c => ({
        pattern:  c.pattern,
        desc:     c.desc     || "",
        usage:    c.usage    || "",
        category: c.category || "general",
      })).sort((a, b) => a.pattern.localeCompare(b.pattern)),
    })
  }

  // ── POST /send  { phone, to, message } ───────────────────────────────────
  if (url === "/send" && method === "POST") {
    if (!checkAuth(req, res)) return
    const body = await readBody(req)
    const { phone, to, message } = body

    if (!phone || !to || !message) {
      return json(res, 400, { ok: false, error: "phone, to, and message are required" })
    }

    const inst = instances.get(phone)
    if (!inst || inst.status !== "online") {
      return json(res, 409, { ok: false, error: "Instance not connected" })
    }

    try {
      const jid = to.includes("@") ? to : `${to.replace(/\D/g, "")}@s.whatsapp.net`
      await inst.sock.sendMessage(jid, { text: message })
      return json(res, 200, { ok: true })
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message })
    }
  }

  // ── POST /admin/save ──────────────────────────────────────────────────────
  if (url === "/admin/save" && method === "POST") {
    if (!checkAuth(req, res)) return
    saveInstances()
    return json(res, 200, { ok: true, saved: true })
  }

  json(res, 404, { ok: false, error: "Route not found" })
})

server.keepAliveTimeout = 120000
server.headersTimeout   = 125000

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`
╔══════════════════════════════════════════╗
║   ⚡  CYBER X — Gateway + Bot Manager   ║
║   Port    : ${String(PORT).padEnd(28)}║
║   Secret  : ${MANAGER_SECRET ? "✔ Set" : "⚠ NOT SET — set MANAGER_SECRET"}${" ".repeat(Math.max(0, 23 - (MANAGER_SECRET ? 5 : 34)))}║
║   Owner   : ${OWNER_PHONE.slice(0, 20).padEnd(28)}║
╚══════════════════════════════════════════╝
  `)

  // Restore previously saved user sessions
  await restoreInstances()
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[SERVER] SIGTERM — saving and shutting down...")
  for (const [phone] of instances) stopInstance(phone)
  saveInstances()
  setTimeout(() => process.exit(0), 3000)
})
