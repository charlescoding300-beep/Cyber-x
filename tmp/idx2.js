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

// Do NOT override prefix here — let settings.js manage it from disk
// Only set it if settings never loaded at all (fallback)
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
