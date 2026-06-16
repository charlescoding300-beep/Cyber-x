"use strict"

const Pino  = require("pino")
const path  = require("path")
const fs    = require("fs")

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require("@whiskeysockets/baileys")

// ─── Paths ───────────────────────────────────────────────────────────────────
const SESSIONS_ROOT = path.join(__dirname, "../sessions")
const CMD_DIR       = path.join(__dirname)              // same commands/ folder
if (!fs.existsSync(SESSIONS_ROOT)) fs.mkdirSync(SESSIONS_ROOT, { recursive: true })

// ─── Active sessions map  { phone → SessionEntry } ───────────────────────────
// SessionEntry: { sock, status, cmdMap, groupCache, retries, phone }
const userSessions = new Map()

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND REGISTRY  (mirrors index.js registry pattern)
// ═══════════════════════════════════════════════════════════════════════════════

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
      // always reload fresh so hot-reloads in the main bot carry over
      delete require.cache[require.resolve(full)]
      const mod = require(full)
      if (!mod || typeof mod.pattern !== "string" || typeof mod.run !== "function") continue

      const key = toKey(mod.pattern)
      map.set(key, mod)

      if (Array.isArray(mod.alias))
        for (const a of mod.alias) aliases.set(toKey(a), key)
    } catch (e) {
      console.error(`[SESSION-CMD] ✗ ${file}: ${e.message}`)
    }
  }

  console.log(`[SESSION-CMD] ⚡ ${map.size} commands loaded`)
  return { map, aliases }
}

const toKey = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

// ═══════════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER  (mirrors index.js handleMessage)
// ═══════════════════════════════════════════════════════════════════════════════

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

async function handleUserMessage(entry, msg) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const PREFIX = "."
  if (!body.startsWith(PREFIX)) return

  const { sock, cmdMap, aliases, groupCache, phone } = entry
  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const fromMe = msg.key.fromMe === true

  const slice    = body.slice(PREFIX.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const rawCmd   = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const canonical = aliases.get(rawCmd) || rawCmd
  const command   = cmdMap.get(canonical)
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
      commands:   cmdMap,
      cmdList:    [...cmdMap.keys()].map(k => `.${k}`).sort(),
      isOwner, isGroup, isAdmin, isBotAdmin, fromMe,
      extractBody, groupCache,
    })
  } catch (e) {
    console.error(`[${phone}] RUN ERR ${rawCmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ *${rawCmd}* error: ${e.message}`
      }, { quoted: msg })
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SESSION STARTER  (mirrors index.js startBot)
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_RETRIES = 10
const getDelay    = n => Math.min(1000 * Math.pow(2, n), 30000)

