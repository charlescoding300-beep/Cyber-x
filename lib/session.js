// ─────────────────────────────────────────────────────────────────────────────
// lib/session.js  —  CYBER X  |  Multi-User Session Manager
// Fully wired with lib/isAdmin.js — real admin checks for every user session
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

// ── Capacity ──────────────────────────────────────────────────────────────────
// Render free = 4 | Render paid = 10 | VPS 4GB = 50+
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "4")

// ── Session store ─────────────────────────────────────────────────────────────
// phone -> { sock, status, pairingCode, groupCache, groups, msgCount, logs[], reconnectTimer }
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

// Hot reload commands when files change
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
  const s  = sessions.get(phone)
  const ts = new Date().toISOString()
  console.log(`[SESSION:${phone}] ${line}`)
  if (!s) return
  s.logs.push(`[${ts}] ${line}`)
  if (s.logs.length > 100) s.logs.shift()
}

function extractBody(msg) {
  const m = msg?.message
  if (!m) return ""
  const inner =
    m.ephemeralMessage?.message  ||
    m.viewOnceMessage?.message   ||
    m.viewOnceMessageV2?.message ||
    m
  return (
    inner.conversation                                           ||
    inner.extendedTextMessage?.text                             ||
    inner.imageMessage?.caption                                 ||
    inner.videoMessage?.caption                                 ||
    inner.documentMessage?.caption                              ||
    inner.buttonsResponseMessage?.selectedButtonId              ||
    inner.listResponseMessage?.singleSelectReply?.selectedRowId ||
    inner.templateButtonReplyMessage?.selectedId               ||
    ""
  )
}

function saveSessions() {
  const data = {}
  for (const [phone, s] of sessions.entries())
    data[phone] = { status: s.status, startedAt: s.startedAt }
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)) } catch {}
}

// ── Admin checker — uses lib/isAdmin.js logic per-session groupCache ──────────
// Each session has its own groupCache so admin checks are independent per user
function stripDevice(jid) {
  return (jid || "").replace(/:.*@/, "@")
}

function toNum(jid) {
  return stripDevice(jid || "").split("@")[0].replace(/\D/g, "")
}

function buildAdminSet(groupCache, from) {
  const meta = groupCache?.[from]
  if (!meta?.participants) return new Set()
  const admins = new Set()
  for (const p of meta.participants) {
    if (p.admin !== "admin" && p.admin !== "superadmin") continue
    // Clean JID — strip :device suffix
    admins.add(stripDevice(p.id || "").split("@")[0])
    // Also handle @lid participants
    if (p.id?.endsWith("@lid") && p.phoneNumber)
      admins.add(p.phoneNumber.replace(/\D/g, ""))
    if (p.lid)
      admins.add(stripDevice(p.lid).split("@")[0])
  }
  return admins
}

// sender    → msg.key.participant (often @lid now)
// senderAlt → msg.key.participantPn (the phone-number form, when WhatsApp sends it)
// WhatsApp's @lid migration means a sender can show up as either their lid
// number or phone number depending on what groupMetadata returned for them —
// check both representations before deciding.
function checkAdmin(groupCache, sock, from, sender, senderAlt) {
  if (!from?.endsWith("@g.us")) return { isAdmin: false, isBotAdmin: false }
  const admins    = buildAdminSet(groupCache, from)
  const senderNum = stripDevice(sender).split("@")[0]
  const altNum    = senderAlt ? stripDevice(senderAlt).split("@")[0] : null
  const botNum    = stripDevice(sock?.user?.id || "").split("@")[0]

  const isAdmin = admins.has(senderNum) || (altNum && admins.has(altNum))

  return {
    isAdmin,
    isBotAdmin: admins.has(botNum),
  }
}

