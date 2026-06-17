require("dotenv").config()
const fs    = require("fs")
const path  = require("path")
const http  = require("http")
const https = require("https")
const Pino  = require("pino")
const crypto = require("crypto")
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

const BOT_START   = Math.floor(Date.now() / 1000)
const PORT        = process.env.PORT || 3000
const SELF_URL    = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
const MAX_RETRIES = 20
const CMD_DIR     = path.join(__dirname, "commands")
const LIB_DIR     = path.join(__dirname, "lib")
const UTILS_DIR   = path.join(__dirname, "utils")

const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, "session")

delete process.env.PREFIX
const BOT_PREFIX = process.env.BOT_PREFIX || "."

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, SESSION_DIR])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─── SESSION PASSWORD SYSTEM ────────────────────────────────────────────────
// On every restart, a new random password is generated.
// The owner must DM the bot: .owner <password>
// Until verified, owner commands won't work.
let SESSION_PASSWORD   = crypto.randomBytes(4).toString("hex").toUpperCase()  // e.g. A3F9C2B1
let ownerVerified      = false   // flips to true once owner types correct password
let ownerVerifiedJid   = null    // stores the verified owner JID for this session

function resetSessionPassword() {
  SESSION_PASSWORD = crypto.randomBytes(4).toString("hex").toUpperCase()
  ownerVerified    = false
  ownerVerifiedJid = null
  console.log(`[OWNER] 🔑 New session password: ${SESSION_PASSWORD}`)
}

// ────────────────────────────────────────────────────────────────────────────

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
      console.log(`[${label}] ✔ ${file}`)
    } catch (e) { console.error(`[${label}] ✗ ${file}: ${e.message}`) }
  }
}
loadDir(LIB_DIR,   "LIB")
loadDir(UTILS_DIR, "UTILS")

const settings = lib.settings || {
  botName: process.env.BOT_NAME || "CYBER X",
  prefix:  BOT_PREFIX,
  owner:   process.env.OWNER_NUMBER || "",
  mode:    "public",
  get(k)    { return this[k] },
  set(k, v) { this[k] = v },
}

if (!lib.settings) {
  settings.prefix = BOT_PREFIX
}
if (settings.store && !lib.settings) settings.store.prefix = BOT_PREFIX

if (!settings.owner && !settings.owners?.length)
  console.warn("[WARN] OWNER_NUMBER not set")

const groupCache = {}

const registry = {
  map:     new Map(),
  list:    [],
  details: [],
  aliases: new Map(),
}

const isValidCmd = m =>
  m && typeof m.pattern === "string" && typeof m.run === "function"

const toKey = p =>
  p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (!isValidCmd(mod)) {
      console.log(`[CMD] ⚠ skipped: ${file}`)
      return false
    }
    const key = toKey(mod.pattern)
    registry.map.set(key, mod)
    if (Array.isArray(mod.alias))
      for (const a of mod.alias) registry.aliases.set(toKey(a), key)
    return true
  } catch (e) {
    console.error(`[CMD] ✗ ${file}: ${e.message}`)
    return false
  }
}

function rebuildLists() {
  const mods = [...registry.map.values()]
  registry.list = mods
    .map(c => c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`)
    .sort()
  registry.details = mods.map(c => ({
    pattern:  c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`,
    desc:     c.desc     || "",
    usage:    c.usage    || "",
    category: c.category || "general",
    alias:    c.alias    || [],
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

async function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  registry.map.clear()
  registry.aliases.clear()
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()
  const t = Date.now()
  let ok = 0, fail = 0
  for (const f of files) { if (loadFile(f)) ok++; else fail++ }
  rebuildLists()
  console.log(`[CMD] ⚡ ${ok} loaded | ${fail} skipped | ${Date.now() - t}ms`)
  console.log(`[CMD] Keys: ${[...registry.map.keys()].join(", ")}`)
}

let watchStarted = false
function watchCommands() {
  if (watchStarted || !fs.existsSync(CMD_DIR)) return
  watchStarted = true
  let debounce = null
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      const ok = loadFile(f)
      rebuildLists()
      console.log(`[CMD] ↺ reloaded: ${f} ${ok ? "✔" : "✗"}`)
    }, 100)
  })
  console.log("[CMD] 👁 watching commands/")
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

