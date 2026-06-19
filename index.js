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

// ── Permission-critical modules loaded explicitly to avoid dynamic-loader
// name collisions (both lib/isAdmin.js and lib/settings.js export isOwner).
const isAdminLib  = require("./lib/isAdmin")
const settingsLib = require("./lib/settings")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BOT_START  = Math.floor(Date.now() / 1000)
const CMD_DIR    = path.join(__dirname, "commands")
const LIB_DIR    = path.join(__dirname, "lib")
const UTILS_DIR  = path.join(__dirname, "utils")
const SESS_ROOT  = path.join(__dirname, "sessions")
const META_FILE  = path.join(SESS_ROOT, "_meta.json")
const BOT_PREFIX = process.env.BOT_PREFIX || "."

// ── Parse OWNER_NUMBER env — comma-separated, digits-only ───────────────────
const OWNER_NUMBERS = (process.env.OWNER_NUMBER || "")
  .split(",")
  .map(n => n.replace(/\D/g, "").trim())
  .filter(Boolean)

// ── Parse SUDO_NUMBERS env — trusted admins below owner level ───────────────
const SUDO_NUMBERS = (process.env.SUDO_NUMBERS || "")
  .split(",")
  .map(n => n.replace(/\D/g, "").trim())
  .filter(Boolean)

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, SESS_ROOT])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// LIB + UTILS LOADER
// ─────────────────────────────────────────────────────────────────────────────
const lib = {}
function loadDir(dir, label) {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    try {
      const exp = require(path.join(dir, file))
      lib[path.basename(file, ".js")] = exp
      if (exp && typeof exp === "object") Object.assign(lib, exp)
      console.log(`[${label}] ✔ ${file}`)
    } catch (e) { console.error(`[${label}] ✗ ${file}: ${e.message}`) }
  }
}
loadDir(LIB_DIR,   "LIB")
loadDir(UTILS_DIR, "UTILS")

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
// JID NORMALIZER — strips @domain, :device suffix, non-digits
// ─────────────────────────────────────────────────────────────────────────────
function normalizeNum(raw = "") {
  return raw
    .replace(/@.+$/, "")
    .replace(/:\d+$/, "")
    .replace(/\D/g, "")
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
//  ████████╗███████╗███╗   ██╗    ██╗      █████╗ ██╗   ██╗███████╗██████╗
//     ██╔══╝██╔════╝████╗  ██║    ██║     ██╔══██╗╚██╗ ██╔╝██╔════╝██╔══██╗
//     ██║   █████╗  ██╔██╗ ██║    ██║     ███████║ ╚████╔╝ █████╗  ██████╔╝
//     ██║   ██╔══╝  ██║╚██╗██║    ██║     ██╔══██║  ╚██╔╝  ██╔══╝  ██╔══██╗
//     ██║   ███████╗██║ ╚████║    ███████╗██║  ██║   ██║   ███████╗██║  ██║
//     ╚═╝   ╚══════╝╚═╝  ╚═══╝    ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
//
// 10-LAYER OWNER RECOGNITION SYSTEM
// Layers 1-5 = Owner  |  Layers 6-10 = Group Admin
// ─────────────────────────────────────────────────────────────────────────────

function checkIsOwner(state, sender, senderAlt, fromMe) {
  // Layer 1 — fromMe: message is from the bot's own linked device
  if (fromMe === true) return true

  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)

  // Layer 2 — session phone (the number that paired this session)
  const sessionPhone = normalizeNum(state.phone)
  if (sessionPhone && candidates.some(n => n === sessionPhone)) return true

  // Layer 3 — OWNER_NUMBER env var list
  if (OWNER_NUMBERS.length && candidates.some(n => OWNER_NUMBERS.includes(n))) return true

  // Layer 4 — lib/isAdmin.js owners array
  if ([sender, senderAlt].filter(Boolean).some(j => {
    try { return isAdminLib.isOwner(j) } catch { return false }
  })) return true

  // Layer 5 — lib/settings.js dynamic runtime owners
  try {
    const dynamicOwners = settingsLib.get?.("owners") || []
    if (Array.isArray(dynamicOwners) && candidates.some(n => dynamicOwners.map(normalizeNum).includes(n)))
      return true
  } catch {}

  return false
}

