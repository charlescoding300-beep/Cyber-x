const path = require("path")
const fs   = require("fs")

const CMD_DIR = path.join(__dirname, "../commands")

const registry = {
  map:     new Map(),
  list:    [],
  details: [],
}

const isValidCmd = m => m && typeof m.pattern === "string" && typeof m.run === "function"
const toKey = p => p.replace(/^[^a-z0-9]*/i, "").toLowerCase().trim()

function loadFile(file) {
  const full = path.join(CMD_DIR, file)
  try {
    delete require.cache[require.resolve(full)]
    const mod = require(full)
    if (!isValidCmd(mod)) return false
    registry.map.set(toKey(mod.pattern), mod)
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
  })).sort((a, b) => a.pattern.localeCompare(b.pattern))
}

function loadCommands() {
  if (!fs.existsSync(CMD_DIR)) fs.mkdirSync(CMD_DIR, { recursive: true })
  const files = fs.readdirSync(CMD_DIR).filter(f => f.endsWith(".js"))
  registry.map.clear()
  files.forEach(loadFile)
  rebuildLists()
  console.log(`[CMD] ⚡ Loaded: ${[...registry.map.keys()].join(", ")}`)
}

function extractBody(msg) {
  const m = msg.message
  return (
    m?.conversation                                           ||
    m?.extendedTextMessage?.text                             ||
    m?.imageMessage?.caption                                 ||
    m?.videoMessage?.caption                                 ||
    m?.buttonsResponseMessage?.selectedButtonId              ||
    m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  )
}

async function handleMessage(sock, msg, fromMe, sessionEntry, userId) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return

  const body = extractBody(msg)
  if (!body) return

  const prefix = "."
  if (!body.startsWith(prefix)) return

  const from   = msg.key.remoteJid
  const sender = msg.key.participant || from

  const slice    = body.slice(prefix.length).trimStart()
  const spaceIdx = slice.indexOf(" ")
  const cmd      = (spaceIdx === -1 ? slice : slice.slice(0, spaceIdx)).toLowerCase()
  const rest     = spaceIdx === -1 ? "" : slice.slice(spaceIdx + 1).trim()
  const args     = rest ? rest.split(/\s+/) : []

  const command = registry.map.get(cmd)
  if (!command) return

  const isGroup = from.endsWith("@g.us")

  try {
    await command.run({
      sock,
      from,
      msg,
      sender,
      args,
      text:       rest,
      full:       body,
      cmdList:    registry.list,
      cmdDetails: registry.details,
      isGroup,
      userId,
      groupCache: sessionEntry.groupCache,
      extractBody,
    })
  } catch (e) {
    console.error(`[RUN ERR] ${cmd}:`, e.message)
    try { await sock.sendMessage(from, { text: `❌ Error: ${e.message}` }) } catch {}
  }
}

module.exports = { loadCommands, handleMessage, registry }
