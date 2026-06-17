"use strict"

const Pino   = require("pino")
const path   = require("path")
const fs     = require("fs")
const crypto = require("crypto")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys")

// ─── Paths ────────────────────────────────────────────────────────────────────
const SESSIONS_ROOT = path.join(__dirname, "../sessions")
const CMD_DIR       = path.join(__dirname, "../commands")
const DATA_FILE     = path.join(__dirname, "../data/sessions.json")

for (const d of [SESSIONS_ROOT, path.dirname(DATA_FILE)])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) } catch { return {} }
}
function saveMeta(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)) } catch {}
}

// ─── In-memory sessions map  { phone → entry } ───────────────────────────────
const sessions = new Map()

// ─── Per-session passwords ───────────────────────────────────────────────────
const sessionPasswords = new Map()  // phone → password string
const sessionVerified  = new Map()  // phone → boolean

const sleep   = ms => new Promise(r => setTimeout(r, ms))
const toKey   = p  => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()
const genPass = ()  => crypto.randomBytes(4).toString("hex").toUpperCase()

// ─── Build command map for sub-sessions ──────────────────────────────────────
function buildCmdMap() {
  const map     = new Map()
  const aliases = new Map()
  if (!fs.existsSync(CMD_DIR)) return { map, aliases }
  const files = fs.readdirSync(CMD_DIR)
    .filter(f => f.endsWith(".js") && f !== "fuckme.js")
    .sort()
  for (const file of files) {
    try {
      const full = path.join(CMD_DIR, file)
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (!mod || typeof mod.pattern !== "string" || typeof mod.run !== "function") continue
      const key = toKey(mod.pattern)
      map.set(key, mod)
      if (Array.isArray(mod.alias))
        for (const a of mod.alias) aliases.set(toKey(a), key)
    } catch (e) { console.error(`[SESSION-CMD] ✗ ${file}: ${e.message}`) }
  }
  console.log(`[SESSION-CMD] ⚡ ${map.size} commands built`)
  return { map, aliases }
}

// ─── Extract body ─────────────────────────────────────────────────────────────
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