function checkIsOwner(sender) {
  const clean = (sender || "").split("@")[0].split(":")[0].replace(/\D/g, "")
  if (!clean) return false

  // If owner already verified this session, trust the verified JID
  if (ownerVerified && ownerVerifiedJid) {
    const verifiedClean = ownerVerifiedJid.split("@")[0].split(":")[0].replace(/\D/g, "")
    if (clean === verifiedClean) return true
  }

  if (typeof settings.isOwner === "function") return settings.isOwner(sender)
  const owners = settings.owners || []
  if (owners.includes(clean)) return true
  const base = (settings.owner || "").replace(/\D/g, "")
  return !!base && clean === base
}

const helper = {
  async reply(sock, msg, text) {
    return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
  },
  async send(sock, jid, text) {
    return sock.sendMessage(jid, { text })
  },
  async react(sock, msg, emoji) {
    return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } })
  },
  async sendImage(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { image: { url }, caption })
  },
  async sendVideo(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { video: { url }, caption })
  },
  async sendGif(sock, jid, url, caption = "") {
    return sock.sendMessage(jid, { video: { url }, gifPlayback: true, caption })
  },
  async sendAudio(sock, jid, buffer, ptt = false) {
    return sock.sendMessage(jid, { audio: buffer, ptt, mimetype: "audio/mpeg" })
  },
  async sendDoc(sock, jid, buffer, filename, mimetype = "application/octet-stream") {
    return sock.sendMessage(jid, { document: buffer, fileName: filename, mimetype })
  },
  box(title, lines = []) {
    const body = lines.map(l => `║  ${l}`).join("\n")
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n${body}\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
  },
  msToTime(ms) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`
  },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)) },
}

// ─── OWNER PASSWORD HANDLER ──────────────────────────────────────────────────
// Intercepts .owner <password> BEFORE normal command routing
// Works in DM only for security
async function handleOwnerAuth(sock, msg, body) {
  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const isDM   = !from.endsWith("@g.us")
  if (!isDM) return false  // only allow in DM

  const prefix  = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
  if (!body.startsWith(prefix)) return false

  const slice  = body.slice(prefix.length).trimStart()
  const parts  = slice.split(/\s+/)
  const cmd    = parts[0]?.toLowerCase()
  const passwd = parts[1]?.trim()

  if (cmd !== "owner") return false

  // Already verified
  if (ownerVerified) {
    await sock.sendMessage(from, {
      text: `✅ *Already verified as owner for this session.*`
    }, { quoted: msg })
    return true
  }

  if (!passwd) {
    await sock.sendMessage(from, {
      text: `🔐 *Owner Verification*\n\nSend: \`${prefix}owner <password>\`\n\nCheck your Render logs for the session password.`
    }, { quoted: msg })
    return true
  }

  if (passwd.toUpperCase() === SESSION_PASSWORD) {
    ownerVerified    = true
    ownerVerifiedJid = sender
    console.log(`[OWNER] ✅ Verified: ${sender}`)
    await sock.sendMessage(from, {
      text: `╔══════════════════════════╗\n║  ✅ OWNER VERIFIED       ║\n╠══════════════════════════╣\n║  Welcome back, Boss! 👑  ║\n║  All owner commands are  ║\n║  now unlocked.           ║\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    }, { quoted: msg })
    return true
  } else {
    console.warn(`[OWNER] ✗ Wrong password attempt from ${sender}: "${passwd}"`)
    await sock.sendMessage(from, {
      text: `❌ *Wrong password.* Try again or check your Render logs.`
    }, { quoted: msg })
    return true
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function handleMessage(sock, msg, fromMe) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  // Intercept .owner auth first (before anything else)
  const wasOwnerCmd = await handleOwnerAuth(sock, msg, body)
  if (wasOwnerCmd) return

  const prefix = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
  if (!body.startsWith(prefix)) return

  const from    = msg.key.remoteJid
  const sender  = msg.key.participant || from
  const isOwner = checkIsOwner(sender)
  const mode    = (typeof settings.get === "function"
    ? settings.get("mode") : settings.mode) || "public"

  if (mode === "private" && !isOwner && !fromMe) return

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = registry.aliases.get(rawCmd) || rawCmd
  const command   = registry.map.get(canonical)
  if (!command) { console.log(`[CMD] ? unknown: ${rawCmd}`); return }

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

  console.log(`[CMD] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} fromMe:${fromMe}`)
  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands:   registry.map,
      cmdList:    registry.list,
      cmdDetails: registry.details,
      settings, lib, helper,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache,
      // expose session auth state to commands if needed
      ownerVerified: () => ownerVerified,
      sessionPassword: () => SESSION_PASSWORD,
    })
  } catch (e) {
    console.error(`[RUN ERR] ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ *${rawCmd}* error: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}

let pingCount = 0, lastPing = null
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0]
  if (url === "/ping" || url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" })
    return res.end(JSON.stringify({
      status:        "online",
      bot:           settings.botName,
      uptime:        Math.floor(process.uptime()),
      memory:        Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      commands:      registry.map.size,
      groups:        Object.keys(groupCache).length,
      pings:         pingCount,
      ownerVerified: ownerVerified,
    }))
  }
  res.writeHead(200, { "Content-Type": "text/plain" })
  res.end("⚡ CYBER X ONLINE")
})
server.keepAliveTimeout = 120000
server.headersTimeout   = 125000
server.listen(PORT, "0.0.0.0", () => console.log(`[WEB] ⚡ Port ${PORT}`))