async function checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner) {
  // Layer 10 — owners bypass all admin checks
  if (isOwner) return { isAdmin: true, isBotAdmin: true }

  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)

  let meta = state.groupCache[from]

  // Layer 8 — live fetch if cache is cold (older than 5 min or missing)
  if (!meta || (Date.now() - (meta._cachedAt || 0)) > 5 * 60 * 1000) {
    try {
      meta = await sock.groupMetadata(from)
      state.groupCache[from] = { ...meta, _cachedAt: Date.now() }
    } catch {}
  }

  // Layer 6 — is the bot itself an admin? Computed for real, always — sudo
  // status of the sender (layer 9) must never override this.
  let isBotAdmin = false
  try { isBotAdmin = isAdminLib.isBotAdmin(state.groupCache, from, sock) } catch {}

  // Layer 9 — SUDO_NUMBERS: sender always counts as admin everywhere, but
  // isBotAdmin still reflects the bot's REAL status in this group.
  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n)))
    return { isAdmin: true, isBotAdmin }

  // Layer 7 — is the sender an admin? check both JID variants (lid + phone)
  let isAdmin = false
  try {
    isAdmin = isAdminLib.isAdmin(state.groupCache, from, sender, sock, null, senderAlt)
  } catch {}

  // Extra safety: parse participants directly from meta if isAdmin.js failed
  if (!isAdmin && meta?.participants) {
    const adminSet = new Set(
      meta.participants
        .filter(p => p.admin === "admin" || p.admin === "superadmin")
        .map(p => normalizeNum(p.id))
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
    phone,
    sessDir,
    settings:      settingsLib.forUser(phone),
    groupCache:    {},
    retries:       0,
    sock:          null,
    connected:     false,
    pairingCode:   null,
    presenceTimer: null,
  }
}

// ─── Ordinary (non-command) message side effects ─────────────────────────
async function handleOrdinaryMessage(state, sock, msg, from) {
  const s = state.settings

  if (s.get("autoTyping")) {
    try {
      await sock.sendPresenceUpdate("composing", from)
      await helper.sleep(5000)
      await sock.sendPresenceUpdate("paused", from)
    } catch {}
  }

  if (s.get("autoRecording")) {
    try {
      await sock.sendPresenceUpdate("recording", from)
      await helper.sleep(5000)
      await sock.sendPresenceUpdate("paused", from)
    } catch {}
  }

  if (s.get("autoReply")) {
    const prefix = s.get("prefix") || BOT_PREFIX
    const text = (s.get("autoReplyText") || "").replace(/\{prefix\}/g, prefix)
    if (text) {
      try { await sock.sendMessage(from, { text }, { quoted: msg }) } catch {}
    }
  }
}

