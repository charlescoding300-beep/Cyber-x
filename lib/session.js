// ─────────────────────────────────────────────────────────────────────────────
// lib/session.js  —  CYBER X  |  Multi-User Session Manager
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

// ── Session store ─────────────────────────────────────────────────────────────
// phone -> { sock, status, pairingCode, groups, msgCount, logs[], reconnectTimer }
const sessions = new Map()

// ── Command registry ──────────────────────────────────────────────────────────
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

// Hot reload
let cmdDebounce = null
if (fs.existsSync(CMD_DIR)) {
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(cmdDebounce)
    cmdDebounce = setTimeout(loadCommands, 150)
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMessage(sock, msg, phone) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const prefix = "."
  if (!body.startsWith(prefix)) return

  const from    = msg.key.remoteJid
  const sender  = msg.key.participant || from
  const isGroup = from.endsWith("@g.us")

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = cmdMap.get(cmd)
  if (!command) return

  sessionLog(phone, `▶ .${cmd} from ${sender.split("@")[0]}`)

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
      isOwner:    false,
      isGroup,
      isAdmin:    false,
      isBotAdmin: false,
      extractBody,
      settings: {
        botName: process.env.BOT_NAME || "CYBER X",
        prefix:  ".",
        owner:   phone,
        get(k)   { return this[k] },
        set(k, v){ this[k] = v },
      },
    })
  } catch (e) {
    sessionLog(phone, `✗ .${cmd} error: ${e.message}`)
    try {
      await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START SESSION
// callbacks (all optional):
//   onPairCode(code)  — fired when pairing code is ready
//   onConnected()     — fired when WhatsApp connects successfully
//   onFail(reason)    — fired on unrecoverable error
// ─────────────────────────────────────────────────────────────────────────────
async function startSession(phone, callbacks = {}) {
  const { onPairCode, onConnected, onFail } = callbacks

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
    status:         "connecting",
    pairingCode:    null,
    startedAt:      Date.now(),
    groups:         0,
    msgCount:       existing?.msgCount || 0,
    logs:           existing?.logs     || [],
    reconnectTimer: null,
    // store callbacks so connection.update can fire them
    _onConnected:   onConnected || null,
    _onFail:        onFail      || null,
  })

  sock.ev.on("creds.update", saveCreds)

  // ── Request pairing code if not yet registered ────────────────────────────
  if (!state.creds.registered) {
    // Give socket a moment to initialise before requesting
    setTimeout(async () => {
      try {
        const cleanPhone = phone.replace(/\D/g, "")
        const code = await sock.requestPairingCode(cleanPhone)
        const s    = sessions.get(phone)
        if (s) {
          s.pairingCode = code
          sessionLog(phone, `🔑 Pairing code: ${code}`)
        }
        // Fire callback to fuckme.js
        if (typeof onPairCode === "function") onPairCode(code)
      } catch (e) {
        sessionLog(phone, `✗ Pairing code error: ${e.message}`)
        if (typeof onFail === "function") onFail(e.message)
      }
    }, 3000)
  } else {
    // Already registered — will connect straight away
    sessionLog(phone, "↩ Already registered — reconnecting...")
  }

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

      // Fire onConnected callback to fuckme.js
      if (typeof s._onConnected === "function") {
        s._onConnected()
        s._onConnected = null // only fire once
      }
    }

    if (connection === "close") {
      s.status = "stopped"
      const code = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        sessionLog(phone, "✗ Logged out — clearing session")
        // Fire onFail if still waiting
        if (typeof s._onFail === "function") {
          s._onFail("Logged out")
          s._onFail = null
        }
        sessions.delete(phone)
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        saveSessions()
      } else {
        sessionLog(phone, `↻ Reconnecting in 3s (code ${code})`)
        // Fire onFail if we never connected yet and this isn't a normal reconnect
        if (typeof s._onFail === "function" && s.status !== "online") {
          s._onFail(`Connection closed (code ${code})`)
          s._onFail = null
        }
        s.reconnectTimer = setTimeout(() => startSession(phone), 3000)
      }
    }
  })

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      handleMessage(sock, msg, phone).catch(() => {})
    }
  })

  return sessions.get(phone)
}

// ── getSession — used by fuckme.js ───────────────────────────────────────────
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

// ── Restore all sessions on boot ──────────────────────────────────────────────
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
      await startSession(phone)  // no callbacks on restore — silent reconnect
      console.log(`[SESSION] ✔ Restored: ${phone}`)
    } catch (e) {
      console.error(`[SESSION] ✗ Failed to restore ${phone}: ${e.message}`)
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadCommands()
restoreAll().catch(e => console.error("[SESSION] Restore error:", e.message))
console.log("[SESSION] ✔ Multi-user session manager ready")

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  startSession,
  getSession,
  getAllSessions,
  stopSession,
  deleteSession,
  sessions,
}