// ── Owner checker — REAL per-user check ────────────────────────────────────
// Each linked session belongs to exactly one phone number (the number that
// paired it). Only messages from that number — in any chat the session can
// see, including its own groups — should count as "owner". Previously this
// was hardcoded to `true` for every message, which meant ANYONE messaging
// in a group where a linked session's bot was present got full owner
// privileges. This now checks the actual sender against the session's own
// phone, plus an optional global owner list (settings.owners / OWNER_NUMBER)
// so the gateway operator can still use owner commands if needed.
function checkOwner(phone, sender, senderAlt, userSettings) {
  const ownerNum  = String(phone || "").replace(/\D/g, "")
  const senderNum = toNum(sender)
  const altNum    = senderAlt ? toNum(senderAlt) : null

  // 1. The number that linked this session is always its owner
  if (ownerNum && (senderNum === ownerNum || (altNum && altNum === ownerNum))) return true

  // 2. Optional global owners (gateway operator / support)
  try {
    const settings = require("./settings")
    if (typeof settings.isOwner === "function") {
      if (settings.isOwner(sender) || (senderAlt && settings.isOwner(senderAlt))) return true
    }
    const owners = settings.owners || settings.store?.owners || []
    if (owners.includes(senderNum) || (altNum && owners.includes(altNum))) return true
  } catch {}

  const envOwner = (process.env.OWNER_NUMBER || "").replace(/\D/g, "")
  if (envOwner && (senderNum === envOwner || (altNum && altNum === envOwner))) return true

  return false
}

