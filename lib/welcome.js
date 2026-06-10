// ─────────────────────────────────────────────────────────
// lib/welcome.js — Auto welcome handler + per-group config
// ─────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const DATA_FILE = path.join(__dirname, "..", "data", "welcome.json")

// ── ensure data dir exists ────────────────────────────────
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
}

// ── store reference (injected from index.js) ─────────────
let _store = { groupMetadata: {} }
function setStore(s) { _store = s }

// ── read / write config ───────────────────────────────────
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  } catch {
    return {}
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2))
}

// ── default welcome message ───────────────────────────────
const DEFAULT_MSG = [
  "╔══「 🌟 *WELCOME* 🌟 」══╗",
  "",
  "   *Hey* {tag}*!* 👋",
  "",
  "   🏠 *Group:* _{group}_",
  "   👥 *Members:* *{count}*",
  "   📅 *Joined:* {date} at {time}",
  "",
  "   _Glad to have you here._",
  "   _Please read the group rules_ 📖",
  "",
  "╚══「 *CYBER X* 」══╝"
].join("\n")

// ── resolve template variables ────────────────────────────
function resolve(template, vars) {
  return template
    .replace(/\{tag\}/g,    vars.tag)
    .replace(/\{name\}/g,   vars.name)
    .replace(/\{group\}/g,  vars.group)
    .replace(/\{count\}/g,  vars.count)
    .replace(/\{date\}/g,   vars.date)
    .replace(/\{time\}/g,   vars.time)
    .replace(/\{number\}/g, vars.number)
}

// ── fetch profile picture safely ──────────────────────────
async function getProfilePic(sock, jid) {
  try {
    return await sock.profilePictureUrl(jid, "image")
  } catch {
    return null
  }
}

// ── main handler — called from index.js ──────────────────
async function handleGroupUpdate(sock, update) {
  const { id, participants, action } = update

  // only fire on new members joining (add) or approval
  if (action !== "add" && action !== "promote") return
  if (action === "promote") return  // promote = admin, not a join

  const cfg     = readConfig()
  const groupCfg = cfg[id]

  // skip if welcome is not enabled for this group
  if (!groupCfg?.enabled) return

  const message = groupCfg.message || DEFAULT_MSG

  // get group metadata from cache
  let meta
  try {
    meta = _store.groupMetadata[id] || await sock.groupMetadata(id)
  } catch {
    meta = { subject: id, participants: [] }
  }

  const groupName  = meta.subject || id
  const totalCount = (meta.participants || []).length

  const now    = new Date()
  const date   = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  const time   = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  for (const jid of participants) {
    const number  = jid.split("@")[0]
    const tag     = `@${number}`
    const name    = meta.participants?.find(p => p.id === jid)?.notify || number

    const vars = { tag, name, group: groupName, count: String(totalCount), date, time, number }
    const text = resolve(message, vars)

    const ppUrl = await getProfilePic(sock, jid)

    try {
      if (ppUrl) {
        // ── fancy: profile pic as banner + caption ─────────
        await sock.sendMessage(id, {
          image:    { url: ppUrl },
          caption:  text,
          mentions: [jid],
          jpegThumbnail: null,
        })
      } else {
        // ── fallback: styled text only ─────────────────────
        await sock.sendMessage(id, {
          text:     text,
          mentions: [jid],
        })
      }

      console.log(`[WELCOME] ✔ Sent welcome in ${id} for ${number}`)
    } catch (e) {
      console.error(`[WELCOME] ✗ Failed for ${number}:`, e.message)
    }
  }
}

// ── exports ───────────────────────────────────────────────
module.exports = {
  handleGroupUpdate,
  setStore,
  readConfig,
  writeConfig,
  DEFAULT_MSG,
}
