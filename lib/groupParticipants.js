const fs   = require("fs")
const path = require("path")

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, "..", "data")
const DATA_FILE = path.join(DATA_DIR, "groupParticipants.json")

const FALLBACK_WELCOME_IMG = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const FALLBACK_GOODBYE_IMG = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

const DEFAULT_WELCOME =
  "👋 Welcome {user} to *{group}*!\n\nYou're member #{count}. Enjoy your stay! 🎉"
const DEFAULT_GOODBYE =
  "😢 *{user}* has left *{group}*.\n\nWe'll miss you. Take care! 👋"

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE — per-group config, debounced save, crash-safe flush
// (same pattern as lib/persistence.js — JSON file, debounce, exit hook)
// ─────────────────────────────────────────────────────────────────────────────
let db = {}
let saveTimer = null

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  ensureDir()
  try {
    if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || {}
  } catch (e) {
    console.error("[groupParticipants] load error:", e.message)
    db = {}
  }
}
load()

function flush() {
  try {
    ensureDir()
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
  } catch (e) {
    console.error("[groupParticipants] save error:", e.message)
  }
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 400)
}

process.on("exit", flush) // crash-safe — same hook style as the rest of the bot

// ─────────────────────────────────────────────────────────────────────────────
// PER-GROUP CONFIG
// ─────────────────────────────────────────────────────────────────────────────
function getGroupConfig(groupId) {
  if (!db[groupId]) {
    db[groupId] = {
      welcomeEnabled: false,
      welcomeMsg: DEFAULT_WELCOME,
      goodbyeEnabled: false,
      goodbyeMsg: DEFAULT_GOODBYE,
    }
    scheduleSave()
  }
  return db[groupId]
}

function setWelcome(groupId, { enabled, msg } = {}) {
  const cfg = getGroupConfig(groupId)
  if (typeof enabled === "boolean") cfg.welcomeEnabled = enabled
  if (typeof msg === "string" && msg.trim()) cfg.welcomeMsg = msg.trim()
  scheduleSave()
  return cfg
}

function setGoodbye(groupId, { enabled, msg } = {}) {
  const cfg = getGroupConfig(groupId)
  if (typeof enabled === "boolean") cfg.goodbyeEnabled = enabled
  if (typeof msg === "string" && msg.trim()) cfg.goodbyeMsg = msg.trim()
  scheduleSave()
  return cfg
}

function resetWelcome(groupId) {
  const cfg = getGroupConfig(groupId)
  cfg.welcomeMsg = DEFAULT_WELCOME
  scheduleSave()
  return cfg
}

function resetGoodbye(groupId) {
  const cfg = getGroupConfig(groupId)
  cfg.goodbyeMsg = DEFAULT_GOODBYE
  scheduleSave()
  return cfg
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP METADATA CACHE — reuses index.js's state.groupCache via setStore()
// so we avoid an extra groupMetadata() call on every single join/leave.
// This is the function index.js's FIX #2 comment is wiring up.
// ─────────────────────────────────────────────────────────────────────────────
let storeRef = null
function setStore(groupCache) {
  storeRef = groupCache
}

async function getGroupMeta(sock, groupId) {
  const cached = storeRef && storeRef[groupId]
  if (cached && Date.now() - (cached._cachedAt || 0) < 5 * 60 * 1000) return cached
  try {
    const meta = await sock.groupMetadata(groupId)
    if (storeRef) storeRef[groupId] = { ...meta, _cachedAt: Date.now() }
    return meta
  } catch (e) {
    console.error("[groupParticipants] groupMetadata fetch failed:", e.message)
    return cached || null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

function applyPlaceholders(template, { userTag, userNum, group, count, desc }) {
  return template
    .replace(/\{user\}/g, userTag)
    .replace(/\{number\}/g, userNum)
    .replace(/\{group\}/g, group)
    .replace(/\{count\}/g, String(count))
    .replace(/\{desc\}/g, desc || "No description")
}

// Try the user's OWN profile picture. Returns null on any failure
// (private privacy setting, no picture set, network error, etc).
async function fetchProfilePic(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, "image")
    if (url) return url
  } catch {
    // expected for users with privacy-locked or missing pfps
  }
  return null
}

// Send order: user's own pfp -> fallback image -> plain text.
// "both could not get profile picture" = own pic failed AND the
// fallback image itself failed to send -> we drop to text-only.
async function sendCard(sock, groupId, jid, template, fallbackImg, extra) {
  const text = applyPlaceholders(template, extra)
  const ownPic   = await fetchProfilePic(sock, jid)
  const imageUrl = ownPic || fallbackImg

  try {
    await sock.sendMessage(groupId, {
      image: { url: imageUrl },
      caption: text,
      mentions: [jid],
    })
  } catch (e) {
    console.error("[groupParticipants] image send failed, using plain text:", e.message)
    try {
      await sock.sendMessage(groupId, { text, mentions: [jid] })
    } catch (e2) {
      console.error("[groupParticipants] text fallback also failed:", e2.message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — called from index.js's group-participants.update listener
// ─────────────────────────────────────────────────────────────────────────────
async function handleGroupUpdate(sock, update) {
  try {
    const { id: groupId, participants, action } = update || {}
    if (!groupId || !Array.isArray(participants) || !participants.length) return
    if (action !== "add" && action !== "remove") return // ignore promote/demote

    const cfg = getGroupConfig(groupId)
    if (action === "add"    && !cfg.welcomeEnabled) return
    if (action === "remove" && !cfg.goodbyeEnabled) return

    const meta  = await getGroupMeta(sock, groupId)
    const group = meta?.subject || "this group"
    const desc  = meta?.desc || ""
    const count = meta?.participants?.length || participants.length

    const botNum = normalizeNum(sock.user?.id || "")

    for (const jid of participants) {
      if (normalizeNum(jid) === botNum) continue // bot itself joined/left — skip

      const userNum = normalizeNum(jid)
      const extra = { userTag: `@${userNum}`, userNum, group, count, desc }

      if (action === "add") {
        await sendCard(sock, groupId, jid, cfg.welcomeMsg, FALLBACK_WELCOME_IMG, extra)
      } else {
        await sendCard(sock, groupId, jid, cfg.goodbyeMsg, FALLBACK_GOODBYE_IMG, extra)
      }
      await sleep(600) // small gap so mass join/leave doesn't trip rate limits
    }
  } catch (e) {
    console.error("[groupParticipants] handleGroupUpdate error:", e.message)
  }
}

module.exports = {
  handleGroupUpdate,
  setStore,
  getGroupConfig,
  setWelcome,
  setGoodbye,
  resetWelcome,
  resetGoodbye,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
  FALLBACK_WELCOME_IMG,
  FALLBACK_GOODBYE_IMG,
}