async function startUserSession(phone, callbacks = {}) {
  const { onPairCode, onConnected, onFail } = callbacks

  const sessionDir = path.join(SESSIONS_ROOT, phone)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

  // FIX: fetch version once, reuse across reconnects
  const { version } = await fetchLatestBaileysVersion()

  const groupCache = {}
  const { map: cmdMap, aliases } = buildCmdMap()

  const entry = { sock: null, status: "connecting", cmdMap, aliases, groupCache, phone, retries: 0 }
  userSessions.set(phone, entry)

  const BOT_START = Math.floor(Date.now() / 1000)

  // FIX: createSocket is now async — reloads state fresh from disk every time
  // so reconnects use the saved creds, not stale in-memory ones
  async function createSocket() {
    let state, saveCreds
    try {
      ;({ state, saveCreds } = await useMultiFileAuthState(sessionDir))
    } catch (e) {
      console.error(`[SESSION] ✗ ${phone} failed to load auth state: ${e.message}`)
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

    // FIX: saveCreds listener — await it so writes complete before socket closes
    sock.ev.on("creds.update", async () => {
      try { await saveCreds() } catch (e) {
        console.error(`[SESSION] ✗ ${phone} saveCreds failed: ${e.message}`)
      }
    })

    // ── Group cache ───────────────────────────────────────────────────────────
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

    // FIX: registered check is now INSIDE createSocket so it reads the
    // freshly-loaded state — on reconnect registered=true so no new pairing
    if (!state.creds.registered) {
      console.log(`[SESSION] 🔑 ${phone} not registered — requesting pairing code`)
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phone)
          console.log(`[SESSION] 🔑 ${phone} → ${code}`)
          if (onPairCode) onPairCode(code)
        } catch (e) {
          console.error(`[SESSION] pair code error for ${phone}: ${e.message}`)
          if (onFail) onFail(e.message)
        }
      }, 3000)
    } else {
      console.log(`[SESSION] ✔ ${phone} has saved creds — reconnecting without pairing`)
    }

    // ── Message handler ───────────────────────────────────────────────────────
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return
      for (const m of messages) {
        if ((Number(m.messageTimestamp) || 0) < BOT_START - 15) continue
        handleUserMessage(entry, m).catch(e =>
          console.error(`[${phone}] MSG ERR:`, e.message)
        )
      }
    })

    // ── Connection lifecycle ──────────────────────────────────────────────────
    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        entry.retries = 0
        entry.status  = "online"
        console.log(`[SESSION] ✅ ${phone} online`)

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
          console.log(`[SESSION] 🚪 ${phone} logged out — wiping session`)
          userSessions.delete(phone)
          try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
          return
        }

        try { sock.ev.removeAllListeners() } catch {}

        if (entry.retries < MAX_RETRIES) {
          const delay = getDelay(entry.retries)
          console.log(`[SESSION] ↺ ${phone} retry ${++entry.retries}/${MAX_RETRIES} in ${delay}ms`)
          // FIX: setTimeout on async createSocket — loads fresh creds from disk
          setTimeout(() => createSocket().catch(e =>
            console.error(`[SESSION] ✗ ${phone} reconnect failed: ${e.message}`)
          ), delay)
        } else {
          console.log(`[SESSION] ✗ ${phone} max retries reached — giving up`)
          userSessions.delete(phone)
        }
      }
    })

    return sock
  }

  // Kick off first connection
  await createSocket()
  return entry
}

// ═══════════════════════════════════════════════════════════════════════════════
//  .fuckme COMMAND EXPORT
// ═══════════════════════════════════════════════════════════════════════════════


async function restoreAllSessions() {
  if (!fs.existsSync(SESSIONS_ROOT)) return
  const phones = fs.readdirSync(SESSIONS_ROOT).filter(name => {
    const dir = path.join(SESSIONS_ROOT, name)
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "creds.json"))
  })
  if (!phones.length) { console.log("[SESSION] No saved sessions to restore"); return }
  console.log(`[SESSION] Restoring ${phones.length} session(s): ${phones.join(", ")}`)
  for (const phone of phones) {
    if (userSessions.has(phone)) continue
    try {
      await startUserSession(phone, {
        onConnected: () => console.log(`[SESSION] ✅ Restored: ${phone}`),
        onFail:      err => console.error(`[SESSION] ✗ Restore failed ${phone}: ${err}`),
      })
      await new Promise(r => setTimeout(r, 2000))
    } catch (e) { console.error(`[SESSION] ✗ ${phone}: ${e.message}`) }
  }
}

