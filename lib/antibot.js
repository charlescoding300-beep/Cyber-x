// ═══════════════════════════════════════════════════════════════
// lib/antibot.js — ZENX ANTIBOT ENGINE v2 (behavior-based)
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

const userDb = require("./userDb")
const adminLib = require("./isAdmin")
const { sendBotNotAdmin } = require('./groupAdminNotice')

const MAX_WARNINGS = 3
const SCORE_THRESHOLD    = 3
const SCORE_WINDOW_MS    = 5 * 60 * 1000   // 5 min rolling window
const SPEED_WINDOW_MS    = 2 * 1000        // 3+ msgs in 2s = suspicious
const SPEED_MSG_COUNT    = 3
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000  // same text in 2+ groups within 5 min
const MAX_TRACKED_MESSAGES_PER_SENDER = 500

// ─────────────────────────────────────────────────────────
// IN-MEMORY TRACKING (per JID) — resets on restart, that's fine,
// this is short-window behavioral tracking, not long-term storage
// ─────────────────────────────────────────────────────────
const recentMessages = new Map()   // jid -> [{ ts, text, groupId }, ...]
const scoreCache     = new Map()   // jid -> { score, lastUpdated }

function normalizeNum(raw = "") {
  return raw.replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "").trim()
}

// Match sender/admin identities without treating an opaque LID as a phone
// number. Baileys may identify the same participant by a device-qualified JID,
// a LID, or a phone number, depending on the event and metadata cache.
function normalizeJid(raw = "") {
  const value = String(raw || "").trim().toLowerCase()
  const at = value.lastIndexOf("@")
  if (at < 1) return ""
  const local = value.slice(0, at).replace(/:\d+$/, "")
  const domain = value.slice(at + 1)
  return local && domain ? `${local}@${domain}` : ""
}

function phoneDigits(raw = "") {
  let value = String(raw || "").trim()
  const at = value.lastIndexOf("@")
  if (at >= 0) {
    const domain = value.slice(at + 1).toLowerCase()
    if (domain !== "s.whatsapp.net" && domain !== "c.us") return ""
    value = value.slice(0, at).replace(/:\d+$/, "")
  }
  const digits = value.replace(/\D/g, "")
  return digits.length >= 7 ? digits : ""
}

function participantMatches(participant, target) {
  if (!participant || !target) return false
  const targetJid = normalizeJid(target)
  if (!targetJid) return false

  const participantJids = [participant.id, participant.jid, participant.lid]
    .map(normalizeJid)
    .filter(Boolean)
  if (participantJids.includes(targetJid)) return true

  const targetPhone = phoneDigits(target)
  if (!targetPhone) return false
  return [participant.phoneNumber, participant.id, participant.jid]
    .map(phoneDigits)
    .filter(Boolean)
    .includes(targetPhone)
}

function getGroupState(phone, jid) {
  if (!phone || !jid) return { mode: "off", exemptJids: [], warnings: {} }
  try {
    const section = userDb.getSection(phone, "antibot") || { groups: {} }
    return section.groups?.[jid] || { mode: "off", exemptJids: [], warnings: {} }
  } catch (e) {
    console.error("[ANTIBOT] state load failed:", e.message)
    return { mode: "off", exemptJids: [], warnings: {} }
  }
}

function setGroupState(phone, jid, patch) {
  if (!phone || !jid) return null
  const section = userDb.getSection(phone, "antibot") || { groups: {} }
  const groups = { ...(section.groups || {}) }
  groups[jid] = {
    mode: "off",
    exemptJids: [],
    warnings: {},
    ...(groups[jid] || {}),
    ...patch,
  }
  userDb.setSection(phone, "antibot", { ...section, groups })
  return groups[jid]
}

function getMode(jid, phone) { return getGroupState(phone, jid).mode || "off" }
function setMode(jid, mode, phone) { return setGroupState(phone, jid, { mode }) }

