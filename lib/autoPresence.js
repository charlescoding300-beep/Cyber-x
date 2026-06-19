// lib/autoPresence.js  —  CYBER X
// ─────────────────────────────────────────────────────────────────────────────
// ALL automatic presence features — fires on every incoming message.
// Each session (each linked WhatsApp number) has its OWN settings so
// one person's autoTyping never affects another person's session.
//
// Features handled here:
//   autoTyping      → shows "typing..."        in the chat
//   autoRecording   → shows "recording audio..." in the chat
//   alwaysOnline    → keeps presence as "available" at all times
//   autoRead        → marks every message as read instantly (blue ticks)
//   autoViewStatus  → auto-views incoming WhatsApp statuses
//   autoReactStatus → auto-reacts to statuses with configured emoji
//
// Called from messages.upsert in index.js — before handleMessage().
// ─────────────────────────────────────────────────────────────────────────────

"use strict"

/**
 * @param {object} sock      — Baileys socket for THIS session
 * @param {object} m         — raw message from messages.upsert
 * @param {object} settings  — state.settings = settingsLib.forUser(phone)
 *                             already per-session, reads user file first
 *                             then falls back to global store
 */
async function autoPresence(sock, m, settings) {
  const jid = m?.key?.remoteJid
  if (!jid) return

  const isStatus = jid === "status@broadcast"

  // ── Pull this session's own settings ──────────────────────────────────────
  const autoTyping     = settings.get("autoTyping")
  const autoRecording  = settings.get("autoRecording")
  const alwaysOnline   = settings.get("alwaysOnline")
  const autoRead       = settings.get("autoRead")
  const autoViewStatus = settings.get("autoViewStatus")
  const autoReactStatus= settings.get("autoReactStatus")
  const reactEmoji     = settings.get("statusReactEmoji") || "🔥"

  // ── STATUS MESSAGES — handled separately ──────────────────────────────────
  if (isStatus) {
    // Auto view status
    if (autoViewStatus) {
      sock.readMessages([m.key]).catch(() => {})
    }

    // Auto react to status
    if (autoReactStatus && m.key) {
      sock.sendMessage(jid, {
        react: { text: reactEmoji, key: m.key }
      }).catch(() => {})
    }

    return  // don't run chat presence on status messages
  }

  // ── REGULAR MESSAGES (DM + group) ─────────────────────────────────────────

  // Auto Read — blue ticks instantly
  if (autoRead) {
    sock.readMessages([m.key]).catch(() => {})
  }

  // Always Online — push "available" presence to this chat
  if (alwaysOnline) {
    sock.sendPresenceUpdate("available", jid).catch(() => {})
  }

  // Auto Typing — shows "typing..." — takes priority over recording
  if (autoTyping) {
    sock.sendPresenceUpdate("composing", jid).catch(() => {})
    // Auto-pause after 5s so it doesn't hang forever
    setTimeout(() => {
      sock.sendPresenceUpdate("paused", jid).catch(() => {})
    }, 5000)
    return  // don't show recording if typing is already showing
  }

  // Auto Recording — shows "recording audio..."
  if (autoRecording) {
    sock.sendPresenceUpdate("recording", jid).catch(() => {})
    setTimeout(() => {
      sock.sendPresenceUpdate("paused", jid).catch(() => {})
    }, 5000)
  }
}

module.exports = { autoPresence }
