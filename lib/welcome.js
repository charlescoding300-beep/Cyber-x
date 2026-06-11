// ════════════════════════════════════════════════════════════════════
//  lib/welcome.js — CYBER X | Auto Welcome — Fast Profile Pic Build
// ════════════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_FILE    = path.join(__dirname, "..", "data", "welcome.json")
const DEFAULT_AVATAR = "https://i.imgur.com/HUBpBsg.png"   // fallback avatar

if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
}

let _store = { groupMetadata: {} }
function setStore(s) { _store = s }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }
  catch { return {} }
}

function writeConfig(cfg) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2))
}

const DEFAULT_MSG = [
  "╔══「 🌟 *WELCOME* 🌟 」══╗",
  "",
  "  *Hey* {tag}*!* 👋",
  "",
  "  🏠 *Group  :* _{group}_",
  "  👥 *Members:* *{count}*",
  "  📅 *Joined :* {date} • {time}",
  "",
  "  _Glad to have you here._",
  "  _Please read the group rules_ 📖",
  "",
  "╚══「 ⚡ *CYBER X* 」══╝",
].join("\n")

function resolve(tpl, vars) {
  return tpl
    .replace(/\{tag\}/g,    vars.tag)
    .replace(/\{name\}/g,   vars.name)
    .replace(/\{group\}/g,  vars.group)
    .replace(/\{count\}/g,  vars.count)
    .replace(/\{date\}/g,   vars.date)
    .replace(/\{time\}/g,   vars.time)
    .replace(/\{number\}/g, vars.number)
}

async function handleGroupUpdate(sock, update) {
  const { id, participants, action } = update
  if (action !== "add") return

  const cfg = readConfig()
  if (!cfg[id]?.enabled) return

  const message = cfg[id].message || DEFAULT_MSG

  // get group metadata — cache first, live fallback
  let meta
  try {
    meta = _store.groupMetadata[id] || await sock.groupMetadata(id)
  } catch {
    meta = { subject: id, participants: [] }
  }

  const groupName  = meta.subject || id
  const totalCount = (meta.participants || []).length
  const now        = new Date()
  const date       = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  const time       = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  for (const jid of participants) {
    const number = jid.split("@")[0]
    const tag    = `@${number}`
    const name   = meta.participants?.find(p => p.id === jid)?.notify || number
    const text   = resolve(message, { tag, name, group: groupName, count: String(totalCount), date, time, number })

    // ── FAST profile pic — try high-res, instant fallback ─────
    let pp
    try {
      pp = await sock.profilePictureUrl(jid, "image")
    } catch {
      pp = DEFAULT_AVATAR
    }

    try {
      await sock.sendMessage(id, {
        image:    { url: pp },
        caption:  text,
        mentions: [jid],
      })
      console.log(`[WELCOME] ✔ ${number}`)
    } catch (e) {
      console.error(`[WELCOME] ✗ ${number}:`, e.message)
    }
  }
}

module.exports = { handleGroupUpdate, setStore, readConfig, writeConfig, DEFAULT_MSG }
