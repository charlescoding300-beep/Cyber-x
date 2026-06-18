// ─────────────────────────────────────────────────────────────────────────────
// lib/userCommandLoader.js  —  CYBER X  |  Per-User Command Loader
//
// Mirrors index.js command loading logic exactly — but runs independently
// for each user session in server.js.
//
// Each linked user gets:
//   - Full access to commands/ folder (same as your own bot)
//   - Same prefix, same run() context, same pattern matching
//   - Their own isOwner check (they are owner of their own session)
//   - Hot reload when commands/ changes
//   - O(1) Map lookup — no disk reads during message handling
//
// Owner-only commands (.fuckme, .update, .restart etc) are blocked
// for regular users unless you set allowOwnerCmds = true
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const CMD_DIR = path.join(__dirname, "..", "commands")

// ── Owner-only command patterns to block for linked users ────────────────────
const OWNER_ONLY_CMDS = new Set([
  "", "update", "restart", "shutdown", "eval",
  "exec", "shell", "", "",
])

// ── Shared registry (all user sessions share the same loaded commands) ───────
// Commands are stateless — safe to share across sessions
const registry = {
  map:     new Map(),   // key -> module
  list:    [],          // [".cmd1", ".cmd2", ...]
  details: [],          // [{ pattern, desc, usage, category }]
}

let loaded    = false
let watchStarted = false

// ─────────────────────────────────────────────────────────────────────────────
// LOAD COMMANDS — same logic as index.js
// ─────────────────────────────────────────────────────────────────────────────

const isValidCmd = m =>
  m && typeof m.pattern === "string" && typeof m.run === "function"

const toKey = p =>
  p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (!isValidCmd(mod)) return false
    registry.map.set(toKey(mod.pattern), mod)
    return true
  } catch (e) {
    console.error(`[UCL] ✗ ${file}: ${e.message}`)
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
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) return
  registry.map.clear()
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js")).sort()
  let ok = 0, fail = 0
  for (const f of files) { if (loadFile(f)) ok++; else fail++ }
  rebuildLists()
  loaded = true
  console.log(`[UCL] ⚡ ${ok} commands loaded | ${fail} skipped`)
}

function watchCommands() {
  if (watchStarted || !fs.existsSync(CMD_DIR)) return
  watchStarted = true
  let debounce = null
  fs.watch(CMD_DIR, { persistent: false }, (_, f) => {
    if (!f?.endsWith(".js")) return
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      loadFile(f)
      rebuildLists()
      console.log(`[UCL] ↺ Hot reloaded: ${f}`)
    }, 100)
  })
  console.log("[UCL] 👁 Watching commands/ for changes")
}

// Load on first require
loadCommands()
watchCommands()

// ─────────────────────────────────────────────────────────────────────────────
// BODY EXTRACTOR — mirrors index.js extractBody exactly
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// HANDLE MESSAGE — called per user session, mirrors index.js handleMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} sock      - Baileys socket for this user
 * @param {object} msg       - raw message object
 * @param {string} userPhone - the linked user's phone number
 * @param {object} [opts]    - options
 * @param {string} [opts.prefix]        - their custom prefix (default ".")
 * @param {string} [opts.ownerPhone]    - their phone = their owner
 * @param {boolean}[opts.privateMode]   - if true, only owner messages run commands
 * @param {boolean}[opts.allowOwnerCmds]- if true, allow owner-only commands
 */
async function handleMessage(sock, msg, userPhone, opts = {}) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const prefix     = opts.prefix || "."
  const ownerPhone = opts.ownerPhone || userPhone
  const privateMode = opts.privateMode || false
  const allowOwnerCmds = opts.allowOwnerCmds || false

  if (!body.startsWith(prefix)) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from
  const senderNum = sender.split("@")[0].split(":")[0].replace(/\D/g, "")

  // isOwner for this user = their own number
  const isOwner = senderNum === ownerPhone.replace(/\D/g, "")

  // Private mode — only owner can use commands
  if (privateMode && !isOwner) return

  const isGroup    = from.endsWith("@g.us")

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = registry.map.get(cmd)
  if (!command) return

  // Block owner-only commands for non-main-owner users
  if (!allowOwnerCmds && OWNER_ONLY_CMDS.has(cmd)) {
    return sock.sendMessage(from, {
      text: `❌ *.${cmd}* is restricted.`,
    }, { quoted: msg })
  }

  console.log(`[UCL:${userPhone}] ▶ .${cmd} from ${senderNum}`)

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:        rest,
      full:        body,
      commands:    registry.map,
      cmdList:     registry.list,
      cmdDetails:  registry.details,
      isOwner,
      isGroup,
      isAdmin:     false,
      isBotAdmin:  false,
      extractBody,
      groupCache:  {},
      settings: {
        botName: process.env.BOT_NAME || "CYBER X",
        prefix,
        owner:   ownerPhone,
        mode:    privateMode ? "private" : "public",
        get(k)    { return this[k] },
        set(k, v) { this[k] = v },
      },
    })
  } catch (e) {
    console.error(`[UCL:${userPhone}] ✗ .${cmd}: ${e.message}`)
    try {
      await sock.sendMessage(from, {
        text: `❌ Error running *.${cmd}*: ${e.message}`,
      }, { quoted: msg })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  handleMessage,
  extractBody,
  loadCommands,
  get registry() { return registry },
  get list()     { return registry.list },
  get details()  { return registry.details },
  get map()      { return registry.map },
}
