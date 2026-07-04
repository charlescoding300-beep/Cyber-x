// ═══════════════════════════════════════════════════════════════
// lib/antibot.js — CYBER X ANTIBOT ENGINE v2 (behavior-based)
//
// The old version detected "foreign bots" by checking message ID
// prefixes (3EB/BAE/3A). Research confirmed those are just the
// STANDARD Baileys message ID format used by every client,
// including real humans and this bot itself — not a bot signature.
// That version could never reliably work and has been removed.
//
// This version scores accounts on REAL observable behavior:
//   +3  sent 3+ messages within 2 seconds (superhuman typing speed)
//   +2  sent an identical message to 2+ different groups within 5 min
//   +1  account is a registered WhatsApp Business profile (weak signal —
//       NOT proof of being a bot, real businesses use WhatsApp too,
//       so this alone never triggers action)
//
// A score of 3+ within a 5-minute rolling window triggers the
// configured action (delete/warn/kick). Score decays after 10 min
// of inactivity. This is heuristic, not certain — no client-side
// tool can prove an account is a bot with 100% certainty, since
// WhatsApp does not expose that classification to third parties.
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
  return { groups: {}, warnings: {} }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)) }
  catch (e) { console.error("[ANTIBOT] Save error:", e.message) }
}

let store = loadData()

const MAX_WARNINGS = 3
const SCORE_THRESHOLD    = 3
const SCORE_WINDOW_MS    = 5 * 60 * 1000   // 5 min rolling window
const SPEED_WINDOW_MS    = 2 * 1000        // 3+ msgs in 2s = suspicious
const SPEED_MSG_COUNT    = 3
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000  // same text in 2+ groups within 5 min

// ─────────────────────────────────────────────────────────
// IN-MEMORY TRACKING (per JID) — resets on restart, that's fine,
// this is short-window behavioral tracking, not long-term storage
// ─────────────────────────────────────────────────────────
const recentMessages = new Map()   // jid -> [{ ts, text, groupId }, ...]
const scoreCache     = new Map()   // jid -> { score, lastUpdated }

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

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

// ─────────────────────────────────────────────────────────
// BEHAVIORAL SCORING
// ─────────────────────────────────────────────────────────
function trackMessage(senderNorm, text, groupId) {
  const now = Date.now()
  if (!recentMessages.has(senderNorm)) recentMessages.set(senderNorm, [])
  const history = recentMessages.get(senderNorm)

  history.push({ ts: now, text: text || "", groupId })

  // prune anything older than the longest window we care about
  const cutoff = now - Math.max(SCORE_WINDOW_MS, DUPLICATE_WINDOW_MS)
  while (history.length && history[0].ts < cutoff) history.shift()

  return history
}

function computeScore(senderNorm, history) {
  const now = Date.now()
  let score = 0
  const reasons = []

  // Signal 1: message speed — 3+ messages within 2 seconds
  const recent = history.filter(h => now - h.ts <= SPEED_WINDOW_MS)
  if (recent.length >= SPEED_MSG_COUNT) {
    score += 3
    reasons.push(`${recent.length} messages within ${SPEED_WINDOW_MS/1000}s (superhuman speed)`)
  }

  // Signal 2: identical text sent to 2+ different groups within 5 min
  const withinDup = history.filter(h => now - h.ts <= DUPLICATE_WINDOW_MS && h.text)
  const textGroups = new Map() // text -> Set(groupId)
  for (const h of withinDup) {
    if (!h.text || h.text.length < 8) continue // ignore trivial/short text
    if (!textGroups.has(h.text)) textGroups.set(h.text, new Set())
    textGroups.get(h.text).add(h.groupId)
  }
  for (const [text, groups] of textGroups) {
    if (groups.size >= 2) {
      score += 2
      reasons.push(`identical message sent to ${groups.size} different groups within ${DUPLICATE_WINDOW_MS/60000}min`)
      break
    }
  }

  return { score, reasons }
}

async function checkBusinessSignal(sock, senderJid) {
  try {
    const profile = await sock.getBusinessProfile(senderJid)
    if (profile && (profile.description || profile.category)) {
      return { score: 1, reason: "registered WhatsApp Business profile (weak signal)" }
    }
  } catch {}
  return { score: 0, reason: null }
}