module.exports = {
  restoreAllSessions,
  userSessions,
  pattern:  "fuckme",
  alias:    ["linkbot", "connect", "pair"],
  desc:     "Link your WhatsApp to CYBER X — get your own running bot session",
  usage:    ".fuckme <phone_with_country_code>",
  category: "tools",

  async run({ sock, from, msg, args }) {
    const phone = (args[0] || "").replace(/\D/g, "")

    // ── Validation ────────────────────────────────────────────────────────────
    if (!phone || phone.length < 7) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Invalid number!*",
          "",
          "Usage: *.fuckme 2348012345678*",
          "• Include country code (no + or spaces)",
          "",
          "Example: *.fuckme 2348012345678*"
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Already online ────────────────────────────────────────────────────────
    const existing = userSessions.get(phone)
    if (existing?.status === "online") {
      return sock.sendMessage(from, {
        text: [
          "✅ *Already Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "Your bot is active. Type *.menu* in your chats.",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (existing?.status === "connecting") {
      return sock.sendMessage(from, {
        text: [
          "⏳ *Already Connecting...*",
          `📱 *Number:* +${phone}`,
          "",
          "Please wait — pairing code is being generated.",
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Start session ─────────────────────────────────────────────────────────
    try { await sock.sendMessage(from, { react: { text: "🔄", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "⏳ *Starting CYBER X session...*",
        `📱 *Number:* +${phone}`,
        "🔄 Connecting to WhatsApp...",
        "",
        "_Requesting pairing code — please wait 10–30s..._"
      ].join("\n")
    }, { quoted: msg })

    let pairCode  = null
    let connected = false
    let failed    = null

    try {
      await startUserSession(phone, {
        onPairCode:  code  => { pairCode  = code },
        onConnected: ()    => { connected = true },
        onFail:      err   => { failed    = err  },
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ *Failed to start session:*\n${e.message}`
      }, { quoted: msg })
    }

    // Wait up to 35s for pair code or instant connect
    for (let i = 0; i < 35; i++) {
      await sleep(1000)
      if (pairCode || connected || failed) break
    }

    if (failed) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Failed!*",
          `Reason: ${failed}`,
          "",
          `Retry: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // Already connected before code was needed (re-auth)
    if (connected && !pairCode) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      return sock.sendMessage(from, {
        text: [
          "✅ *Bot Connected!*",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "Type *.menu* to see all commands.",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    }

    if (!pairCode) {
      return sock.sendMessage(from, {
        text: [
          "❌ *Pairing Code Timeout!*",
          `Could not get code for +${phone}`,
          "• Check the number exists on WhatsApp",
          "• Check country code is correct",
          "",
          `Retry: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }

    // ── Send pairing code ─────────────────────────────────────────────────────
    const formatted = pairCode.length === 8
      ? `${pairCode.slice(0, 4)}-${pairCode.slice(4)}`
      : pairCode

    try { await sock.sendMessage(from, { react: { text: "🔑", key: msg.key } }) } catch {}

    await sock.sendMessage(from, {
      text: [
        "🔑 *CYBER X — Pairing Code*",
        "━━━━━━━━━━━━━━━━━━━━",
        `📱 *Number:* +${phone}`,
        "",
        "╔══════════════════════╗",
        `║   *${formatted}*   ║`,
        "╚══════════════════════╝",
        "",
        "*How to link:*",
        `1️⃣ Open WhatsApp on +${phone}`,
        "2️⃣ Tap ⋮ → *Linked Devices*",
        "3️⃣ Tap *Link a Device*",
        "4️⃣ Tap *Link with phone number instead*",
        "5️⃣ Enter the code above ☝️",
        "",
        "⏰ *Act fast — expires in 60s!*",
        "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
      ].join("\n")
    }, { quoted: msg })

    // Wait up to 60s for user to enter code
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      if (connected) break
    }

    if (connected) {
      try { await sock.sendMessage(from, { react: { text: "✅", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "✅ *Successfully Connected!*",
          "━━━━━━━━━━━━━━━━━━━━",
          `📱 *Number:* +${phone}`,
          "🟢 *Status:* Online & Running",
          "",
          "• Type *.menu* for all commands",
          "• Bot listens to prefix *.*",
          "• Works in DMs and groups",
          "",
          "© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™"
        ].join("\n")
      }, { quoted: msg })
    } else {
      try { await sock.sendMessage(from, { react: { text: "⚠️", key: msg.key } }) } catch {}
      await sock.sendMessage(from, {
        text: [
          "⚠️ *Code Not Confirmed Yet*",
          "",
          "Session is still running in background.",
          "• If you entered the code — wait 30s more",
          `• New code: *.fuckme ${phone}*`
        ].join("\n")
      }, { quoted: msg })
    }
  },
}
