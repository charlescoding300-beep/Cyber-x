"use strict"
// users/index.js — Multi-user session engine
// Loads lib/, utils/, commands/ — same as main index.js
// Has its own HTTP server on PORT+1, 4-min ping, group cache, full reconnect

const Pino   = require("pino")
const path   = require("path")
const fs     = require("fs")
const zlib   = require("zlib")
const http   = require("http")
const https  = require("https")
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys")

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT_DIR  = path.join(__dirname, "..")
const CMD_DIR   = path.join(ROOT_DIR, "commands")
const LIB_DIR   = path.join(ROOT_DIR, "lib")
const UTILS_DIR = path.join(ROOT_DIR, "utils")
const USERS_DIR = path.join(__dirname, "sessions")   // users/sessions/<phone>/

for (const d of [USERS_DIR])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ── Shared lib/utils (same as index.js loadDir) ───────────────────────────────
const lib = {}
function loadDir(dir, label) {
  if (!fs.existsSync(dir)) return
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()
  for (const file of files) {
    try {
      const full = path.join(dir, file)
      const name = path.basename(file, ".js")
      const exp  = require(full)
      lib[name]  = exp
      if (exp && typeof exp === "object") Object.assign(lib, exp)
      console.log(`[USERS-${label}] ✔ ${file}`)
    } catch (e) {
      console.error(`[USERS-${label}] ✗ ${file}: ${e.message}`)
    }
  }
}
loadDir(LIB_DIR,   "LIB")
loadDir(UTILS_DIR, "UTILS")

// ── Settings (from lib or fallback) ──────────────────────────────────────────
const BOT_PREFIX = process.env.BOT_PREFIX || "."
const settings   = lib.settings || {
  botName: process.env.BOT_NAME || "CYBER X",
  prefix:  BOT_PREFIX,
  owner:   process.env.OWNER_NUMBER || "",
  mode:    "public",
  get(k)    { return this[k] },
  set(k, v) { this[k] = v },
}

// ── HTTP server on PORT+1 so it doesn't clash with main bot ──────────────────
const MAIN_PORT  = Number(process.env.PORT || 3000)
const USERS_PORT = MAIN_PORT + 1
const SELF_URL   = process.env.RENDER_EXTERNAL_URL || `http://localhost:${MAIN_PORT}`

const sessions = new Map()

const userServer = http.createServer((req, res) => {
  const url = req.url.split("?")[0]
  if (url === "/users" || url === "/users/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" })
    return res.end(JSON.stringify({
      status:   "online",
      sessions: sessions.size,
      phones:   [...sessions.keys()],
      uptime:   Math.floor(process.uptime()),
      memory:   Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    }))
  }
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("⚡ CYBER X USERS ONLINE")
})
userServer.keepAliveTimeout = 120000
userServer.headersTimeout   = 125000
userServer.listen(USERS_PORT, "0.0.0.0", () =>
  console.log(`[USERS] ⚡ Users server on port ${USERS_PORT}`)
)

// ── 4-min self-ping to keep Render alive ─────────────────────────────────────
let pingCount = 0
function ping() {
  const url  = `${SELF_URL}/ping`
  const mod  = url.startsWith("https") ? https : http
  const req  = mod.get(url, () => {
    pingCount++
    console.log(`[USERS-PING] ✔ #${pingCount}`)
  })
  req.on("error", () => {})
  req.setTimeout(10000, () => { req.destroy() })
}
setTimeout(() => { ping(); setInterval(ping, 4 * 60 * 1000) }, 20000)

// ── Group cache cleanup every 30 min ─────────────────────────────────────────
setInterval(() => {
  let cleaned = 0
  const now = Date.now()
  for (const entry of sessions.values()) {
    for (const jid of Object.keys(entry.groupCache)) {
      if (entry.groupCache[jid]._cachedAt && now - entry.groupCache[jid]._cachedAt > 30 * 60 * 1000) {
        delete entry.groupCache[jid]; cleaned++
      }
    }
  }
  if (cleaned) console.log(`[USERS] 🧹 Cleaned ${cleaned} stale group cache entries`)
}, 30 * 60 * 1000)

// ═════════════════════════════════════════════════════════════════════════════
//  COMMAND REGISTRY  (loads commands/ — same folder as main bot)
// ═════════════════════════════════════════════════════════════════════════════
const sharedCmdMap   = new Map()
const sharedAliasMap = new Map()

const toKey    = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()
const getDelay = n => Math.min(1000 * Math.pow(2, n), 30000)
const MAX_RETRY = 10
const sleep     = ms => new Promise(r => setTimeout(r, ms))

