// ─────────────────────────────────────────────────────────────────────────────
// lib/autoFeatures.js  —  CYBER X
//
// Handles ALL auto-features WITHOUT touching index.js:
//   • autoTyping     → 5 s typing presence on non-command DM/group messages
//   • autoRecording  → 5 s recording presence on non-command messages
//   • autoReply      → auto-reply text to non-command DMs
//   • autoViewStatus → view every contact's status update
//   • autoReactStatus→ react to every status viewed
//   • alwaysOnline   → keep bot presence = "available"
//   • private mode   → block non-owner commands (enforced in handleMessage hook)
//
// Auto-loaded by index.js lib loader.
// handleMemory is already called by index.js for EVERY message — we piggyback.
// ─────────────────────────────────────────────────────────────────────────────

let _sock = null

// ── Called by index.js: lib.setSocket(sock) ──────────────────────────────────
function setSocket(sock) {
  _sock = sock
  _attachStatusListener(sock)
  _startOnlineLoop(sock)
  console.log("[AUTO] ✔ autoFeatures wired")
}

// ── Status viewer / reactor ───────────────────────────────────────────────────
function _attachStatusListener(sock) {
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) {
      if (m.key.remoteJid !== "status@broadcast") continue
      _handleStatus(sock, m)
    }
  })
}

async function _handleStatus(sock, m) {
  const settings = require("./settings")
  if (settings.get("autoViewStatus")) {
    try {
      await sock.readMessages([m.key])
    } catch {}
  }
  if (settings.get("autoReactStatus")) {
    try {
      const emoji = settings.get("statusReactEmoji") || "🔥"
      await sock.sendMessage(m.key.remoteJid, {
        react: { text: emoji, key: m.key }
      })
    } catch {}
  }
}

// ── Always-online loop ────────────────────────────────────────────────────────
let _onlineInterval = null
function _startOnlineLoop(sock) {
  clearInterval(_onlineInterval)
  _onlineInterval = setInterval(async () => {
    const settings = require("./settings")
    if (!settings.get("alwaysOnline")) return
    try {
      await sock.sendPresenceUpdate("available")
    } catch {}
  }, 20000)   // every 20 s
}

// ─────────────────────────────────────────────────────────────────────────────
// handleMemory — index.js calls this for EVERY message automatically
// We use it to run auto-typing, auto-recording, auto-reply
// ─────────────────────────────────────────────────────────────────────────────
async function handleMemory(sock, msg, extractBody) {
  if (!msg?.message) return
  if (msg.key.remoteJid === "status@broadcast") return
  if (msg.key.fromMe) return

  const settings = require("./settings")
  const body     = extractBody(msg)
  const from     = msg.key.remoteJid
  const prefix   = settings.get("prefix") || "."

  // Commands fire instantly — DO NOT apply auto-typing to them
  const isCommand = body.startsWith(prefix)
  if (isCommand) return   // ← EXIT EARLY for commands, zero delay

  // ── Auto Read ──────────────────────────────────────────────────────────────
  if (settings.get("autoRead")) {
    try { await sock.readMessages([msg.key]) } catch {}
  }

  // ── Auto Typing (non-command messages only) ────────────────────────────────
  if (settings.get("autoTyping")) {
    try {
      await sock.sendPresenceUpdate("composing", from)
      setTimeout(async () => {
        try { await sock.sendPresenceUpdate("paused", from) } catch {}
      }, 5000)
    } catch {}
  }

  // ── Auto Recording (non-command messages only) ─────────────────────────────
  if (settings.get("autoRecording")) {
    try {
      await sock.sendPresenceUpdate("recording", from)
      setTimeout(async () => {
        try { await sock.sendPresenceUpdate("paused", from) } catch {}
      }, 5000)
    } catch {}
  }

  // ── Auto Reply (DM only, non-command) ─────────────────────────────────────
  const isDM = !from.endsWith("@g.us")
  if (isDM && settings.get("autoReply") && body) {
    const replyText = (settings.get("autoReplyText") || "Hey! Type {prefix}menu.")
      .replace("{prefix}", prefix)
      .replace("{botName}", settings.get("botName") || "CYBER X")
    try {
      await sock.sendMessage(from, { text: replyText })
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// isPrivateBlocked — call this in command runner to enforce private mode
// index.js doesn't need to change; the settings command uses lib.isPrivateBlocked
// ─────────────────────────────────────────────────────────────────────────────
function isPrivateBlocked(sender, settings) {
  if (settings.get("mode") !== "private") return false
  const ownerBase = (settings.get("owner") || "").replace(/\D/g, "")
  if (!ownerBase) return false
  return !(
    sender === ownerBase ||
    sender.startsWith(`${ownerBase}@`) ||
    sender.indexOf(ownerBase) !== -1
  )
}

module.exports = {
  setSocket,
  handleMemory,
  isPrivateBlocked,
}