function addWarning(phone, jid, sender) {
  const state = getGroupState(phone, jid)
  const warnings = { ...(state.warnings || {}) }
  const aliases = new Set(adminLib.identityKeys(sender))
  const key = Object.keys(warnings).find(stored =>
    adminLib.identityKeys(stored).some(identity => aliases.has(identity))
  ) || adminLib.normalizeJid(sender) || normalizeNum(sender)
  if (!key) return 0
  warnings[key] = (warnings[key] || 0) + 1
  setGroupState(phone, jid, { warnings })
  return warnings[key]
}

function resetWarnings(phone, jid, sender) {
  const state = getGroupState(phone, jid)
  const warnings = { ...(state.warnings || {}) }
  const aliases = new Set(adminLib.identityKeys(sender))
  let changed = false
  for (const stored of Object.keys(warnings)) {
    if (adminLib.identityKeys(stored).some(identity => aliases.has(identity))) {
      delete warnings[stored]
      changed = true
    }
  }
  if (changed) setGroupState(phone, jid, { warnings })
  return changed
}

// ─────────────────────────────────────────────────────────
// BEHAVIORAL SCORING
// ─────────────────────────────────────────────────────────
function trackMessage(senderNorm, text, groupId) {
  const now = Date.now()
  if (!recentMessages.has(senderNorm)) recentMessages.set(senderNorm, [])
  const history = recentMessages.get(senderNorm)

  history.push({ ts: now, text: text || "", groupId })

  // Prune in one splice instead of repeated shift() calls, then bound each
  // sender's rolling history so a very active account cannot create unbounded
  // per-message scoring work across the shared event loop.
  const cutoff = now - Math.max(SCORE_WINDOW_MS, DUPLICATE_WINDOW_MS)
  let firstLive = 0
  while (firstLive < history.length && history[firstLive].ts < cutoff) firstLive++
  if (firstLive) history.splice(0, firstLive)
  if (history.length > MAX_TRACKED_MESSAGES_PER_SENDER) {
    history.splice(0, history.length - MAX_TRACKED_MESSAGES_PER_SENDER)
  }

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

    const phone = adminLib.sessionPhoneOf(sock)
    if (!phone) return
    const state = getGroupState(phone, from)
    const mode = state.mode || "off"
    if (mode === "off") return

    const sender     = msg.key.participant || from
    const senderAlt  = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt
    const senderNorm = normalizeNum(sender)

    const selfNum = normalizeNum(sock.user?.id || "")
    if (senderNorm === selfNum) return

    const text = extractBody ? extractBody(msg) : ""
    const history = trackMessage(senderNorm, text, from)
    const { score: behaviorScore, reasons } = computeScore(senderNorm, history)

    let totalScore = behaviorScore
    const allReasons = [...reasons]

    // A speed-burst score already meets the threshold; avoid an unnecessary
    // profile request on that path. The optional weak signal is only useful
    // when local behavior is suspicious but still below threshold.
    if (totalScore > 0 && totalScore < SCORE_THRESHOLD) {
      const biz = await checkBusinessSignal(sock, sender)
      if (biz.score > 0) {
        totalScore += biz.score
        allReasons.push(biz.reason)
      }
    }

    if (totalScore < SCORE_THRESHOLD) return

    // Only fetch metadata after a local behavior signal reaches the action
    // threshold. Ordinary messages take the fast path without a network call.
    let adminContext
    try { adminContext = await adminLib.getGroupAdminContext(sock, from, sender, senderAlt, phone) } catch (e) {
      console.error("[ANTIBOT] metadata fetch failed:", e.message)
      return
    }
    if (!adminContext.available) {
      console.error(`[ANTIBOT] group roles unavailable; skipped automatic action in ${from}`)
      return
    }

    const meta = adminContext.meta
    const senderParticipant = meta.participants?.find(p => adminLib.participantMatches(p, sender, senderAlt))
    if (adminContext.senderAdmin || adminLib.isAdminParticipant(senderParticipant)) {
      // Behavioral signals can misclassify a busy human, so group admins are
      // exempt from automatic action.
      return
    }

    const exempt = (state.exemptJids || []).some(jid =>
      adminLib.participantMatches({ id: jid }, sender, senderAlt)
    )
    if (exempt) return

    const botIsAdmin = adminContext.botAdmin
    const tag = senderNorm
    const credit = "> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦"
    const panel = (title, lines) =>
      `╭───「 ${title} 」───╮\n${lines.map(line => `│ ${line}`).join("\n")}\n╰────────────────────╯`

    if (!botIsAdmin && mode !== "warn") {
      console.log(`[ANTIBOT] Suspicious activity from ${senderNorm} in ${from} (score: ${totalScore}) but I'm not admin — cannot act. Reasons: ${allReasons.join("; ")}`)
      await sendBotNotAdmin(sock, from, msg).catch(() => {})
      return
    }

    console.log(`[ANTIBOT] 🛡️ Suspicious bot-like behavior from ${senderNorm} in "${meta.subject}" — score: ${totalScore}/${SCORE_THRESHOLD} — mode: ${mode}\n  Reasons: ${allReasons.join("; ")}`)

    if (mode === "warn") {
      const warningIdentity = senderParticipant?.phoneNumber || senderParticipant?.id || sender
      const count = addWarning(phone, from, warningIdentity)
      recentMessages.delete(senderNorm)
      const notice = panel("ANTIBOT WARNING", [
        "⚠️ Bots are not allowed in this group.",
        "🤖 @" + tag + " has been warned.",
        "⚠️ Warning: " + Math.min(count, MAX_WARNINGS) + "/" + MAX_WARNINGS,
      ])
      await sock.sendMessage(from, {
        text: notice + "\n\n" + credit,
        mentions: [sender],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] warning send failed:", e.message))
      return
    }

    let deleted = false
    try {
      await sock.sendMessage(from, { delete: msg.key })
      deleted = true
    } catch (e) {
      console.error("[ANTIBOT] delete failed:", e.message)
    }
    recentMessages.delete(senderNorm)

    if (mode === "delete") {
      const title = deleted ? "ANTIBOT" : "ANTIBOT DELETE FAILED"
      const rows = deleted
        ? [`🚫 @${tag} Bots are not allowed in this group.`, "🗑️ The bot’s message was deleted."]
        : [`⚠️ @${tag} triggered suspicious automated behavior.`, "🗑️ I could not delete the message; check my admin permission."]
      await sock.sendMessage(from, {
        text: `${panel(title, rows)}\n\n${credit}`,
        mentions: [sender],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete notice failed:", e.message))
      return
    }

    if (mode === "kick") {
      let removed = false
      try {
        const result = await sock.groupParticipantsUpdate(from, [sender], "remove")
        const item = Array.isArray(result) ? result.find(entry => entry?.jid === sender) || result[0] : result
        removed = item?.status == null || (Number(item.status) >= 200 && Number(item.status) < 300)
      } catch (e) {
        console.error("[ANTIBOT] kick failed:", e.message)
      }
      const text = removed
        ? panel("BOT DETECTED", ["🤖 @" + tag + " BOT are not allowed in this group.", "👢 The bot has been removed from the group."]) + "\n\n" + credit
        : panel("BOT ACTION FAILED", ["⚠️ @" + tag + " triggered suspicious automated behavior.", "👢 I could not remove the account; check my admin permission."]) + "\n\n" + credit
      await sock.sendMessage(from, {
        text,
        mentions: [sender],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] kick notice failed:", e.message))
      if (removed) console.log(`[ANTIBOT] Removed ${senderNorm} from ${meta.subject} (score ${totalScore})`)
    }

  } catch (err) {
    console.error("[ANTIBOT]", err.message)
  }
}

module.exports = {
  handleAntibot,
  getMode,
  setMode,
  getGroupState,
  setGroupState,
  addWarning,
  resetWarnings,
}