function loadSharedCommands() {
  sharedCmdMap.clear()
  sharedAliasMap.clear()
  if (!fs.existsSync(CMD_DIR)) return
  for (const file of fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (!mod || typeof mod.pattern !== "string" || typeof mod.run !== "function") continue
      const key = toKey(mod.pattern)
      sharedCmdMap.set(key, mod)
      if (Array.isArray(mod.alias))
        for (const a of mod.alias) sharedAliasMap.set(toKey(a), key)
    } catch (e) {
      console.error(`[USERS-CMD] ✗ ${file}: ${e.message}`)
    }
  }
  console.log(`[USERS-CMD] ⚡ ${sharedCmdMap.size} commands loaded`)
}

loadSharedCommands()

// Hot-reload commands when files change
if (fs.existsSync(CMD_DIR)) {
  let debounce = null
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      loadSharedCommands()
      console.log(`[USERS-CMD] ↺ reloaded after: ${f}`)
    }, 150)
  })
}

// ═════════════════════════════════════════════════════════════════════════════
//  SESSION ENCODE / DECODE  (creds.json only — short base64)
// ═════════════════════════════════════════════════════════════════════════════
function encodeUserSession(phone) {
  try {
    const f = path.join(USERS_DIR, phone, "creds.json")
    if (!fs.existsSync(f)) return null
    return zlib.gzipSync(fs.readFileSync(f)).toString("base64")
  } catch { return null }
}

