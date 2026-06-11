// ════════════════════════════════════════════════════════════════════
//  lib/goodbye.js — CYBER X | Auto Goodbye Handler
// ════════════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_FILE = path.join(__dirname, "..", "data", "goodbye.json")
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
  "╔══「 👋 *GOODBYE* 」══╗",
  "",
  "  *{name}* has left the group. 😢",
  "",
  "  🏠 *Group :* _{group}_",
  "  👥 *Remaining :* *{count}*",
  "  📅 *Left :* {date} at {time}",
  "",
  "  _We'll miss you._ 💔",
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

async function getProfilePic(sock, jid) {
  try { return await sock.profilePictureUrl(jid, "image") }
  catch { return null }
}

async function handleGoodbye(sock, update) {
  const { id, participants, action } = update
  if (action !== "remove" && action !== "leave") return

  const cfg = readConfig()
  if (!cfg[id]?.enabled) return

  const message = cfg[id].message || DEFAULT_MSG

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
    const ppUrl  = await getProfilePic(sock, jid)

    try {
      if (ppUrl) {
        await sock.sendMessage(id, { image: { url: ppUrl }, caption: text, mentions: [jid] })
      } else {
        await sock.sendMessage(id, { text, mentions: [jid] })
      }
      console.log(`[GOODBYE] ✔ ${number} in ${id}`)
    } catch (e) {
      console.error(`[GOODBYE] ✗ ${number}:`, e.message)
    }
  }
}

module.exports = { handleGoodbye, setStore, readConfig, writeConfig, DEFAULT_MSG }