function ping() {
  const url  = `${SELF_URL}/ping`
  const lib2 = url.startsWith("https") ? https : http
  const req  = lib2.get(url, () => {
    pingCount++
    lastPing = new Date().toISOString()
    console.log(`[PING] ✔ #${pingCount}`)
  })
  req.on("error", () => {})
  req.setTimeout(10000, () => { req.destroy() })
}
setTimeout(() => { ping(); setInterval(ping, 4 * 60 * 1000) }, 15000)

setInterval(() => {
  const now = Date.now()
  let cleaned = 0
  for (const jid of Object.keys(groupCache)) {
    if (groupCache[jid]._cachedAt && now - groupCache[jid]._cachedAt > 30 * 60 * 1000) {
      delete groupCache[jid]; cleaned++
    }
  }
  if (global.gc) { global.gc(); console.log("[CLEAN] ♻️ GC ran") }
  const mem = process.memoryUsage()
  console.log(`[CLEAN] Heap:${Math.round(mem.heapUsed/1024/1024)}MB RSS:${Math.round(mem.rss/1024/1024)}MB cleaned:${cleaned}`)
}, 15 * 60 * 1000)

let retries = 0
function getDelay(n) { return Math.min(1000 * Math.pow(2, n), 30000) }

async function startBot() {
  try {
    // Generate fresh session password on every (re)start
    resetSessionPassword()

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
    const { version }          = await fetchLatestBaileysVersion()
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
      cachedGroupMetadata: async (jid) => groupCache[jid],
    })

    sock.ev.on("groups.upsert", gs => {
      for (const g of gs) groupCache[g.id] = { ...g, _cachedAt: Date.now() }
    })
    sock.ev.on("groups.update", us => {
      for (const u of us) {
        groupCache[u.id] = groupCache[u.id]
          ? Object.assign(groupCache[u.id], u, { _cachedAt: Date.now() })
          : { ...u, _cachedAt: Date.now() }
      }
    })
    sock.ev.on("group-participants.update", async ({ id }) => {
      try { groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() } } catch {}
    })

    if (!state.creds.registered) {
      const raw    = process.env.PAIRING_NUMBER || process.env.PHONE_NUMBER || settings.owner
      const number = (raw || "").replace(/\D/g, "")
      if (!number || number.length < 7) {
        console.error("[PAIR] ✗ Set PAIRING_NUMBER in .env"); process.exit(1)
      }
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(number)
          console.log(`\n╔══════════════════════════════╗`)
          console.log(`║  PAIRING CODE: ${code}      ║`)
          console.log(`╚══════════════════════════════╝\n`)
        } catch (e) { console.error("[PAIR] ✗", e.message) }
      }, 3000)
    }

    await loadCommands()
    watchCommands()

    if (typeof lib.setSocket      === "function") lib.setSocket(sock)
    if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)
    if (typeof lib.initAdminCache === "function") lib.initAdminCache(groupCache)
    try { require("./lib/welcome").setStore({ groupMetadata: groupCache }) } catch {}

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        const fromMe = m.key.fromMe === true
        const ts     = Number(m.messageTimestamp) || 0
        if (ts < BOT_START - 15) continue
        if (!fromMe) {
          if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
          if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
        }
        handleMessage(sock, m, fromMe).catch(e => console.error("[MSG ERR]", e.message))
      }
    })

    sock.ev.on("group-participants.update", async update => {
      if (typeof lib.handleGroupUpdate === "function")
        lib.handleGroupUpdate(sock, update).catch(() => {})
    })

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        retries = 0
        const currentPrefix = (settings.get ? settings.get("prefix") : null) || BOT_PREFIX
        console.log(`\n╔══════════════════════════════╗`)
        console.log(`║  ⚡ ${settings.botName} ONLINE         ║`)
        console.log(`║  Prefix: "${currentPrefix}"                ║`)
        console.log(`╚══════════════════════════════╝\n`)

        // ── Send password to owner via WhatsApp DM ──────────────────────────
        const ownerRaw = process.env.PAIRING_NUMBER || process.env.PHONE_NUMBER || settings.owner
        const ownerNum = (ownerRaw || "").replace(/\D/g, "")
        if (ownerNum && ownerNum.length >= 7) {
          const ownerJid = `${ownerNum}@s.whatsapp.net`
          setTimeout(async () => {
            try {
              await sock.sendMessage(ownerJid, {
                text:
                  `╔══════════════════════════╗\n` +
                  `║  🔐 CYBER X RESTARTED    ║\n` +
                  `╠══════════════════════════╣\n` +
                  `║  Session Password:       ║\n` +
                  `║                          ║\n` +
                  `║  *${SESSION_PASSWORD}*              ║\n` +
                  `║                          ║\n` +
                  `║  Type to verify:         ║\n` +
                  `║  ${currentPrefix}owner ${SESSION_PASSWORD}    ║\n` +
                  `╚══════════════════════════╝\n\n` +
                  `_This password expires on next restart._\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
              })
              console.log(`[OWNER] 📨 Password sent to ${ownerJid}`)
            } catch (e) {
              console.error("[OWNER] ✗ Could not send password DM:", e.message)
              console.log(`[OWNER] 🔑 Manual password: ${SESSION_PASSWORD}`)
            }
          }, 4000)
        } else {
          console.log(`[OWNER] 🔑 Session password (no owner number set): ${SESSION_PASSWORD}`)
        }
        // ────────────────────────────────────────────────────────────────────

        try {
          const all = await sock.groupFetchAllParticipating()
          let n = 0
          for (const [jid, meta] of Object.entries(all)) {
            groupCache[jid] = { ...meta, _cachedAt: Date.now() }; n++
          }
          console.log(`[CACHE] ✔ ${n} groups warmed`)
        } catch {}
      }
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          console.log("[BOT] Logged out — delete session/ and re-pair")
          return process.exit(0)
        }
        try { sock.ev.removeAllListeners() } catch {}
        if (retries < MAX_RETRIES) {
          const delay = getDelay(retries)
          console.log(`[BOT] ↺ Retry ${++retries}/${MAX_RETRIES} in ${delay}ms`)
          setTimeout(startBot, delay)
        } else { console.log("[BOT] Max retries"); process.exit(1) }
      }
    })

    sock.ev.on("creds.update", saveCreds)

  } catch (e) {
    console.error("[BOOT ERR]", e.message)
    setTimeout(startBot, getDelay(retries++))
  }
}

startBot()