// ─────────────────────────────────────────────────────────
// MAIN ANTIBOT HANDLER — called from index.js exactly like
// lib.handleAntilink(sock, msg, extractBody)
// ─────────────────────────────────────────────────────────
async function handleAntibot(sock, msg, extractBody) {
  try {
    if (!msg?.message) return

    const from = msg.key.remoteJid
    if (!from?.endsWith("@g.us")) return
    if (msg.key.fromMe) return

    const mode = getMode(from)
    if (mode === "off") return

    const sender     = msg.key.participant || from
    const senderNorm = normalizeNum(sender)

    const selfNum = normalizeNum(sock.user?.id || "")
    if (senderNorm === selfNum) return

    let meta
    try { meta = await sock.groupMetadata(from) } catch (e) {
      console.error("[ANTIBOT] metadata fetch failed:", e.message)
      return
    }

    const senderParticipant = meta.participants?.find(p => normalizeNum(p.id) === senderNorm)
    if (senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin") {
      // NOTE: unlike the old version, admins ARE skipped here. Behavioral
      // scoring on a trusted admin account risks false-positive kicks —
      // if you want zero exceptions, remove this block, but be aware
      // heuristic scoring is not 100% certain and could misfire on an
      // admin having a busy moment (pasting several quick messages, etc).
      return
    }

    const text = extractBody ? extractBody(msg) : ""
    const history = trackMessage(senderNorm, text, from)
    const { score: behaviorScore, reasons } = computeScore(senderNorm, history)

    let totalScore = behaviorScore
    const allReasons = [...reasons]

    if (totalScore > 0) {
      const biz = await checkBusinessSignal(sock, sender)
      if (biz.score > 0) {
        totalScore += biz.score
        allReasons.push(biz.reason)
      }
    }

    if (totalScore < SCORE_THRESHOLD) return

    const botJid  = sock.user?.id
    const botNorm = normalizeNum(botJid || "")
    const botParticipant = meta.participants?.find(p => normalizeNum(p.id) === botNorm)
    const botIsAdmin = botParticipant?.admin === "admin" || botParticipant?.admin === "superadmin"

    if (!botIsAdmin) {
      console.log(`[ANTIBOT] Suspicious activity from ${senderNorm} in ${from} (score: ${totalScore}) but I'm not admin — cannot act. Reasons: ${allReasons.join("; ")}`)
      return
    }

    console.log(`[ANTIBOT] 🛡️ Suspicious bot-like behavior from ${senderNorm} in "${meta.subject}" — score: ${totalScore}/${SCORE_THRESHOLD} — mode: ${mode}\n  Reasons: ${allReasons.join("; ")}`)

    try {
      await sock.sendMessage(from, { delete: msg.key })
    } catch (e) {
      console.error("[ANTIBOT] delete failed:", e.message)
    }

    // Reset tracking for this sender so we don't re-trigger on the same burst
    recentMessages.delete(senderNorm)

    if (mode === "delete") return

    if (mode === "kick") {
      try {
        await sock.groupParticipantsUpdate(from, [sender], "remove")
        await sock.sendMessage(from, {
          text: `✅ *Suspicious Bot-Like Account Removed*\n\n👤 User: @${senderNorm}\n📋 Reason: ${allReasons.join(", ")}\n\n_Note: this is a behavioral heuristic, not a certainty — WhatsApp doesn't expose bot classification to third-party tools._\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
          mentions: [sender]
        })
        console.log(`[ANTIBOT] Kicked ${senderNorm} from ${meta.subject} (score ${totalScore})`)
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
            text: `⚠️ *Final Warning Reached (${count}/${MAX_WARNINGS})*\n\n👤 User: @${senderNorm}\nRemoving automatically.\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
            mentions: [sender]
          })
          await sock.groupParticipantsUpdate(from, [sender], "remove")
          resetWarnings(from, senderNorm)
        } catch (e) {
          console.error("[ANTIBOT] warn-kick failed:", e.message)
        }
      } else {
        try {
          await sock.sendMessage(from, {
            text: `⚠️ *Suspicious Activity Warning (${count}/${MAX_WARNINGS})*\n\n👤 User: @${senderNorm}\n📋 Reason: ${allReasons.join(", ")}\n${MAX_WARNINGS - count} more and this account is auto-removed.\n\n> © 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`,
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
}