// ─── Status updates — view + react ───────────────────────────────────────
async function handleStatus(state, sock, msg) {
  if (msg.key.fromMe) return
  const s = state.settings

  if (s.get("autoViewStatus")) {
    try { await sock.readMessages([msg.key]) } catch {}
  }

  if (s.get("autoReactStatus")) {
    const emoji = s.get("statusReactEmoji") || "🔥"
    try {
      await sock.sendMessage("status@broadcast", {
        react: { text: emoji, key: msg.key }
      }, {
        statusJidList: [msg.key.participant, sock.user?.id].filter(Boolean)
      })
    } catch (e) {
      console.error(`[${state.phone}] STATUS REACT ERR:`, e.message)
    }
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

  // ── Auto Read — fire-and-forget, every incoming message ────────────────
  if (!fromMe && state.settings.get("autoRead")) {
    sock.readMessages([msg.key]).catch(() => {})
  }

  const prefix = state.settings.get("prefix") || BOT_PREFIX

  // ── Ordinary message (not a command) — typing/recording/reply only here
  if (!body.startsWith(prefix)) {
    if (!fromMe) handleOrdinaryMessage(state, sock, msg, from).catch(() => {})
    return
  }

  // ── Owner check — all 5 layers ───────────────────────────────────────────
  const isOwner = checkIsOwner(state, sender, senderAlt, fromMe)

  const mode = state.settings.get("mode") || "public"
  if (mode === "private" && !isOwner && !fromMe) return

  const isGroup = from.endsWith("@g.us")

  // ── Group-only / DM-only modes — owner always bypasses ─────────────────
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

  // ── Admin check — layers 6-10 ────────────────────────────────────────────
  let isAdmin = false, isBotAdmin = false
  if (isGroup) {
    ;({ isAdmin, isBotAdmin } = await checkGroupAdmin(state, sock, from, sender, senderAlt, isOwner))
  }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin} botAdmin:${isBotAdmin}`)

  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands: registry.map, cmdList: registry.list, cmdDetails: registry.details,
      settings: state.settings, lib, helper,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache: state.groupCache,
      // Expose checkers so commands can re-verify if needed
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

  // ── Always Online — re-asserts "available" presence on an interval since
  // WhatsApp presence updates expire after ~10s. Checked live every tick so
  // toggling .settings on/off alwaysOnline takes effect without a restart.
  if (state.presenceTimer) clearInterval(state.presenceTimer)
  state.presenceTimer = setInterval(() => {
    if (state.connected && state.settings.get("alwaysOnline")) {
      sock.sendPresenceUpdate("available").catch(() => {})
    }
  }, 8000)

  sock.ev.on("creds.update", saveCreds)

  // ── Group cache maintenance ──────────────────────────────────────────────
  sock.ev.on("groups.upsert", gs => {
    for (const g of gs) state.groupCache[g.id] = { ...g, _cachedAt: Date.now() }
  })
  sock.ev.on("groups.update", us => {
    for (const u of us)
      state.groupCache[u.id] = { ...(state.groupCache[u.id] || {}), ...u, _cachedAt: Date.now() }
  })
  sock.ev.on("group-participants.update", async ({ id }) => {
    try { state.groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() } } catch {}
  })

  // ── Pairing code — only if NOT already registered ───────────────────────
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
  try { require("./lib/welcome").setStore({ groupMetadata: state.groupCache }) } catch {}

  // ── Message handler ──────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) {
      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue

      // Status updates handled separately (view + react)
      if (m.key.remoteJid === "status@broadcast") {
        handleStatus(state, sock, m).catch(e => console.error(`[${phone}] STATUS ERR:`, e.message))
        continue
      }

      if (!m.key.fromMe) {
        if (typeof lib.handleMemory   === "function") lib.handleMemory(sock, m, extractBody).catch(() => {})
        if (typeof lib.handleAntilink === "function") lib.handleAntilink(sock, m, extractBody).catch(() => {})
      }
      handleMessage(state, sock, m).catch(e => console.error(`[${phone}] MSG ERR:`, e.message))
    }
  })

  sock.ev.on("group-participants.update", async update => {
    if (typeof lib.handleGroupUpdate === "function") lib.handleGroupUpdate(sock, update).catch(() => {})
  })

  // ── Connection lifecycle ─────────────────────────────────────────────────
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      state.connected   = true
      state.retries     = 0
      state.pairingCode = null   // code used — clear it

      const prefix = state.settings.get("prefix") || BOT_PREFIX
      console.log(`[${phone}] ✅ Connected | Prefix: "${prefix}"`)
      if (process.send) process.send({ type: "connected", phone })

      // Welcome notice to owner DM
      const ownerJid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`
      setTimeout(async () => {
        try {
          await sock.sendMessage(ownerJid, {
            text: helper.box("✅ CYBER X ONLINE", [
              "Your bot has been deployed",
              "and is now active. 🚀",
              "",
              `Type ${prefix}menu to view`,
              "the latest commands.",
            ])
          })
        } catch {}
      }, 4000)

      // Pre-warm group cache so admin checks are instant from the first command
      try {
        const all = await sock.groupFetchAllParticipating()
        for (const [jid, meta] of Object.entries(all))
          state.groupCache[jid] = { ...meta, _cachedAt: Date.now() }
        console.log(`[${phone}] 📦 Cached ${Object.keys(all).length} groups`)
      } catch {}
    }

    if (connection === "close") {
      state.connected = false
      const code = lastDisconnect?.error?.output?.statusCode
      if (process.send) process.send({ type: "disconnected", phone })
      const shouldReconnect = code !== DisconnectReason.loggedOut
      console.log(`[${phone}] 🔌 Disconnected code:${code}`)

      if (shouldReconnect) {
        const delay = Math.min(1000 * Math.pow(2, state.retries++), 30000)
        console.log(`[${phone}] 🔄 Reconnect in ${delay/1000}s`)
        setTimeout(() => startBot(phone), delay)
      } else {
        console.log(`[${phone}] 🚪 Logged out`)
        if (state.presenceTimer) clearInterval(state.presenceTimer)
        sessions.delete(phone)
        saveMeta()
      }
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSIST WHICH PHONES ARE REGISTERED
// ─────────────────────────────────────────────────────────────────────────────
function loadMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")) } catch { return {} } }
function saveMeta() {
  const out = {}
  for (const [phone] of sessions.entries()) out[phone] = { phone }
  fs.writeFileSync(META_FILE, JSON.stringify(out, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API — used by server.js
// ─────────────────────────────────────────────────────────────────────────────
async function addSession(phone) {
  const clean = phone.replace(/\D/g, "")
  if (!clean || clean.length < 7) throw new Error("Invalid phone number")
  if (sessions.has(clean) && sessions.get(clean).connected)
    return { message: "Already connected", phone: clean }
  await startBot(clean)
  saveMeta()
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500))
    const s = sessions.get(clean)
    if (s?.pairingCode) return { phone: clean, pairingCode: s.pairingCode }
    if (s?.connected)   return { phone: clean, message: "Connected (session restored)" }
  }
  return { phone: clean, message: "Starting — check logs for pairing code" }
}

function removeSession(phone) {
  const clean = phone.replace(/\D/g, "")
  const state = sessions.get(clean)
  if (state?.presenceTimer) clearInterval(state.presenceTimer)
  if (state?.sock) { try { state.sock.end() } catch {} }
  sessions.delete(clean)
  saveMeta()
  const dir = path.join(SESS_ROOT, clean)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

function listBots() {
  return [...sessions.entries()].map(([phone, s]) => ({
    phone, connected: s.connected, pairingCode: s.pairingCode || null
  }))
}

async function init() {
  await loadCommands()
  watchCommands()

  setInterval(() => {
    for (const state of sessions.values()) {
      const now = Date.now()
      for (const jid of Object.keys(state.groupCache))
        if (now - (state.groupCache[jid]._cachedAt || 0) > 30 * 60 * 1000)
          delete state.groupCache[jid]
    }
    if (global.gc) global.gc()
    const mem = process.memoryUsage()
    console.log(`[CLEAN] Heap:${Math.round(mem.heapUsed/1024/1024)}MB RSS:${Math.round(mem.rss/1024/1024)}MB`)
  }, 15 * 60 * 1000)

  const meta = loadMeta()
  for (const phone of Object.keys(meta)) {
    const dir = path.join(SESS_ROOT, phone)
    if (fs.existsSync(dir)) {
      console.log(`[RESTORE] ♻️  ${phone}`)
      await startBot(phone).catch(e => console.error(`[RESTORE] ✗ ${phone}: ${e.message}`))
    }
  }
}

module.exports = { init, addSession, removeSession, listBots }
