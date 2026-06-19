require("dotenv").config()
const fs     = require("fs")
const path   = require("path")
const Pino   = require("pino")
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

// ── Permission-critical modules — required directly, not via the dynamic
// lib/ loader below. Both lib/isAdmin.js and lib/settings.js export a
// function called isOwner, and the dynamic loader flattens everything onto
// one shared `lib` object — whichever loads alphabetically last silently
// wins. Requiring these two explicitly removes that ambiguity for anything
// permission-related. (Node caches modules, so this is still the exact same
// singleton instance the dynamic loader also picks up — no duplicated state.)
const isAdminLib = require("./lib/isAdmin")
const settingsLib = require("./lib/settings")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

const BOT_START  = Math.floor(Date.now() / 1000)
const CMD_DIR    = path.join(__dirname, "commands")
const LIB_DIR    = path.join(__dirname, "lib")
const UTILS_DIR  = path.join(__dirname, "utils")
const SESS_ROOT  = path.join(__dirname, "sessions")
const BOT_PREFIX = process.env.BOT_PREFIX || "."

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, SESS_ROOT])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─── Load lib/ and utils/ once, shared across all sessions ──
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

// ─── Command registry — loaded once, shared across all sessions ──
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

// ─── Helpers — shared across all sessions ───────────────────
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
  async reply(sock, msg, text) { return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg }) },
  async send(sock, jid, text)  { return sock.sendMessage(jid, { text }) },
  async react(sock, msg, emoji){ return sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }) },
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
  sleep(ms) { return new Promise(r => setTimeout(r, ms)) },
}

// ─── Per-session state — one entry per connected number ─────
const sessions = new Map()

// ── Session state now uses lib/settings.js's per-user layer directly ────────
// settingsLib.forUser(phone) auto-falls-back to the global store for any key
// the user hasn't customized themselves — no separate per-session JSON file
// to keep in sync anymore.
function makeSessionState(phone) {
  const sessDir = path.join(SESS_ROOT, phone)
  if (!fs.existsSync(sessDir)) fs.mkdirSync(sessDir, { recursive: true })

  return {
    phone,
    sessDir,
    settings:   settingsLib.forUser(phone),
    groupCache: {},
    retries:    0,
    sock:       null,
    connected:  false,
  }
}

// ─── Owner check — wired straight to lib/isAdmin.js, fully automatic ────────
// 1. The number that linked this specific session is always its owner
//    (compared against state.phone directly — not a settings key, since
//    settings now layers onto the global store and shouldn't carry
//    session-identity data).
// 2. Falls back to global owners (lib/settings.js owners[] / OWNER_NUMBER
//    env) via isAdminLib.isOwner(), so no manual ".owner <password>" step
//    is needed.
function checkIsOwner(state, sender, senderAlt) {
  const ownerNum  = (state.phone || "").replace(/\D/g, "")
  const senderNum = (sender || "").split("@")[0].split(":")[0].replace(/\D/g, "")
  const altNum    = senderAlt ? senderAlt.split("@")[0].split(":")[0].replace(/\D/g, "") : null

  if (ownerNum && (senderNum === ownerNum || (altNum && altNum === ownerNum))) return true

  if (isAdminLib.isOwner(sender)) return true
  if (senderAlt && isAdminLib.isOwner(senderAlt)) return true

  return false
}

async function handleMessage(state, sock, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const prefix = state.settings.get("prefix") || BOT_PREFIX
  if (!body.startsWith(prefix)) return

  const from      = msg.key.remoteJid
  const sender    = msg.key.participant || from
  const senderAlt = msg.key.participantPn || msg.key.participantAlt || null
  const fromMe    = msg.key.fromMe === true
  const isOwner   = checkIsOwner(state, sender, senderAlt)
  const mode      = state.settings.get("mode") || "public"
  if (mode === "private" && !isOwner && !fromMe) return

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = registry.aliases.get(rawCmd) || rawCmd
  const command   = registry.map.get(canonical)
  if (!command) return

  // ── Real admin checks — wired straight to lib/isAdmin.js, lid + phone-
  // number safe. Passing state.groupCache explicitly (not isAdmin.js's
  // singleton cache wrapper) keeps each session's admin check isolated from
  // every other linked session running through this same process.
  const isGroup = from.endsWith("@g.us")
  let isAdmin = false, isBotAdmin = false
  if (isGroup) {
    isAdmin    = isAdminLib.isAdmin(state.groupCache, from, sender, sock, null, senderAlt)
    isBotAdmin = isAdminLib.isBotAdmin(state.groupCache, from, sock)
  }

  console.log(`[${state.phone}] ▶ ${rawCmd} | owner:${isOwner} admin:${isAdmin}`)
  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands: registry.map, cmdList: registry.list, cmdDetails: registry.details,
      settings: state.settings, lib, helper,
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache: state.groupCache,
    })
  } catch (e) {
    console.error(`[${state.phone}] RUN ERR ${rawCmd}: ${e.message}`)
    try { await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e.message}` }, { quoted: msg }) } catch {}
  }
}

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
    cachedGroupMetadata: async jid => state.groupCache[jid],
  })

  state.sock = sock

  sock.ev.on("creds.update", saveCreds)

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

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) {
      const ts = Number(m.messageTimestamp) || 0
      if (ts < BOT_START - 15) continue
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

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      state.connected = true
      state.retries   = 0
      const prefix = state.settings.get("prefix") || BOT_PREFIX
      console.log(`[${phone}] ✅ Connected | Prefix: "${prefix}"`)

      // ── Clean "bot online" notice — points to .menu ───────────────────
      const ownerJid = `${phone.replace(/\D/g,"")}@s.whatsapp.net`
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
      if (process.send) process.send({ type: 'disconnected' })
      const shouldReconnect = code !== DisconnectReason.loggedOut
      console.log(`[${phone}] 🔌 Disconnected code:${code}`)
      if (shouldReconnect) {
        const delay = Math.min(1000 * Math.pow(2, state.retries++), 30000)
        console.log(`[${phone}] 🔄 Reconnect in ${delay/1000}s`)
        setTimeout(() => startBot(phone), delay)
      } else {
        console.log(`[${phone}] 🚪 Logged out`)
        sessions.delete(phone)
        saveMeta()
      }
    }
  })
}

// ─── Persist which phones are registered ────────────────────
const META_FILE = path.join(SESS_ROOT, "_meta.json")
function loadMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")) } catch { return {} } }
function saveMeta() {
  const out = {}
  for (const [phone] of sessions.entries()) out[phone] = { phone }
  fs.writeFileSync(META_FILE, JSON.stringify(out, null, 2))
}

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