// ─── Owner auth for sub-session ───────────────────────────────────────────────
async function handleSubOwnerAuth(entry, sock, msg, body) {
  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  if (from.endsWith("@g.us")) return false
  if (!body.startsWith(".")) return false

  const parts  = body.slice(1).trimStart().split(/\s+/)
  const cmd    = parts[0]?.toLowerCase()
  const passwd = parts[1]?.trim()
  if (cmd !== "owner") return false

  const { phone } = entry
  if (sessionVerified.get(phone)) {
    await sock.sendMessage(from, { text: `✅ *Already verified as owner.*` }, { quoted: msg })
    return true
  }
  if (!passwd) {
    await sock.sendMessage(from, {
      text: `🔐 *Owner Verification*\n\nSend: *.owner <password>*\n\nCheck the DM your bot sent you on startup.`
    }, { quoted: msg })
    return true
  }
  if (passwd.toUpperCase() === sessionPasswords.get(phone)) {
    sessionVerified.set(phone, true)
    entry.ownerJid = sender
    console.log(`[SESSION] ✅ ${phone} owner verified`)
    await sock.sendMessage(from, {
      text:
        `╔══════════════════════════╗\n` +
        `║  ✅ OWNER VERIFIED       ║\n` +
        `╠══════════════════════════╣\n` +
        `║  Welcome back, Boss! 👑  ║\n` +
        `║  All commands unlocked.  ║\n` +
        `╚══════════════════════════╝\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    }, { quoted: msg })
    return true
  }
  console.warn(`[SESSION] ✗ ${phone} wrong password from ${sender}`)
  await sock.sendMessage(from, { text: `❌ *Wrong password.*` }, { quoted: msg })
  return true
}

// ─── Message handler for sub-sessions ────────────────────────────────────────
async function handleUserMessage(entry, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  const body = extractBody(msg)
  if (!body) return

  const { sock, cmdMap, aliases, groupCache, phone } = entry

  const wasAuth = await handleSubOwnerAuth(entry, sock, msg, body)
  if (wasAuth) return

  if (!body.startsWith(".")) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const fromMe = msg.key.fromMe === true

  const slice    = body.slice(1).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = aliases.get(rawCmd) || rawCmd
  const command   = cmdMap.get(canonical)
  if (!command) return

  const verified  = sessionVerified.get(phone) || false
  const ownerJid  = entry.ownerJid || ""
  const senderNum = (sender || "").replace(/\D/g, "")
  const isOwner   = verified && (senderNum.includes(phone) || sender === ownerJid)

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

  console.log(`[${phone}] ▶ ${rawCmd} | owner:${isOwner}`)
  try {
    await command.run({
      sock, from, msg, sender, args,
      text: rest, full: body,
      commands: cmdMap,
      cmdList:  [...cmdMap.keys()].map(k => `.${k}`).sort(),
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache,
    })
  } catch (e) {
    console.error(`[${phone}] RUN ERR ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, { text: `❌ *${rawCmd}* error: ${e.message}` }, { quoted: msg })
    } catch {}
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  START SESSION
// ═════════════════════════════════════════════════════════════════════════════
const MAX_RETRIES = 10
const getDelay    = n => Math.min(1000 * Math.pow(2, n), 30000)

async function startSession(phone, callbacks = {}) {
  const { onPairCode, onConnected, onFail } = callbacks

  const sessionDir = path.join(SESSIONS_ROOT, phone)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

  const { version } = await fetchLatestBaileysVersion()
  const groupCache  = {}
  const { map: cmdMap, aliases } = buildCmdMap()

  // Fresh password every session start
  const password = genPass()
  sessionPasswords.set(phone, password)
  sessionVerified.set(phone, false)
  console.log(`[SESSION] 🔑 ${phone} password: ${password}`)

  const entry = {
    sock: null,
    status: "connecting",
    cmdMap, aliases, groupCache,
    phone, retries: 0,
    ownerJid: null,
    linkedAt: new Date().toISOString(),
  }
  sessions.set(phone, entry)

  // Persist metadata
  const meta = loadMeta()
  meta[phone] = { phone, linkedAt: entry.linkedAt }
  saveMeta(meta)

  const BOT_START = Math.floor(Date.now() / 1000)

  async function createSocket() {
    let state, saveCreds
    try {
      ;({ state, saveCreds } = await useMultiFileAuthState(sessionDir))
    } catch (e) {
      console.error(`[SESSION] ✗ ${phone} auth state: ${e.message}`)
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
      cachedGroupMetadata: async jid => groupCache[jid],
    })

    entry.sock = sock

    sock.ev.on("creds.update", async () => {
      try { await saveCreds() } catch (e) {
        console.error(`[SESSION] ✗ ${phone} saveCreds: ${e.message}`)
      }
    })

    sock.ev.on("groups.upsert", gs => {
      for (const g of gs) groupCache[g.id] = { ...g, _cachedAt: Date.now() }
    })
    sock.ev.on("groups.update", us => {
      for (const u of us)
        groupCache[u.id] = groupCache[u.id]
          ? Object.assign(groupCache[u.id], u, { _cachedAt: Date.now() })
          : { ...u, _cachedAt: Date.now() }
    })
    sock.ev.on("group-participants.update", async ({ id }) => {
      try { groupCache[id] = { ...(await sock.groupMetadata(id)), _cachedAt: Date.now() } } catch {}
    })

    // Pairing code — wait for socket ready
    if (!state.creds.registered) {
      console.log(`[SESSION] 🔑 ${phone} — requesting pairing code`)
      await sleep(2000)
      try {
        const code = await sock.requestPairingCode(phone)
        console.log(`[SESSION] 🔑 ${phone} → ${code}`)
        if (onPairCode) onPairCode(code)
      } catch (e) {
        console.error(`[SESSION] ✗ ${phone} pair code: ${e.message}`)
        await sleep(3000)
        try {
          const code = await sock.requestPairingCode(phone)
          console.log(`[SESSION] 🔑 ${phone} retry → ${code}`)
          if (onPairCode) onPairCode(code)
        } catch (e2) {
          console.error(`[SESSION] ✗ ${phone} pair code retry: ${e2.message}`)
          if (onFail) onFail(e2.message)
        }
      }
    } else {
      console.log(`[SESSION] ✔ ${phone} has creds — reconnecting`)
    }

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        if ((Number(m.messageTimestamp) || 0) < BOT_START - 15) continue
        handleUserMessage(entry, m).catch(e =>
          console.error(`[${phone}] MSG ERR:`, e.message)
        )
      }
    })

    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        entry.retries = 0
        entry.status  = "online"
        console.log(`[SESSION] ✅ ${phone} online`)

        // DM the password to the user via their own linked number
        const ownerJid = `${phone}@s.whatsapp.net`
        setTimeout(async () => {
          try {
            await sock.sendMessage(ownerJid, {
              text:
                `╔══════════════════════════╗\n` +
                `║  🔐 CYBER X — STARTED    ║\n` +
                `╠══════════════════════════╣\n` +
                `║  Your bot is now online! ║\n` +
                `║                          ║\n` +
                `║  Session Password:       ║\n` +
                `║  *${password}*              ║\n` +
                `║                          ║\n` +
                `║  Type to unlock:         ║\n` +
                `║  *.owner ${password}*    ║\n` +
                `╚══════════════════════════╝\n\n` +
                `_Then type *.menu* to get started._\n\n© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
            })
            console.log(`[SESSION] 📨 Password sent to ${phone}`)
          } catch (e) {
            console.error(`[SESSION] ✗ Could not DM ${phone}: ${e.message}`)
          }
        }, 4000)

        // Warm group cache
        try {
          const all = await sock.groupFetchAllParticipating()
          let n = 0
          for (const [jid, meta] of Object.entries(all)) {
            groupCache[jid] = { ...meta, _cachedAt: Date.now() }; n++
          }
          console.log(`[SESSION] ✔ ${phone} — ${n} groups cached`)
        } catch {}

        if (onConnected) onConnected()
      }

      if (connection === "close") {
        entry.status = "offline"
        const code   = lastDisconnect?.error?.output?.statusCode

        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          console.log(`[SESSION] 🚪 ${phone} logged out — wiping`)
          sessions.delete(phone)
          sessionPasswords.delete(phone)
          sessionVerified.delete(phone)
          const meta = loadMeta()
          delete meta[phone]
          saveMeta(meta)
          try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
          return
        }

        try { sock.ev.removeAllListeners() } catch {}

        if (entry.retries < MAX_RETRIES) {
          const delay = getDelay(entry.retries)
          console.log(`[SESSION] ↺ ${phone} retry ${++entry.retries}/${MAX_RETRIES} in ${delay}ms`)
          setTimeout(() => createSocket().catch(e =>
            console.error(`[SESSION] ✗ ${phone} reconnect: ${e.message}`)
          ), delay)
        } else {
          console.log(`[SESSION] ✗ ${phone} max retries — dropping`)
          sessions.delete(phone)
        }
      }
    })
  }

  await createSocket()
  return entry
}

// ─── Restore all sessions on startup ─────────────────────────────────────────
async function restoreAllSessions() {
  if (!fs.existsSync(SESSIONS_ROOT)) return
  const phones = fs.readdirSync(SESSIONS_ROOT).filter(name => {
    const dir = path.join(SESSIONS_ROOT, name)
    return (
      fs.statSync(dir).isDirectory() &&
      fs.existsSync(path.join(dir, "creds.json"))
    )
  })
  if (!phones.length) { console.log("[SESSION] No saved sessions to restore"); return }
  console.log(`[SESSION] 🔄 Restoring ${phones.length} session(s): ${phones.join(", ")}`)
  for (const phone of phones) {
    if (sessions.has(phone)) continue
    try {
      await startSession(phone, {
        onConnected: () => console.log(`[SESSION] ✅ Restored: ${phone}`),
        onFail:      err => console.error(`[SESSION] ✗ Restore ${phone}: ${err}`),
      })
      await sleep(2500) // stagger so WA doesn't rate-limit
    } catch (e) { console.error(`[SESSION] ✗ ${phone}: ${e.message}`) }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  startSession,
  restoreAllSessions,
  getSession:      phone => sessions.get(phone),
  getAllSessions:  () => Object.fromEntries(sessions),
  deleteSession:  async phone => {
    sessions.delete(phone)
    sessionPasswords.delete(phone)
    sessionVerified.delete(phone)
    const meta = loadMeta()
    delete meta[phone]
    saveMeta(meta)
    const dir = path.join(SESSIONS_ROOT, phone)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  },
}
