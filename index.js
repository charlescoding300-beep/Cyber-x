require("dotenv").config()
const fs   = require("fs")
const path = require("path")
const Pino = require("pino")
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

const isAdminLib  = require("./lib/isAdmin")
const settingsLib = require("./lib/settings")
const sessionBackup = require("./lib/sessionBackup")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BOT_START  = Math.floor(Date.now() / 1000)
const CMD_DIR    = path.join(__dirname, "commands")
const LIB_DIR    = path.join(__dirname, "lib")
const UTILS_DIR  = path.join(__dirname, "utils")
const API_DIR    = path.join(__dirname, "api")
const CONFIG_DIR = path.join(__dirname, "config")
const TEMP_DIR   = path.join(__dirname, "temp")
const SESS_ROOT  = path.join(__dirname, "sessions")
const META_FILE  = path.join(SESS_ROOT, "_meta.json")
const BOT_PREFIX = process.env.BOT_PREFIX || "."

const OWNER_NUMBERS = (process.env.OWNER_NUMBER || "")
  .split(",").map(n => n.replace(/\D/g, "").trim()).filter(Boolean)

const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || "")
  .split(",").map(n => n.replace(/\D/g, "").trim()).filter(Boolean)

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, API_DIR, CONFIG_DIR, TEMP_DIR, SESS_ROOT])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// AUTO LOADER — lib/, utils/, api/, config/ all auto-load and hot-reload.
// Same pattern for every dir: require every .js file, merge its exports
// onto `lib` (or its own bucket), log success/failure per file.
// ─────────────────────────────────────────────────────────────────────────────
const lib    = {}
const api    = {}
const config = {}

function loadDir(dir, bucket, label) {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    try {
      const full = path.join(dir, file)
      delete require.cache[require.resolve(full)]
      const exp  = require(full)
      bucket[path.basename(file, ".js")] = exp
      if (exp && typeof exp === "object") Object.assign(bucket, exp)
      console.log(`[${label}] ✔ ${file}`)
    } catch (e) { console.error(`[${label}] ✗ ${file}: ${e.message}`) }
  }
}

function loadAllSupportDirs() {
  loadDir(LIB_DIR,    lib,    "LIB")
  loadDir(UTILS_DIR,  lib,    "UTILS")     // utils merge into the same `lib` bucket commands already expect
  loadDir(API_DIR,    api,    "API")
  loadDir(CONFIG_DIR, config, "CONFIG")
}
loadAllSupportDirs()