// ── Per-session settings (reads from lib/settings if available) ───────────────
function getSessionSettings(phone) {
  try {
    const s = require("./settings")
    return s.forUser ? s.forUser(phone) : s
  } catch {
    return {
      botName: process.env.BOT_NAME || "CYBER X",
      prefix:  ".",
      owner:   phone,
      get(k)   { return this[k] },
      set(k,v) { this[k] = v },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// Full parity with index.js — real isAdmin, isBotAdmin, isOwner, settings, prefix
// ─────────────────────────────────────────────────────────────────────────────
async function handleMessage(sock, msg, phone) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  // Read prefix from settings (user override → global fallback)
  const userSettings = getSessionSettings(phone)
  const prefix = (typeof userSettings.get === "function"
    ? userSettings.get("prefix")
    : userSettings.prefix) || "."

  if (!body.startsWith(prefix)) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const isGroup   = from.endsWith("@g.us")

  // ── Real admin + owner check using this session's groupCache ──────────────
  const s = sessions.get(phone)
  const { isAdmin, isBotAdmin } = checkAdmin(s?.groupCache || {}, sock, from, sender, senderAlt)
  const isOwner = checkOwner(phone, sender, senderAlt, userSettings)

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = cmdMap.get(cmd)
  if (!command) return

  sessionLog(phone, `▶ .${cmd} | owner:${isOwner} admin:${isAdmin} botAdmin:${isBotAdmin} group:${isGroup}`)

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
      isOwner,      // ✅ real per-user owner check
      isGroup,
      isAdmin,      // ✅ real admin check
      isBotAdmin,   // ✅ real bot admin check
      extractBody,
      groupCache:   s?.groupCache || {},
      settings:     userSettings,
      lib:          {},
      helper: {
        async reply(sock, msg, text) {
          return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
        },
        sleep: ms => new Promise(r => setTimeout(r, ms)),
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

  // ── Capacity check ────────────────────────────────────────────────────────
  const activeCount = [...sessions.values()].filter(
    s => s.status === "online" || s.status === "connecting"
  ).length
  const isExisting = sessions.has(phone)

  if (!isExisting && activeCount >= MAX_SESSIONS) {
    const fullMsg =
      `╔══════════════════════════╗\n` +
      `║  ⚠️  BOT IS FULL          ║\n` +
      `╠══════════════════════════╣\n` +
      `║  Max ${MAX_SESSIONS} users are currently  ║\n` +
      `║  connected. All slots    ║\n` +
      `║  are taken right now.    ║\n` +
      `║                          ║\n` +
      `║  Try again later when    ║\n` +
      `║  a slot opens up. 🙏     ║\n` +
      `╚══════════════════════════╝\n\n` +
      `© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    if (typeof onFail === "function") onFail(fullMsg)
    return null
  }

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
    // Each session gets its own group metadata cache
    cachedGroupMetadata: async (jid) => sessions.get(phone)?.groupCache?.[jid],
  })

  // ── Clean up existing socket ──────────────────────────────────────────────
  const existing = sessions.get(phone)
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer)
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners()
      existing.sock.end(undefined)
    } catch {}
  }

  // ── Create session entry with its own groupCache ──────────────────────────
  sessions.set(phone, {
    sock,
    status:         "connecting",
    pairingCode:    null,
    startedAt:      Date.now(),
    groups:         0,
    msgCount:       existing?.msgCount || 0,
    logs:           existing?.logs     || [],
    reconnectTimer: null,
    groupCache:     {},    // ← each user session has its own group cache
    _onConnected:   onConnected || null,
    _onFail:        onFail      || null,
  })

  sock.ev.on("creds.update", saveCreds)

  // ── Group cache maintenance — mirrors index.js ────────────────────────────
  sock.ev.on("groups.upsert", gs => {
    const s = sessions.get(phone)
    if (!s) return
    for (const g of gs) s.groupCache[g.id] = { ...g, _cachedAt: Date.now() }
  })
  sock.ev.on("groups.update", us => {
    const s = sessions.get(phone)
    if (!s) return
    for (const u of us) {
      s.groupCache[u.id] = s.groupCache[u.id]
        ? Object.assign(s.groupCache[u.id], u, { _cachedAt: Date.now() })
        : { ...u, _cachedAt: Date.now() }
    }
  })
  sock.ev.on("group-participants.update", async ({ id }) => {
    const s = sessions.get(phone)
    if (!s) return
    try {
      s.groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() }
    } catch {}
  })

  // ── Welcome/goodbye listener for this session ─────────────────────────────
  try {
    const gp = require("./groupParticipants")
    gp.init(sock)
    sessionLog(phone, "✔ Welcome/Goodbye listener active")
  } catch {}

  // ── Request pairing code if not yet registered ────────────────────────────
  if (!state.creds.registered) {
    setTimeout(async () => {
      try {
        const cleanPhone = phone.replace(/\D/g, "")
        const code = await sock.requestPairingCode(cleanPhone)
        const s    = sessions.get(phone)
        if (s) {
          s.pairingCode = code
          sessionLog(phone, `🔑 Pairing code: ${code}`)
        }
        if (typeof onPairCode === "function") onPairCode(code)
      } catch (e) {
        sessionLog(phone, `✗ Pairing code error: ${e.message}`)
        if (typeof onFail === "function") onFail(e.message)
      }
    }, 3000)
  } else {
    sessionLog(phone, "↩ Already registered — reconnecting...")
  }

  // ── Connection state handler ──────────────────────────────────────────────
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    const s = sessions.get(phone)
    if (!s) return

    if (connection === "open") {
      s.status      = "online"
      s.pairingCode = null
      sessionLog(phone, `✔ Connected as ${sock.user?.id || "unknown"}`)

      // Seed groupCache from all participating groups
      try {
        const all = await sock.groupFetchAllParticipating()
        s.groups = Object.keys(all).length
        for (const [jid, meta] of Object.entries(all))
          s.groupCache[jid] = { ...meta, _cachedAt: Date.now() }
        sessionLog(phone, `✔ Cached ${s.groups} groups for admin checks`)
      } catch {}

      saveSessions()

      // Fire onConnected callback to fuckme.js
      if (typeof s._onConnected === "function") {
        s._onConnected()
        s._onConnected = null
      }
    }

    if (connection === "close") {
      s.status = "stopped"
      const code = lastDisconnect?.error?.output?.statusCode

      if (code === DisconnectReason.loggedOut) {
        sessionLog(phone, "✗ Logged out — clearing session")
        if (typeof s._onFail === "function") {
          s._onFail("Logged out")
          s._onFail = null
        }
        sessions.delete(phone)
        try { fs.rmSync(sessionPath, { recursive: true, force: true }) } catch {}
        saveSessions()
      } else {
        sessionLog(phone, `↻ Reconnecting in 3s (code ${code})`)
        if (typeof s._onFail === "function" && s.status !== "online") {
          s._onFail(`Connection closed (code ${code})`)
          s._onFail = null
        }
        s.reconnectTimer = setTimeout(() => startSession(phone), 3000)
      }
    }
  })

  // ── Message handler ───────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      handleMessage(sock, msg, phone).catch(() => {})
    }
  })

  return sessions.get(phone)
}

// ── Public API ────────────────────────────────────────────────────────────────
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
      await startSession(phone)
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
