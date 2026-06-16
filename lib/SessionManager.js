const path  = require("path")
const fs    = require("fs")
const Pino  = require("pino")
const QRCode = require("qrcode")

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

const { loadCommands, handleMessage } = require("./CommandHandler")

const SESSIONS_DIR = path.join(__dirname, "../sessions")
const MAX_RETRIES  = 10
const MAX_SESSIONS = 50  // auto-cleanup above this

// In-memory store: userId → { sock, status, qr, pairCode, retries, groupCache }
const sessions = new Map()

function getDelay(n) { return Math.min(1000 * Math.pow(2, n), 30000) }

function sessionPath(userId) {
  return path.join(SESSIONS_DIR, userId)
}

// ── Cleanup: remove oldest disconnected sessions if over limit ──
function autoCleanup() {
  if (sessions.size < MAX_SESSIONS) return
  let oldest = null
  for (const [id, s] of sessions.entries()) {
    if (s.status === "disconnected") {
      oldest = id
      break
    }
  }
  if (oldest) {
    console.log(`[CLEANUP] Removing disconnected session: ${oldest}`)
    destroySession(oldest)
  }
}

async function destroySession(userId) {
  const s = sessions.get(userId)
  if (s?.sock) {
    try { s.sock.end() } catch {}
    try { s.sock.ev.removeAllListeners() } catch {}
  }
  sessions.delete(userId)
  console.log(`[SESSION] 🗑 Destroyed: ${userId}`)
}

async function startSession(userId, method = "qr") {
  autoCleanup()

  // If already connected, return
  const existing = sessions.get(userId)
  if (existing?.status === "connected") {
    return { status: "already_connected" }
  }

  // Initialize entry
  sessions.set(userId, {
    sock:       null,
    status:     "connecting",
    qr:         null,
    qrBase64:   null,
    pairCode:   null,
    retries:    0,
    groupCache: {},
    method,
  })

  _boot(userId, method)
  return { status: "connecting", method }
}

async function _boot(userId, method) {
  const entry = sessions.get(userId)
  if (!entry) return

  try {
    const dir = sessionPath(userId)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const { state, saveCreds } = await useMultiFileAuthState(dir)
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
      cachedGroupMetadata: async (jid) => entry.groupCache[jid],
    })

    entry.sock = sock

    // ── QR or Pairing Code ───────────────────────────────────
    if (!state.creds.registered) {
      if (method === "pair") {
        // Pairing code — user must have put their number via /connect
        const number = entry.phoneNumber
        if (number) {
          setTimeout(async () => {
            try {
              const code = await sock.requestPairingCode(number)
              entry.pairCode = code
              entry.status   = "awaiting_pair"
              console.log(`[PAIR] ${userId} → ${code}`)
            } catch (e) {
              console.error(`[PAIR ERR] ${userId}:`, e.message)
            }
          }, 3000)
        }
      }
      // QR fires via connection.update below automatically
    }

    // ── Group cache events ───────────────────────────────────
    sock.ev.on("groups.upsert", groups => {
      for (const g of groups) entry.groupCache[g.id] = g
    })
    sock.ev.on("groups.update", updates => {
      for (const u of updates) {
        if (entry.groupCache[u.id]) Object.assign(entry.groupCache[u.id], u)
        else entry.groupCache[u.id] = u
      }
    })
    sock.ev.on("group-participants.update", async ({ id }) => {
      try { entry.groupCache[id] = await sock.groupMetadata(id) } catch {}
    })

    // ── Messages ─────────────────────────────────────────────
    const BOT_START = Math.floor(Date.now() / 1000)
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        const ts = Number(m.messageTimestamp) || 0
        if (ts < BOT_START - 15) continue
        handleMessage(sock, m, m.key.fromMe, entry, userId).catch(() => {})
      }
    })

    // ── Connection state ─────────────────────────────────────
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        entry.qr       = qr
        entry.status   = "awaiting_qr"
        try {
          entry.qrBase64 = await QRCode.toDataURL(qr)
        } catch {}
        console.log(`[QR] ${userId} QR ready`)
      }

      if (connection === "open") {
        entry.retries  = 0
        entry.status   = "connected"
        entry.qr       = null
        entry.qrBase64 = null
        entry.pairCode = null
        console.log(`[SESSION] ✅ Connected: ${userId}`)

        // Warm group cache
        try {
          const all = await sock.groupFetchAllParticipating()
          for (const [jid, meta] of Object.entries(all)) {
            entry.groupCache[jid] = meta
          }
        } catch {}
      }

      if (connection === "close") {
        const code      = lastDisconnect?.error?.output?.statusCode
        const loggedOut = code === DisconnectReason.loggedOut
        const forbidden = code === DisconnectReason.forbidden

        if (loggedOut || forbidden) {
          entry.status = "logged_out"
          console.log(`[SESSION] 🚪 Logged out: ${userId}`)
          // Clean the session folder so they can re-pair
          try { fs.rmSync(sessionPath(userId), { recursive: true, force: true }) } catch {}
          sessions.delete(userId)
          return
        }

        entry.status = "reconnecting"
        console.log(`[SESSION] 🔄 Disconnected: ${userId} | code: ${code}`)

        if (entry.retries < MAX_RETRIES) {
          const delay = getDelay(entry.retries)
          entry.retries++
          console.log(`[SESSION] ↺ Retry ${entry.retries}/${MAX_RETRIES} in ${delay}ms — ${userId}`)
          setTimeout(() => _boot(userId, method), delay)
        } else {
          entry.status = "disconnected"
          console.log(`[SESSION] ✗ Max retries reached: ${userId}`)
        }
      }
    })

    sock.ev.on("creds.update", saveCreds)

  } catch (e) {
    console.error(`[BOOT ERR] ${userId}:`, e.message)
    const entry = sessions.get(userId)
    if (entry && entry.retries < MAX_RETRIES) {
      const delay = getDelay(entry.retries)
      entry.retries++
      entry.status = "reconnecting"
      setTimeout(() => _boot(userId, method), delay)
    }
  }
}

// ── Resume all sessions on server restart ────────────────────
async function resumeAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return
  const dirs = fs.readdirSync(SESSIONS_DIR)
  console.log(`[SESSION] 🔃 Resuming ${dirs.length} saved session(s)...`)
  for (const userId of dirs) {
    const p = sessionPath(userId)
    if (fs.statSync(p).isDirectory()) {
      sessions.set(userId, {
        sock: null, status: "connecting", qr: null,
        qrBase64: null, pairCode: null, retries: 0,
        groupCache: {}, method: "qr"
      })
      _boot(userId, "qr")
      await new Promise(r => setTimeout(r, 800)) // stagger boots
    }
  }
}

function getSession(userId)  { return sessions.get(userId) }
function getAllSessions()     { return sessions }

module.exports = {
  startSession,
  destroySession,
  getSession,
  getAllSessions,
  resumeAllSessions,
}