function decodeUserSession(phone, b64) {
  try {
    const dir = path.join(USERS_DIR, phone)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const raw = zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8")
    JSON.parse(raw) // validate JSON before writing
    fs.writeFileSync(path.join(dir, "creds.json"), raw, "utf8")
    console.log(`[USERS] ✔ creds.json restored for ${phone}`)
    return true
  } catch (e) {
    console.error(`[USERS] ✗ decode failed for ${phone}: ${e.message}`)
    return false
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MESSAGE EXTRACTOR
// ═════════════════════════════════════════════════════════════════════════════
function extractBody(msg) {
  const m = msg?.message
  if (!m) return ""
  const inner =
    m.ephemeralMessage?.message  ||
    m.viewOnceMessage?.message   ||
    m.viewOnceMessageV2?.message ||
    m
  return (
    inner.conversation                                            ||
    inner.extendedTextMessage?.text                              ||
    inner.imageMessage?.caption                                  ||
    inner.videoMessage?.caption                                  ||
    inner.documentMessage?.caption                               ||
    inner.buttonsResponseMessage?.selectedButtonId               ||
    inner.listResponseMessage?.singleSelectReply?.selectedRowId  ||
    inner.templateButtonReplyMessage?.selectedId                 ||
    ""
  )
}

// ═════════════════════════════════════════════════════════════════════════════
//  PER-USER MESSAGE HANDLER  (full command routing like main index.js)
// ═════════════════════════════════════════════════════════════════════════════
async function handleUserMsg(entry, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const prefix = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
  if (!body.startsWith(prefix)) return

  const { sock, phone, groupCache } = entry
  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const fromMe = msg.key.fromMe === true

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = sharedAliasMap.get(rawCmd) || rawCmd
  const command   = sharedCmdMap.get(canonical)
  if (!command) return

  const isOwner = (sender || "").replace(/\D/g, "").includes(phone)
  const isGroup = from.endsWith("@g.us")
  let isAdmin = false, isBotAdmin = false

  if (isGroup && groupCache[from]) {
    const botJid    = (sock.user?.id || "").replace(/:.*@/, "@")
    const senderJid = sender.replace(/:.*@/, "@")
    for (const p of (groupCache[from].participants || [])) {
      const pid = (p.id || "").replace(/:.*@/, "@")
      const adm = p.admin === "admin" || p.admin === "superadmin"
      if (pid === senderJid && adm) isAdmin    = true
      if (pid === botJid    && adm) isBotAdmin = true
    }
  }

  console.log(`[${phone}] ▶ ${rawCmd} | owner:${isOwner} group:${isGroup}`)
  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands:   sharedCmdMap,
      cmdList:    [...sharedCmdMap.keys()].map(k => `.${k}`).sort(),
      settings, lib,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache,
    })
  } catch (e) {
    console.error(`[${phone}] ERR ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ *${rawCmd}* error: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  START USER SESSION  (mirrors index.js startBot exactly)
// ═════════════════════════════════════════════════════════════════════════════
async function startUserSession(phone, { onCode, onConnect, onFail } = {}) {
  const sessionDir = path.join(USERS_DIR, phone)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

  const { version } = await fetchLatestBaileysVersion()

  const entry = {
    phone,
    sock:       null,
    status:     "connecting",
    groupCache: {},
    retries:    0,
    botStart:   Math.floor(Date.now() / 1000),
  }
  sessions.set(phone, entry)

  async function createSocket() {
    // Fresh state from disk every connect — fixes stale creds on reconnect
    let state, saveCreds
    try {
      ;({ state, saveCreds } = await useMultiFileAuthState(sessionDir))
    } catch (e) {
      console.error(`[${phone}] auth load failed: ${e.message}`)
      if (onFail) onFail(e.message)
      return
    }

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, Pino({ level: "silent" })),
      },
      logger:              Pino({ level: "silent" }),
      printQRInTerminal:   false,
      markOnlineOnConnect: false,
      syncFullHistory:     false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs:    60000,
      retryRequestDelayMs: 2000,
      maxMsgRetryCount:    5,
      cachedGroupMetadata: async jid => entry.groupCache[jid],
    })

    entry.sock = sock

    // Await saveCreds so writes actually complete
    sock.ev.on("creds.update", async () => {
      try { await saveCreds() } catch (e) {
        console.error(`[${phone}] saveCreds failed: ${e.message}`)
      }
    })

    // Group cache — same as main index.js
    sock.ev.on("groups.upsert", gs => {
      for (const g of gs) entry.groupCache[g.id] = { ...g, _cachedAt: Date.now() }
    })
    sock.ev.on("groups.update", us => {
      for (const u of us)
        entry.groupCache[u.id] = entry.groupCache[u.id]
          ? Object.assign(entry.groupCache[u.id], u, { _cachedAt: Date.now() })
          : { ...u, _cachedAt: Date.now() }
    })
    sock.ev.on("group-participants.update", async ({ id }) => {
      try {
        entry.groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() }
      } catch {}
    })

    // Lib hooks — same as main index.js
    if (typeof lib.setSocket      === "function") lib.setSocket(sock)
    if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)
    if (typeof lib.initAdminCache === "function") lib.initAdminCache(entry.groupCache)

    // Pairing — only if not already registered
    if (!state.creds.registered) {
      console.log(`[${phone}] requesting pairing code...`)
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phone)
          console.log(`[${phone}] code: ${code}`)
          if (onCode) onCode(code)
        } catch (e) {
          console.error(`[${phone}] pairing code error: ${e.message}`)
          if (onFail) onFail(e.message)
        }
      }, 3000)
    } else {
      console.log(`[${phone}] has saved creds — reconnecting silently`)
    }

    // Messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        if ((Number(m.messageTimestamp) || 0) < entry.botStart - 15) continue
        if (!m.key.fromMe) {
          if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
          if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
        }
        handleUserMsg(entry, m).catch(e =>
          console.error(`[${phone}] MSG ERR: ${e.message}`)
        )
      }
    })

    // Group participant updates (welcome/leave etc)
    sock.ev.on("group-participants.update", async update => {
      if (typeof lib.handleGroupUpdate === "function")
        lib.handleGroupUpdate(sock, update).catch(() => {})
    })

    // Connection lifecycle — full reconnect logic
    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        entry.retries = 0
        entry.status  = "online"
        console.log(`[${phone}] ✅ online`)

        // Warm group cache
        try {
          const all = await sock.groupFetchAllParticipating()
          let n = 0
          for (const [jid, meta] of Object.entries(all)) {
            entry.groupCache[jid] = { ...meta, _cachedAt: Date.now() }; n++
          }
          console.log(`[${phone}] ${n} groups cached`)
        } catch {}

        if (onConnect) onConnect()
      }

      if (connection === "close") {
        entry.status = "offline"
        const code   = lastDisconnect?.error?.output?.statusCode

        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          console.log(`[${phone}] logged out — wiping session`)
          sessions.delete(phone)
          try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
          return
        }

        try { sock.ev.removeAllListeners() } catch {}

        if (entry.retries < MAX_RETRY) {
          const delay = getDelay(entry.retries)
          console.log(`[${phone}] retry ${++entry.retries}/${MAX_RETRY} in ${delay}ms`)
          setTimeout(() => createSocket().catch(() => {}), delay)
        } else {
          console.log(`[${phone}] max retries — giving up`)
          sessions.delete(phone)
        }
      }
    })
  }

  await createSocket()
  return entry
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESTORE ALL SAVED SESSIONS ON STARTUP
// ═════════════════════════════════════════════════════════════════════════════
async function restoreAllSessions() {
  if (!fs.existsSync(USERS_DIR)) return
  const phones = fs.readdirSync(USERS_DIR).filter(name => {
    const dir = path.join(USERS_DIR, name)
    return fs.statSync(dir).isDirectory() &&
           fs.existsSync(path.join(dir, "creds.json"))
  })
  if (!phones.length) {
    console.log("[USERS] No saved user sessions to restore")
    return
  }
  console.log(`[USERS] Restoring ${phones.length} session(s): ${phones.join(", ")}`)
  for (const phone of phones) {
    if (sessions.has(phone)) continue
    try {
      await startUserSession(phone, {
        onConnect: () => console.log(`[USERS] ✅ Restored: ${phone}`),
        onFail:    e  => console.error(`[USERS] ✗ Restore failed ${phone}: ${e}`),
      })
      await sleep(2000)
    } catch (e) {
      console.error(`[USERS] ✗ ${phone}: ${e.message}`)
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════════════════════
module.exports = {
  sessions,
  startUserSession,
  restoreAllSessions,
  encodeUserSession,
  decodeUserSession,
  sleep,
  lib,
}
