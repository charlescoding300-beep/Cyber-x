// ─────────────────────────────────────────────────────────────────────────────
// lib/session.js  —  CYBER X  |  Multi-User Session Manager
//
// Auto-loaded by index.js via lib loader — zero changes to index.js needed.
//
// HOW IT WORKS:
//   1. When a user runs .fuckme 2348xxx → pairing code is generated
//   2. User enters code in WhatsApp → their session connects
//   3. Their session runs INDEPENDENTLY — same commands/ folder as your bot
//   4. Each user's session is saved in gateway_sessions/<phone>/
//   5. All sessions auto-restore on bot restart
//
// Their bot behaves exactly like your own bot (index.js) — same commands,
// same prefix, same everything. Just a different WhatsApp number.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")
const Pino = require("pino")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

const SESSIONS_DIR = path.join(__dirname, "..", "gateway_sessions")
const DATA_FILE    = path.join(__dirname, "..", "data", "gw_sessions.json")
const CMD_DIR      = path.join(__dirname, "..", "commands")

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true })
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STORE
// phone -> { sock, status, pairingCode, groups, msgCount, logs[], reconnectTimer }
// ─────────────────────────────────────────────────────────────────────────────

const sessions = new Map()

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND REGISTRY  — shared from commands/ folder
// ─────────────────────────────────────────────────────────────────────────────

const cmdMap = new Map()

function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  cmdMap.clear()
  let ok = 0
  for (const file of fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (mod?.pattern && typeof mod.run === "function") {
        const key = mod.pattern.replace(/^\./, "").toLowerCase().trim()
        cmdMap.set(key, mod)
        ok++
      }
    } catch (e) {
      console.error(`[SESSION:CMD] ✗ ${file}: ${e.message}`)
    }
  }
  console.log(`[SESSION] ✔ ${ok} commands loaded`)
}

// Hot reload commands when files change
let cmdDebounce = null
if (fs.existsSync(CMD_DIR)) {
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(cmdDebounce)
    cmdDebounce = setTimeout(loadCommands, 150)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sessionLog(phone, line) {
  const s   = sessions.get(phone)
  const ts  = new Date().toISOString()
  const full = `[${ts}] ${line}`
  console.log(`[SESSION:${phone}] ${line}`)
  if (!s) return
  s.logs.push(full)
  if (s.logs.length > 100) s.logs.shift()
}

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

function saveSessions() {
  const data = {}
  for (const [phone, s] of sessions.entries()) {
    data[phone] = { status: s.status, startedAt: s.startedAt }
  }
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)) } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND HANDLER  — runs for each linked user's messages
// Identical logic to index.js handleMessage so users get same experience
// ─────────────────────────────────────────────────────────────────────────────

