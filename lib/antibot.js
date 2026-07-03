// ═══════════════════════════════════════════════════════════════
// lib/antibot.js — CYBER X ANTIBOT ENGINE
// Detects foreign Baileys-style bot message IDs and takes action
// (kick/delete/warn) regardless of sender role. Only messages whose
// ID ends in "CYBERX" (this bot's own send-tag) are exempt.
// Auto-loaded by index.js's LIB_DIR loader — same pattern as
// lib/antilink.js. Persists per-group config to data/antibot.json,
// survives Render restarts.
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")

const DATA_DIR  = path.join(__dirname, "..", "data")
const DATA_FILE = path.join(DATA_DIR, "antibot.json")

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE))
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
  } catch {}
  return { groups: {}, warnings: {}, notifiedNotAdmin: {} }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)) }
  catch (e) { console.error("[ANTIBOT] Save error:", e.message) }
}

let store = loadData()

// ─────────────────────────────────────────────────────────
// STATE MANAGEMENT
// ─────────────────────────────────────────────────────────
const MAX_WARNINGS = 3
const NOTADMIN_COOLDOWN_MS = 10 * 60 * 1000

function getMode(jid)              { return store.groups[jid]?.mode || "off" }
function setMode(jid, mode) {
  if (!store.groups[jid]) store.groups[jid] = {}
  store.groups[jid].mode = mode
  saveData()
}

function addWarning(jid, sender) {
  if (!store.warnings[jid])         store.warnings[jid] = {}
  if (!store.warnings[jid][sender]) store.warnings[jid][sender] = 0
  store.warnings[jid][sender]++
  saveData()
  return store.warnings[jid][sender]
}
function resetWarnings(jid, sender) {
  if (store.warnings[jid]?.[sender] !== undefined) {
    store.warnings[jid][sender] = 0
    saveData()
  }
}

function hasNotifiedNotAdmin(jid) {
  const last = store.notifiedNotAdmin[jid]
  return last && (Date.now() - last) < NOTADMIN_COOLDOWN_MS
}
function markNotifiedNotAdmin(jid) {
  store.notifiedNotAdmin[jid] = Date.now()
  saveData()
}

// ─────────────────────────────────────────────────────────
// BAILEYS-STYLE MESSAGE ID PATTERNS
// ─────────────────────────────────────────────────────────
const BAILEYS_ID_PATTERNS = [
  /^3EB[0-9A-F]+/i,
  /^BAE[0-9A-F]+/i,
  /^3A[0-9A-F]+/i,
]

function isBaileysMessageId(messageId) {
  if (!messageId) return false
  return BAILEYS_ID_PATTERNS.some(p => p.test(messageId))
}

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// ─────────────────────────────────────────────────────────
// MAIN ANTIBOT HANDLER — called from index.js exactly like
// handleAntilink(sock, msg, extractBody)
// ─────────────────────────────────────────────────────────
async function handleAntibot(sock, msg, extractBody) {
  try {
    if (!msg?.message) return

    const from = msg.key.remoteJid
    if (!from?.endsWith("@g.us")) return
    if (msg.key.fromMe) return

    const mode = getMode(from)
    if (mode === "off") return

    const messageId = msg.key.id
    if (!isBaileysMessageId(messageId)) return

    // ── ONLY exemption: message ID tagged by this bot's own send
    // logic. Role (member/admin/superadmin/owner) is NEVER checked —
    // detection acts on everyone except messages proven to be ours. ──
    if (messageId.endsWith("CYBERX")) return

    const sender     = msg.key.participant || from
    const senderNorm = normalizeNum(sender)

    let meta
    try { meta = await sock.groupMetadata(from) } catch (e) {
      console.error("[ANTIBOT] metadata fetch failed:", e.message)
      return
    }

    const botJid  = sock.user?.id
    const botNorm = normalizeNum(botJid || "")
    const botParticipant = meta.participants?.find(p => normalizeNum(p.id) === botNorm)
    const botIsAdmin = botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin"

    if (!botIsAdmin) {
      console.log(`[ANTIBOT] Detected foreign bot ${senderNorm} in ${from} but I'm not admin — cannot act`)
      if (!hasNotifiedNotAdmin(from)) {
        markNotifiedNotAdmin(from)
        try {
          await sock.sendMessage(from, {
            text: `⚠️ *Anti-Bot Alert*\n\nDetected a foreign bot account in this group, but I'm not an admin so I can't take action.\n\n👉 Please make me an admin to enable protection.\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
          })
        } catch (e) {
          console.error("[ANTIBOT] notAdmin notify failed:", e.message)
        }
      }
      return
    }

    const targetParticipant = meta.participants?.find(p => normalizeNum(p.id) === senderNorm)
    const targetRole = targetParticipant?.admin === "superadmin" ? "SUPER ADMIN"
      : targetParticipant?.admin === "admin" ? "ADMIN"
      : "MEMBER"

    console.log(`[ANTIBOT] 🛡️ Detected FOREIGN bot from ${senderNorm} (role: ${targetRole}) in "${meta.subject}" — mode: ${mode}`)

    try {
      await sock.sendMessage(from, { delete: msg.key })
    } catch (e) {
      console.error("[ANTIBOT] delete failed:", e.message)
    }

    if (mode === "delete") return

    if (mode === "kick") {
      try {
        await sock.groupParticipantsUpdate(from, [sender], "remove")
        await sock.sendMessage(from, {
          text: `✅ *Foreign Bot Removed*\n\n👤 User: @${senderNorm}\n🏷️ Role: ${targetRole}\n📋 Reason: Detected as unauthorized foreign bot account\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
          mentions: [sender]
        })
        console.log(`[ANTIBOT] Kicked foreign bot ${senderNorm} (${targetRole}) from ${meta.subject}`)
      } catch (e) {
        console.error("[ANTIBOT] kick failed:", e.message)
      }
      return
    }

    if (mode === "warn") {
      const count = addWarning(from, senderNorm)

      if (count >= MAX_WARNINGS) {
        try {
          await sock.sendMessage(from, {
            text: `⚠️ *Final Warning Reached (${count}/${MAX_WARNINGS})*\n\n👤 User: @${senderNorm}\n🏷️ Role: ${targetRole}\nRemoving automatically.\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
            mentions: [sender]
          })
          await sock.groupParticipantsUpdate(from, [sender], "remove")
          resetWarnings(from, senderNorm)
          console.log(`[ANTIBOT] Auto-kicked foreign bot ${senderNorm} (${targetRole}) after ${count} warnings`)
        } catch (e) {
          console.error("[ANTIBOT] warn-kick failed:", e.message)
        }
      } else {
        try {
          await sock.sendMessage(from, {
            text: `⚠️ *Foreign Bot Warning (${count}/${MAX_WARNINGS})*\n\n👤 User: @${senderNorm}\n🏷️ Role: ${targetRole}\nReason: Suspicious bot-pattern message detected & deleted.\n${MAX_WARNINGS - count} more and this account is auto-removed — role doesn't matter.\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
            mentions: [sender]
          })
        } catch (e) {
          console.error("[ANTIBOT] warn message failed:", e.message)
        }
      }
    }

  } catch (err) {
    console.error("[ANTIBOT]", err.message)
  }
}

module.exports = {
  handleAntibot,
  getMode,
  setMode,
  isBaileysMessageId,
}
