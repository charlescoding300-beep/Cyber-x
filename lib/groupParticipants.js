const welcomeDb = require("./welcomeDb")

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_WELCOME_IMG = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const FALLBACK_GOODBYE_IMG = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

const DEFAULT_WELCOME =
  "👋 Welcome {user} to *{group}*!\n\nYou're member #{count}. Enjoy your stay! 🎉"
const DEFAULT_GOODBYE =
  "😢 *{user}* has left *{group}*.\n\nWe'll miss you. Take care! 👋"

// ─────────────────────────────────────────────────────────────────────────────
// PER-GROUP CONFIG — now reads/writes through welcomeDb.js, your existing
// storage layer (data/welcome/<groupId>.json). No second JSON store anymore.
// Keys match what welcomeDb.js's own header comment documents:
//   welcome / welcomeText / goodbye / goodbyeText
// ─────────────────────────────────────────────────────────────────────────────
function getGroupConfig(groupId) {
  return {
    welcomeEnabled: welcomeDb.get(groupId, "welcome", false),
    welcomeMsg:     welcomeDb.get(groupId, "welcomeText", DEFAULT_WELCOME),
    goodbyeEnabled: welcomeDb.get(groupId, "goodbye", false),
    goodbyeMsg:     welcomeDb.get(groupId, "goodbyeText", DEFAULT_GOODBYE),
  }
}

function setWelcome(groupId, { enabled, msg } = {}) {
  if (typeof enabled === "boolean") welcomeDb.set(groupId, "welcome", enabled)
  if (typeof msg === "string" && msg.trim()) welcomeDb.set(groupId, "welcomeText", msg.trim())
  return getGroupConfig(groupId)
}

function setGoodbye(groupId, { enabled, msg } = {}) {
  if (typeof enabled === "boolean") welcomeDb.set(groupId, "goodbye", enabled)
  if (typeof msg === "string" && msg.trim()) welcomeDb.set(groupId, "goodbyeText", msg.trim())
  return getGroupConfig(groupId)
}

function resetWelcome(groupId) {
  welcomeDb.set(groupId, "welcomeText", DEFAULT_WELCOME)
  return getGroupConfig(groupId)
}

function resetGoodbye(groupId) {
  welcomeDb.set(groupId, "goodbyeText", DEFAULT_GOODBYE)
  return getGroupConfig(groupId)
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP METADATA CACHE — reuses index.js's state.groupCache via setStore()
// ─────────────────────────────────────────────────────────────────────────────
let storeRef = null
function setStore(groupCache) {
  storeRef = groupCache
  console.log("[groupParticipants] ✔ setStore wired up")
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

async function fetchProfilePic(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, "image")
    if (url) return url
  } catch {
    // private pfp, no pfp, or fetch error — caller falls back
  }
  return null
}

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
    console.log(`[groupParticipants] ✔ sent card for ${jid} (${ownPic ? "own pfp" : "fallback img"})`)
  } catch (e) {
    console.error("[groupParticipants] image send failed, using plain text:", e.message)
    try {
      await sock.sendMessage(groupId, { text, mentions: [jid] })
      console.log(`[groupParticipants] ✔ sent text-only fallback for ${jid}`)
    } catch (e2) {
      console.error("[groupParticipants] text fallback also failed:", e2.message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY — called from index.js's group-participants.update listener
// ─────────────────────────────────────────────────────────────────────────────
async function handleGroupUpdate(sock, update) {
  console.log("[groupParticipants] ▶ event received:", JSON.stringify(update))
  try {
    const { id: groupId, participants, action } = update || {}
    if (!groupId || !Array.isArray(participants) || !participants.length) {
      console.log("[groupParticipants] ✗ bailing: missing groupId/participants")
      return
    }
    if (action !== "add" && action !== "remove") {
      console.log(`[groupParticipants] ✗ bailing: action="${action}" not add/remove`)
      return
    }

    const cfg = getGroupConfig(groupId)
    console.log(`[groupParticipants] cfg for ${groupId}:`, cfg)

    if (action === "add" && !cfg.welcomeEnabled) {
      console.log("[groupParticipants] ✗ bailing: welcome disabled for this group")
      return
    }
    if (action === "remove" && !cfg.goodbyeEnabled) {
      console.log("[groupParticipants] ✗ bailing: goodbye disabled for this group")
      return
    }

    const meta  = await getGroupMeta(sock, groupId)
    const group = meta?.subject || "this group"
    const desc  = meta?.desc || ""
    const count = meta?.participants?.length || participants.length

    const botNum = normalizeNum(sock.user?.id || "")

    for (const jid of participants) {
      if (normalizeNum(jid) === botNum) {
        console.log("[groupParticipants] skip: bot's own jid")
        continue
      }

      const userNum = normalizeNum(jid)
      const extra = { userTag: `@${userNum}`, userNum, group, count, desc }

      if (action === "add") {
        await sendCard(sock, groupId, jid, cfg.welcomeMsg, FALLBACK_WELCOME_IMG, extra)
      } else {
        await sendCard(sock, groupId, jid, cfg.goodbyeMsg, FALLBACK_GOODBYE_IMG, extra)
      }
      await sleep(600)
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