async function handleMessage(sock, msg, phone) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const prefix = "."
  if (!body.startsWith(prefix)) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const isGroup = from.endsWith("@g.us")

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = cmdMap.get(cmd)
  if (!command) return

  sessionLog(phone, `▶ .${cmd} from ${sender.split("@")[0]}`)

  // Track message count
  const s = sessions.get(phone)
  if (s) s.msgCount = (s.msgCount || 0) + 1

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:       rest,
      full:       body,
      commands:   cmdMap,
      cmdList:    [...cmdMap.keys()].map(k => `.${k}`).sort(),
      isOwner:    false,   // linked users are never "owner" of the main bot
      isGroup,
      isAdmin:    false,
      isBotAdmin: false,
      extractBody,
      settings: {
        botName: process.env.BOT_NAME || "CYBER X",
        prefix:  ".",
        owner:   phone,   // for their session, they are effectively "owner"
        get(k)  { return this[k] },
        set(k, v) { this[k] = v },
      },
    })
  } catch (e) {
    sessionLog(phone, `✗ .${cmd} error: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ Error: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START SESSION  — creates a Baileys socket for a user
// ─────────────────────────────────────────────────────────────────────────────

async function startSession(phone) {
  const sessionPath = path.join(SESSIONS_DIR, phone)
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version }          = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })),
    },
    printQRInTerminal:   false,
    logger:              Pino({ level: "silent" }),
    browser:             ["CYBER X", "Chrome", "1.0"],
    markOnlineOnConnect: false,
    syncFullHistory:     false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs:    60000,
    retryRequestDelayMs: 2000,
  })

  // Clean up existing socket for this phone
  const existing = sessions.get(phone)
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer)
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners()
      existing.sock.end(undefined)
    } catch {}
  }

  sessions.set(phone, {
    sock,
    status:       "connecting",
    pairingCode:  null,
    startedAt:    Date.now(),
    groups:       0,
    msgCount:     existing?.msgCount || 0,
    logs:         existing?.logs     || [],
    reconnectTimer: null,
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    const s = sessions.get(phone)
    if (!s) return

    if (connection === "open") {
      s.status      = "online"
      s.pairingCode = null
      sessionLog(phone, `✔ Connected as ${sock.user?.id || "unknown"}`)

      // Count groups
      try {
        const all = await sock.groupFetchAllParticipating()
        s.groups  = Object.keys(all).length
      } catch {}

      saveSessions()
    }

    if (connection === "close") {
      s.status = "stopped"
      const code = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        sessionLog(phone, "✗ Logged out — clearing session")
        sessions.delete(phone)
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        saveSessions()
      } else {
        sessionLog(phone, `↻ Reconnecting in 3s (code ${code})`)
        s.reconnectTimer = setTimeout(() => startSession(phone), 3000)
      }
    }
  })

  // ── Message handler — same as index.js ─────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      handleMessage(sock, msg, phone).catch(() => {})
    }
  })

  return sessions.get(phone)
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST PAIRING CODE  — called by .fuckme command
// ─────────────────────────────────────────────────────────────────────────────

async function requestPairingCode(phone) {
  // Check if already connected
  const existing = sessions.get(phone)
  if (existing?.status === "online") {
    return { status: "online", pairingCode: null }
  }

  // Start a fresh session for this phone
  await startSession(phone)

  // Wait a moment for socket to initialize
  await new Promise(r => setTimeout(r, 2000))

  // Request the pairing code
  const s = sessions.get(phone)
  if (!s?.sock) throw new Error("Session failed to start")

  const state = await useMultiFileAuthState(path.join(SESSIONS_DIR, phone))
  if (state.state.creds.registered) {
    return { status: "already_registered", pairingCode: null }
  }

  const code = await s.sock.requestPairingCode(phone.replace(/\D/g, ""))
  s.pairingCode = code
  sessionLog(phone, `🔑 Pairing code: ${code}`)

  return { status: "pairing", pairingCode: code }
}

// ─────────────────────────────────────────────────────────────────────────────
// WAIT FOR CONNECTION  — called after pairing code is shown to user
// Resolves when user enters code and bot connects (or times out)
// ─────────────────────────────────────────────────────────────────────────────

function waitForConnection(phone, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const start = Date.now()

    const check = setInterval(() => {
      const s = sessions.get(phone)

      if (s?.status === "online") {
        clearInterval(check)
        resolve({ connected: true })
        return
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(check)
        resolve({ connected: false, reason: "timeout" })
      }
    }, 2000)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET SESSION INFO  — used by gateway API routes
// ─────────────────────────────────────────────────────────────────────────────

function getSession(phone) {
  return sessions.get(phone)
}

function getAllSessions() {
  return [...sessions.entries()].map(([phone, s]) => ({
    phone,
    status:    s.status,
    groups:    s.groups   || 0,
    msgCount:  s.msgCount || 0,
    startedAt: s.startedAt,
    uptime:    s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
  }))
}

async function stopSession(phone) {
  const s = sessions.get(phone)
  if (!s) return
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer)
  try {
    s.sock?.ev?.removeAllListeners()
    s.sock?.end(undefined)
  } catch {}
  s.status = "stopped"
  s.sock   = null
  saveSessions()
}

async function deleteSession(phone) {
  await stopSession(phone)
  sessions.delete(phone)
  try { fs.rmSync(path.join(SESSIONS_DIR, phone), { recursive: true, force: true }) } catch {}
  saveSessions()
}

// ─────────────────────────────────────────────────────────────────────────────
// RESTORE ALL SESSIONS ON BOOT
// ─────────────────────────────────────────────────────────────────────────────

async function restoreAll() {
  if (!fs.existsSync(SESSIONS_DIR)) return

  const dirs = fs.readdirSync(SESSIONS_DIR).filter(f => {
    const full = path.join(SESSIONS_DIR, f)
    return fs.statSync(full).isDirectory() &&
           fs.existsSync(path.join(full, "creds.json"))
  })

  if (dirs.length === 0) return
  console.log(`[SESSION] 🔄 Restoring ${dirs.length} linked session(s)...`)

  for (const phone of dirs) {
    try {
      await startSession(phone)
      console.log(`[SESSION] ✔ Restored: ${phone}`)
    } catch (e) {
      console.error(`[SESSION] ✗ Failed to restore ${phone}: ${e.message}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

loadCommands()
restoreAll().catch(e => console.error("[SESSION] Restore error:", e.message))

console.log("[SESSION] ✔ Multi-user session manager ready")

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS  — used by commands/fuckme.js and server.js
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  requestPairingCode,
  waitForConnection,
  getSession,
  getAllSessions,
  startSession,
  stopSession,
  deleteSession,
  sessions,
}