// Hot-reload lib/utils/api/config on file change — same debounce pattern as commands/
let supportWatchStarted = false
function watchSupportDirs() {
  if (supportWatchStarted) return
  supportWatchStarted = true
  let debounce = null
  for (const [dir, label] of [[LIB_DIR, "LIB"], [UTILS_DIR, "UTILS"], [API_DIR, "API"], [CONFIG_DIR, "CONFIG"]]) {
    if (!fs.existsSync(dir)) continue
    fs.watch(dir, { persistent: false }, (_, f) => {
      if (!f?.endsWith(".js")) return
      clearTimeout(debounce)
      debounce = setTimeout(() => {
        loadAllSupportDirs()
        console.log(`[${label}] ↺ reloaded (${f} changed)`)
      }, 150)
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMP FILE CLEANUP — prevents ENOSPC / disk overflow on hosted panels
// (same pattern used by Knight Bot). Wipes anything older than maxAgeMs
// from temp/ on an interval, and once on boot to clear crash leftovers.
// ─────────────────────────────────────────────────────────────────────────────
function cleanupTempDir(maxAgeMs = 30 * 60 * 1000) {
  if (!fs.existsSync(TEMP_DIR)) return
  const now = Date.now()
  let cleaned = 0
  for (const file of fs.readdirSync(TEMP_DIR)) {
    const full = path.join(TEMP_DIR, file)
    try {
      const stat = fs.statSync(full)
      if (now - stat.mtimeMs > maxAgeMs) {
        if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true })
        else fs.unlinkSync(full)
        cleaned++
      }
    } catch {}
  }
  if (cleaned > 0) console.log(`[CLEANUP] 🧹 Removed ${cleaned} stale temp item(s)`)
}
cleanupTempDir()                              // once on boot — clear crash leftovers
setInterval(cleanupTempDir, 15 * 60 * 1000)    // then every 15 min

// ── Memory guard — same idea as Knight Bot's RAM watchdog ─────────────────────
setInterval(() => {
  if (global.gc) global.gc()
}, 60_000)

setInterval(() => {
  const usedMB = process.memoryUsage().rss / 1024 / 1024
  if (usedMB > (parseInt(process.env.MAX_RAM_MB || "450", 10))) {
    console.log(`[MEMORY] ⚠ RAM too high (${usedMB.toFixed(0)}MB) — exiting for clean restart`)
    process.exit(1)   // Render's restart policy brings it back; sessions restore via sessionBackup
  }
}, 30_000)

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
const registry = { map: new Map(), list: [], details: [], aliases: new Map() }
const isValidCmd = m => m && typeof m.pattern === "string" && typeof m.run === "function"
const toKey      = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (!isValidCmd(mod)) return false
    const key = toKey(mod.pattern)
    registry.map.set(key, mod)
    if (Array.isArray(mod.alias))
      for (const a of mod.alias) registry.aliases.set(toKey(a), key)
    return true
  } catch (e) { console.error(`[CMD] ✗ ${file}: ${e.message}`); return false }
}
function rebuildLists() {
  const mods = [...registry.map.values()]
  registry.list    = mods.map(c => c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`).sort()
  registry.details = mods.map(c => ({
    pattern:  c.pattern.startsWith(".") ? c.pattern : `.${c.pattern}`,
    desc:     c.desc || "", usage: c.usage || "",
    category: c.category || "general", alias: c.alias || [],
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}
async function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  registry.map.clear(); registry.aliases.clear()
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()
  let ok = 0, fail = 0
  for (const f of files) { if (loadFile(f)) ok++; else fail++ }
  rebuildLists()
  console.log(`[CMD] ⚡ ${ok} loaded | ${fail} skipped`)
}
let watchStarted = false
function watchCommands() {
  if (watchStarted || !fs.existsSync(CMD_DIR)) return
  watchStarted = true
  let debounce = null
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(debounce)
    debounce = setTimeout(() => { loadFile(f); rebuildLists(); console.log(`[CMD] ↺ ${f}`) }, 100)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// JID NORMALIZER
// ─────────────────────────────────────────────────────────────────────────────
function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// 10-LAYER OWNER / ADMIN RECOGNITION
// ─────────────────────────────────────────────────────────────────────────────
function checkIsOwner(state, sender, senderAlt, fromMe) {
  if (fromMe === true) return true
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)

  const sessionPhone = normalizeNum(state.phone)
  if (sessionPhone && candidates.some(n => n === sessionPhone)) return true

  if (OWNER_NUMBERS.length && candidates.some(n => OWNER_NUMBERS.includes(n))) return true

  if ([sender, senderAlt].filter(Boolean).some(j => {
    try { return isAdminLib.isOwner(j) } catch { return false }
  })) return true

  try {
    const dynamicOwners = settingsLib.get?.("owners") || []
    if (Array.isArray(dynamicOwners) && candidates.some(n => dynamicOwners.map(normalizeNum).includes(n)))
      return true
  } catch {}

  return false
}

async function checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner) {
  if (isOwner) return { isAdmin: true, isBotAdmin: true }
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)

  let meta = state.groupCache[from]
  if (!meta || (Date.now() - (meta._cachedAt || 0)) > 5 * 60 * 1000) {
    try { meta = await sock.groupMetadata(from); state.groupCache[from] = { ...meta, _cachedAt: Date.now() } } catch {}
  }

  let isBotAdmin = false
  try { isBotAdmin = isAdminLib.isBotAdmin(state.groupCache, from, sock) } catch {}

  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n)))
    return { isAdmin: true, isBotAdmin }

  let isAdmin = false
  try { isAdmin = isAdminLib.isAdmin(state.groupCache, from, sender, sock, null, senderAlt) } catch {}

  if (!isAdmin && meta?.participants) {
    const adminSet = new Set(
      meta.participants.filter(p => p.admin === "admin" || p.admin === "superadmin").map(p => normalizeNum(p.id))
    )
    isAdmin = candidates.some(n => adminSet.has(n))
  }

  return { isAdmin, isBotAdmin }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function extractBody(msg) {
  const m = msg?.message
  if (!m) return ""
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m
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

const helper = {
  async reply(sock, msg, text)  { return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg }) },
  async send(sock, jid, text)   { return sock.sendMessage(jid, { text }) },
  async react(sock, msg, emoji) { return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }) },
  async sendImage(sock, jid, url, caption = "")  { return sock.sendMessage(jid, { image: { url }, caption }) },
  async sendVideo(sock, jid, url, caption = "")  { return sock.sendMessage(jid, { video: { url }, caption }) },
  async sendGif(sock, jid, url, caption = "")    { return sock.sendMessage(jid, { video: { url }, gifPlayback: true, caption }) },
  async sendAudio(sock, jid, buf, ptt = false)   { return sock.sendMessage(jid, { audio: buf, ptt, mimetype: "audio/mpeg" }) },
  async sendDoc(sock, jid, buf, filename, mimetype = "application/octet-stream") {
    return sock.sendMessage(jid, { document: buf, fileName: filename, mimetype })
  },
  box(title, lines = []) {
    const body = lines.map(l => `║  ${l}`).join("\n")
    return `╔══════════════════════════╗\n║  ${title}\n╠══════════════════════════╣\n${body}\n╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
  },
  msToTime(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s` },
  sleep(ms)    { return new Promise(r => setTimeout(r, ms)) },
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────
const sessions = new Map()

function makeSessionState(phone) {
  const sessDir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })
  return {
    phone, sessDir,
    settings:      settingsLib.forUser(phone),
    groupCache:    {},
    retries:       0,
    sock:          null,
    connected:     false,
    pairingCode:   null,
    presenceTimer: null,
  }
}

function saveMeta() {
  try {
    const meta = [...sessions.keys()]
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2))
  } catch (e) { console.error("[META] save error:", e.message) }
}

function loadMetaPhones() {
  try {
    if (fs.existsSync(META_FILE)) return JSON.parse(fs.readFileSync(META_FILE, "utf8"))
  } catch {}
  return []
}

// ─── Ordinary (non-command) message side effects ─────────────────────────
async function handleOrdinaryMessage(state, sock, msg, from) {
  const s = state.settings
  if (s.get("autoTyping")) {
    try { await sock.sendPresenceUpdate("composing", from); await helper.sleep(5000); await sock.sendPresenceUpdate("paused", from) } catch {}
  }
  if (s.get("autoRecording")) {
    try { await sock.sendPresenceUpdate("recording", from); await helper.sleep(5000); await sock.sendPresenceUpdate("paused", from) } catch {}
  }
  if (s.get("autoReply")) {
    const prefix = s.get("prefix") || BOT_PREFIX
    const text = (s.get("autoReplyText") || "").replace(/\{prefix\}/g, prefix)
    if (text) { try { await sock.sendMessage(from, { text }, { quoted: msg }) } catch {} }
  }
}

async function handleStatus(state, sock, msg) {
  if (msg.key.fromMe) return
  const s = state.settings
  if (s.get("autoViewStatus")) { try { await sock.readMessages([msg.key]) } catch {} }
  if (s.get("autoReactStatus")) {
    const emoji = s.get("statusReactEmoji") || "🔥"
    try {
      await sock.sendMessage("status@broadcast", { react: { text: emoji, key: msg.key } }, {
        statusJidList: [msg.key.participant, sock.user?.id].filter(Boolean)
      })
    } catch (e) { console.error(`[${state.phone}] STATUS REACT ERR:`, e.message) }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true

  if (!fromMe && state.settings.get("autoRead")) {
    sock.readMessages([msg.key]).catch(() => {})
  }

  const prefix = state.settings.get("prefix") || BOT_PREFIX

  if (!body.startsWith(prefix)) {
    if (!fromMe) handleOrdinaryMessage(state, sock, msg, from).catch(() => {})
    return
  }

  const isOwner = checkIsOwner(state, sender, senderAlt, fromMe)
  const mode = state.settings.get("mode") || "public"
  if (mode === "private" && !isOwner && !fromMe) return

  const isGroup = from.endsWith("@g.us")
  if (state.settings.get("groupOnly") && !isGroup && !isOwner) return
  if (state.settings.get("dmOnly") && isGroup && !isOwner) return

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = registry.aliases.get(rawCmd) || rawCmd
  const command   = registry.map.get(canonical)
  if (!command) return

  let isAdmin = false, isBotAdmin = false
  if (isGroup) { ({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner)) }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} botAdmin:${isBotAdmin}`)

  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands: registry.map, cmdList: registry.list, cmdDetails: registry.details,
      settings: state.settings, lib, api, config, helper,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache: state.groupCache,
      checkIsOwner: (s, a) => checkIsOwner(state, s, a, false),
      checkGroupAdmin: (f, s, a) => checkGroupAdmin(state, sock, f, s, a, isOwner),
    })
  } catch (e) {
    console.error(`[${state.phone}] RUN ERR ${rawCmd}: ${e.message}`)
    try { await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e.message}` }, { quoted: msg }) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT START — creates/restores a single session by phone number
// ─────────────────────────────────────────────────────────────────────────────
async function startBot(phone) {
  let state = sessions.get(phone)
  if (!state) { state = makeSessionState(phone); sessions.set(phone, state) }

  const { state: authState, saveCreds } = await useMultiFileAuthState(state.sessDir)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: authState.creds,
      keys:  makeCacheableSignalKeyStore(authState.keys, Pino({ level: "silent" })),
    },
    logger:              Pino({ level: "silent" }),
    printQRInTerminal:   false,
    markOnlineOnConnect: false,
    syncFullHistory:     false,
    keepAliveIntervalMs: 25000,
    connectTimeoutMs:    60000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount:    5,
    shouldSyncHistoryMessage: m => m.syncType === 0,
    cachedGroupMetadata:  async jid => state.groupCache[jid],
  })

  state.sock = sock
  require("./lib/greetListener").register(sock)

  if (state.presenceTimer) clearInterval(state.presenceTimer)
  state.presenceTimer = setInterval(() => {
    if (state.connected && state.settings.get("alwaysOnline")) {
      sock.sendPresenceUpdate("available").catch(() => {})
    }
  }, 8000)

  sock.ev.on("creds.update", async () => {
    await saveCreds()
    sessionBackup.schedulePush()   // every creds change → backup gets scheduled (debounced)
  })

  sock.ev.on("groups.upsert", gs => {
    for (const g of gs) state.groupCache[g.id] = { ...g, _cachedAt: Date.now() }
  })
  sock.ev.on("groups.update", us => {
    for (const u of us) state.groupCache[u.id] = { ...(state.groupCache[u.id] || {}), ...u, _cachedAt: Date.now() }
  })

  // ── FIX #1: this listener now ALSO calls lib.handleGroupUpdate ──────────────
  // Previously it only refreshed the group metadata cache — it never
  // actually invoked the welcome/goodbye handler, so joins/leaves were
  // silently doing nothing beyond the cache update.
  sock.ev.on("group-participants.update", async (update) => {
    try {
      state.groupCache[update.id] = { ...(await sock.groupMetadata(update.id)), _cachedAt: Date.now() }
    } catch {}

    if (typeof lib.handleGroupUpdate === "function") {
      lib.handleGroupUpdate(sock, update).catch(e =>
        console.error(`[${phone}] handleGroupUpdate ERR:`, e.message)
      )
    }
  })

  if (!authState.creds.registered) {
    const number = phone.replace(/\D/g, "")
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(number)
        console.log(`[${phone}] 📱 PAIRING CODE: ${code}`)
        state.pairingCode = code
      } catch (e) { console.error(`[${phone}] PAIR ERR:`, e.message) }
    }, 3000)
  }

  if (typeof lib.setSocket      === "function") lib.setSocket(sock)
  if (typeof lib.initGroupCache === "function") lib.initGroupCache(sock)

  // ── FIX #2: setStore now correctly targets lib/groupParticipants.js ─────────
  // Previously this called require("./lib/welcome").setStore(...) — but
  // welcome/goodbye logic lives in lib/groupParticipants.js now, so that
  // call was either hitting a stale file or a function that didn't exist
  // there. Using the already-loaded `lib` bucket avoids a second require()
  // entirely and points at the file that's actually wired up above.
  try { lib.groupParticipants?.setStore?.({ groupMetadata: state.groupCache }) } catch {}

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) {
      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue

      if (m.key.remoteJid === "status@broadcast") {
        handleStatus(state, sock, m).catch(e => console.error(`[${phone}] STATUS ERR:`, e.message))
        continue
      }

      if (!m.key.fromMe) {
        if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleBadword  === "function") lib.handleBadword(sock, m, extractBody).catch(() => {})
      }
      handleMessage(state, sock, m).catch(e => console.error(`[${phone}] MSG ERR:`, e.message))
    }
  })

  // ── Connection lifecycle ─────────────────────────────────────────────────
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      state.connected   = true
      state.retries     = 0
      state.pairingCode = null
      console.log(`[${phone}] ⚡ Connected — ${sock.user?.id || "unknown"}`)
      saveMeta()
      sessionBackup.schedulePush()
    }

    if (connection === "close") {
      state.connected = false
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut  = statusCode === DisconnectReason.loggedOut

      if (loggedOut) {
        console.log(`[${phone}] ✗ Logged out — removing session`)
        await removeSession(phone)
        return
      }

      state.retries++
      const delay = Math.min(1000 * Math.pow(2, state.retries), 30000)
      console.log(`[${phone}] ↻ Reconnecting in ${delay}ms (code ${statusCode})`)
      setTimeout(() => startBot(phone).catch(e => console.error(`[${phone}] RESTART ERR:`, e.message)), delay)
    }
  })

  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — used by server.js
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  await loadCommands()
  watchCommands()
  watchSupportDirs()

  console.log("[INIT] 🔄 Restoring sessions from backup...")
  const restoredCount = await sessionBackup.restoreAll().catch(e => {
    console.error("[INIT] ✗ Backup restore failed:", e.message)
    return 0
  })
  if (restoredCount > 0) console.log(`[INIT] ✔ Restored ${restoredCount} session(s) from backup`)

  const onDisk = fs.existsSync(SESS_ROOT)
    ? fs.readdirSync(SESS_ROOT).filter(f => {
        const full = path.join(SESS_ROOT, f)
        return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, "creds.json"))
      })
    : []

  const fromMeta = loadMetaPhones()
  const allPhones = [...new Set([...onDisk, ...fromMeta])]

  console.log(`[INIT] ▶ Starting ${allPhones.length} session(s): ${allPhones.join(", ") || "(none)"}`)

  for (const phone of allPhones) {
    try { await startBot(phone) }
    catch (e) { console.error(`[INIT] ✗ Failed to start ${phone}:`, e.message) }
  }

  saveMeta()
}

async function addSession(phone) {
  const clean = phone.replace(/\D/g, "")
  if (!clean) throw new Error("Invalid phone number")

  await startBot(clean)
  saveMeta()

  const state = sessions.get(clean)
  for (let i = 0; i < 15 && !state.pairingCode && !state.connected; i++) {
    await new Promise(r => setTimeout(r, 1000))
  }

  return {
    phone: clean,
    pairingCode: state.pairingCode,
    connected: state.connected,
  }
}

async function removeSession(phone) {
  const clean = phone.replace(/\D/g, "")
  const state = sessions.get(clean)

  if (state) {
    if (state.presenceTimer) clearInterval(state.presenceTimer)
    try { state.sock?.end(undefined) } catch {}
    sessions.delete(clean)
  }

  try {
    const sessDir = path.join(SESS_ROOT, clean)
    fs.rmSync(sessDir, { recursive: true, force: true })
  } catch (e) { console.error(`[REMOVE] ✗ ${clean}:`, e.message) }

  saveMeta()
  sessionBackup.schedulePush()
}

function listBots() {
  return [...sessions.entries()].map(([phone, state]) => ({
    phone,
    connected:   state.connected,
    pairingCode: state.pairingCode,
    groups:      Object.keys(state.groupCache || {}).length,
  }))
}

module.exports = { init, addSession, removeSession, listBots }
