// ═══════════════════════════════════════════════════════════════
//  lib/welcome.js — CYBER X | ⚡ Welcome & Goodbye Handler
//
//  FAST: reads group name from store (RAM), zero network calls.
//  Profile pic fetched async AFTER text is already sent.
//
//  Auto-wired via index.js — no initWelcome needed:
//    • handleGroupUpdate → called by group-participants.update
//    • setStore(store)   → called in isAdmin wiring block
// ═══════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, '../data/welcome.json')

// ── Defaults ──────────────────────────────────────────────────
const DEFAULT_WELCOME = `╔════════════════════════╗
║  👋 *WELCOME!*         ║
╚════════════════════════╝

Welcome to *{group}*, {tag}! 🎉
We're happy to have you here.
There are now *{count}* members.

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

const DEFAULT_GOODBYE = `╔════════════════════════╗
║  👋 *GOODBYE!*         ║
╚════════════════════════╝

Goodbye {tag}! 😢
We'll miss you in *{group}*.
Members remaining: *{count}*

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

// ── Storage ───────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE))
  } catch {}
  return {}
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

let DB = loadData()

function getConfig(jid) {
  return DB[jid] || {}
}

function setConfig(jid, update) {
  DB[jid] = { ...DB[jid], ...update }
  saveData(DB)
}

// ── Config helpers (used by commands) ────────────────────────
function enableWelcome(jid)       { setConfig(jid, { welcomeEnabled: true }) }
function disableWelcome(jid)      { setConfig(jid, { welcomeEnabled: false }) }
function enableGoodbye(jid)       { setConfig(jid, { goodbyeEnabled: true }) }
function disableGoodbye(jid)      { setConfig(jid, { goodbyeEnabled: false }) }
function setWelcomeMsg(jid, msg)  { setConfig(jid, { welcomeMsg: msg }) }
function setGoodbyeMsg(jid, msg)  { setConfig(jid, { goodbyeMsg: msg }) }
function resetWelcomeMsg(jid)     { setConfig(jid, { welcomeMsg: null }) }
function resetGoodbyeMsg(jid)     { setConfig(jid, { goodbyeMsg: null }) }
function getWelcomeConfig(jid)    { return getConfig(jid) }

// ── Text builder ──────────────────────────────────────────────
function buildText(template, { tag, group, count }) {
  return template
    .replace(/{tag}/g,   tag)
    .replace(/{name}/g,  tag)
    .replace(/{group}/g, group)
    .replace(/{count}/g, count)
}

// ── Store ref (set once from index.js wiring block) ───────────
let _store = null
function setStore(store) { _store = store }

// ── Main handler — auto-called by index.js ────────────────────
async function handleGroupUpdate(sock, { id, participants, action }) {
  if (action !== 'add' && action !== 'remove') return

  const config = getConfig(id)
  if (action === 'add'    && !config.welcomeEnabled) return
  if (action === 'remove' && !config.goodbyeEnabled) return

  // Read from store — instant RAM, zero network
  const meta      = _store?.groupMetadata?.[id]
  const groupName = meta?.subject || 'this group'
  const count     = meta?.participants?.length || 0
  const template  = action === 'add'
    ? (config.welcomeMsg || DEFAULT_WELCOME)
    : (config.goodbyeMsg || DEFAULT_GOODBYE)

  for (const jid of participants) {
    const tag  = `@${jid.split('@')[0]}`
    const text = buildText(template, { tag, group: groupName, count })

    // Step 1: text fires IMMEDIATELY
    sock.sendMessage(id, { text, mentions: [jid] }).catch(() => {})

    // Step 2: profile pic async — text already sent, this is bonus
    sock.profilePictureUrl(jid, 'image')
      .then(ppUrl => {
        if (!ppUrl) return
        sock.sendMessage(id, {
          image:    { url: ppUrl },
          caption:  text,
          mentions: [jid]
        }).catch(() => {})
      })
      .catch(() => {})
  }
}

module.exports = {
  handleGroupUpdate,
  setStore,
  getWelcomeConfig,
  enableWelcome,  disableWelcome,
  enableGoodbye,  disableGoodbye,
  setWelcomeMsg,  resetWelcomeMsg,
  setGoodbyeMsg,  resetGoodbyeMsg,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
}
