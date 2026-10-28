// ═══════════════════════════════════════════════════════════════
// lib/antibot.js — ZENX ANTIBOT ENGINE v2 (behavior-based)
//
// The old version detected "foreign bots" by checking message ID
// prefixes (3EB/BAE/3A). Research confirmed those are just the
// STANDARD Baileys message ID format used by every client,
// including real humans and this bot itself — not a bot signature.
// That version could never reliably work and has been removed.
//
// This version scores local message behavior: two rapid messages, repeated
// identical content, or the same content posted across groups can trigger the
// configured action. Detection is a heuristic; WhatsApp does not expose a
// reliable bot-account flag to group clients.
// ═══════════════════════════════════════════════════════════════

const userDb = require("./userDb")
const adminLib = require("./isAdmin")
const { sendBotNotAdmin } = require('./groupAdminNotice')
const { getParticipantMention, deleteGroupMessage } = require('./groupModeration')

const MAX_WARNINGS = 3
const pendingWarnKicks = new Set()
const SCORE_THRESHOLD    = 2
const SCORE_WINDOW_MS    = 5 * 60 * 1000   // 5 min rolling window
const SPEED_WINDOW_MS    = 2 * 1000        // 2+ msgs in 2s = suspicious
const SPEED_MSG_COUNT    = 2
const SAME_GROUP_REPEAT_COUNT = 2
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

async function removeGroupParticipant(sock, groupJid, participant, label) {
  try {
    const result = await sock.groupParticipantsUpdate(groupJid, [participant], 'remove')
    const entries = Array.isArray(result) ? result : result ? [result] : []
    const item = entries.find(entry =>
      [entry?.jid, entry?.id].some(id => id && adminLib.participantMatches({ id }, participant))
    ) || (entries.length === 1 ? entries[0] : null)
    if (!item) return false
    if (item.status == null) return true
    const status = Number(item.status)
    return Number.isFinite(status) && status >= 200 && status < 300
  } catch (error) {
    console.error('[ANTIBOT] ' + label + ' failed:', error.message)
    return false
  }
}
// ─────────────────────────────────────────────────────────
// BEHAVIORAL SCORING
// ─────────────────────────────────────────────────────────
function trackMessage(senderKey, text, groupId, messageKey) {
  const now = Date.now()
  if (!recentMessages.has(senderKey)) recentMessages.set(senderKey, [])
  const history = recentMessages.get(senderKey)

  history.push({ ts: now, text: text || "", groupId, key: messageKey ? { ...messageKey } : null })

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

function computeScore(history, groupId) {
  const now = Date.now()
  let score = 0
  const reasons = []

  // Signal 1: message speed — 3+ messages within 2 seconds
  const recent = history.filter(h => h.groupId === groupId && now - h.ts <= SPEED_WINDOW_MS)
  if (recent.length >= SPEED_MSG_COUNT) {
    score += 3
    reasons.push(`${recent.length} messages within ${SPEED_WINDOW_MS/1000}s (superhuman speed)`)
  }

  // Signal 2: repeated identical content, either in this group or across groups.
  const withinDup = history.filter(h => now - h.ts <= DUPLICATE_WINDOW_MS && h.text)
  const textGroups = new Map() // text -> Set(groupId)
  const sameGroupCounts = new Map() // text -> count in this group
  for (const h of withinDup) {
    if (!h.text || h.text.length < 8) continue // ignore trivial/short text
    if (!textGroups.has(h.text)) textGroups.set(h.text, new Set())
    textGroups.get(h.text).add(h.groupId)
    if (h.groupId === groupId) sameGroupCounts.set(h.text, (sameGroupCounts.get(h.text) || 0) + 1)
  }
  for (const [text, groups] of textGroups) {
    if (groups.size >= 2) {
      score += 2
      reasons.push(`identical message sent to ${groups.size} different groups within ${DUPLICATE_WINDOW_MS/60000}min`)
      break
    }
  }

  for (const [text, count] of sameGroupCounts) {
    if (count >= SAME_GROUP_REPEAT_COUNT) {
      score += 2
      reasons.push(`same message repeated ${count} times in this group`)
      break
    }
  }

  return { score, reasons }
}

function relatedRecentMessages(history, current, currentText) {
  const now = Date.now()
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedText = normalize(currentText)
  return history.filter(item => {
    if (item.groupId !== current.key?.remoteJid || !item.key?.id || item.key.id === current.key?.id) return false
    const recentBurst = now - item.ts <= SPEED_WINDOW_MS
    const repeated = normalizedText.length >= 8 && normalize(item.text) === normalizedText
    return recentBurst || repeated
  })
}

async function deleteRelatedMessages(sock, history, current, text, sender) {
  for (const item of relatedRecentMessages(history, current, text)) {
    const result = await deleteGroupMessage(sock, { key: item.key }, sender)
    if (!result.deleted) {
      console.error('[ANTIBOT] earlier detected message delete failed:', result.error?.message || result.error)
    }
  }
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

    const senderAlt  = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt
    const sender     = msg.key.participant || senderAlt || from
    const senderNorm = normalizeNum(senderAlt || sender)

    const selfNum = normalizeNum(sock.user?.id || "")
    if (senderNorm === selfNum) return

    const text = extractBody ? extractBody(msg) : ""
    const senderKey = `${phone}:${senderNorm}`
    const history = trackMessage(senderKey, text, from, msg.key)
    const { score: totalScore, reasons: allReasons } = computeScore(history, from)

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
    const mention = getParticipantMention(meta.participants, sender, senderAlt)
    const tag = mention.tag || senderNorm
    const mentionJid = mention.jid || sender
    const participantTarget = senderParticipant?.id || senderParticipant?.jid || sender
    const credit = "> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦"
    const panel = (title, lines) =>
      `╭───「 ${title} 」───╮\n${lines.map(line => `│ ${line}`).join("\n")}\n╰────────────────────╯`

    if (!botIsAdmin) {
      console.log(`[ANTIBOT] Suspicious activity from ${senderNorm} in ${from} (score: ${totalScore}) but I'm not admin — cannot act. Reasons: ${allReasons.join("; ")}`)
      await sendBotNotAdmin(sock, from, msg).catch(() => {})
      return
    }

    console.log(`[ANTIBOT] 🛡️ Suspicious bot-like behavior from ${senderNorm} in "${meta.subject}" — score: ${totalScore}/${SCORE_THRESHOLD} — mode: ${mode}\n  Reasons: ${allReasons.join("; ")}`)

    if (mode === "warn") {
      const warningIdentity = senderParticipant?.phoneNumber || senderParticipant?.id || sender
      const count = addWarning(phone, from, warningIdentity)
      if (count >= MAX_WARNINGS) {
        const kickKey = phone + ':' + from + ':' + (adminLib.normalizeJid(participantTarget) || senderNorm)
        if (pendingWarnKicks.has(kickKey)) return
        pendingWarnKicks.add(kickKey)
        try {
          const deletion = await deleteGroupMessage(sock, msg, sender)
          if (!deletion.deleted) {
            console.error("[ANTIBOT] final-warning message delete failed:", deletion.error?.message || deletion.error)
            const failedNotice = panel("ANTIBOT ACTION FAILED", ["⚠️ I could not delete this detected message.", "The member was not removed; check my admin permission."])
            await sock.sendMessage(from, {
              text: failedNotice,
              mentions: [mentionJid],
            }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete failure notice failed:", e.message))
            return
          }
          await deleteRelatedMessages(sock, history, msg, text, sender)
          const removed = await removeGroupParticipant(sock, from, participantTarget, "warn-limit kick")
          const notice = removed
            ? `*🤖 @${tag} 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝚁𝙾𝙼 𝚃𝙷𝙴 𝙶𝚁𝙾𝚄𝙿.*`
            : panel("BOT ACTION FAILED", ["⚠️ Warning limit reached: " + MAX_WARNINGS + "/" + MAX_WARNINGS + ".", "👢 @" + tag + " could not be removed; check that I am a group admin."])
          await sock.sendMessage(from, {
            text: notice + (removed ? '' : "\n\n" + credit),
            mentions: [mentionJid],
          }, { quoted: msg }).catch(e => console.error("[ANTIBOT] final-warning notice failed:", e.message))
          if (removed) console.log("[ANTIBOT] Removed " + senderNorm + " after " + MAX_WARNINGS + " warnings in " + meta.subject)
        } finally {
          pendingWarnKicks.delete(kickKey)
        }
        return
      }

      const deletion = await deleteGroupMessage(sock, msg, sender)
      if (!deletion.deleted) {
        console.error("[ANTIBOT] warning-mode delete failed:", deletion.error?.message || deletion.error)
      } else {
        await deleteRelatedMessages(sock, history, msg, text, sender)
      }
      recentMessages.delete(senderKey)
      const notice = `*⚠️ @${tag} 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚆𝙰𝚁𝙽𝙸𝙽𝙶: ${count}/${MAX_WARNINGS}*`
      await sock.sendMessage(from, {
        text: notice,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] warning send failed:", e.message))
      return
    }
    const deletion = await deleteGroupMessage(sock, msg, sender)
    const deleted = deletion.deleted
    if (!deleted) console.error("[ANTIBOT] delete failed:", deletion.error?.message || deletion.error)
    if (!deleted) {
      const failureText = panel("ANTIBOT ACTION FAILED", ["⚠️ I could not delete the detected message.", "No kick was attempted; check my admin permission."])
      await sock.sendMessage(from, {
        text: failureText,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete failure notice failed:", e.message))
      recentMessages.delete(senderKey)
      return
    }
    await deleteRelatedMessages(sock, history, msg, text, sender)
    recentMessages.delete(senderKey)

    if (mode === "delete") {
      const title = deleted ? "ANTIBOT" : "ANTIBOT DELETE FAILED"
      const rows = deleted
        ? [`🚫 @${tag} Bots are not allowed in this group.`, "🗑️ The bot’s message was deleted."]
        : [`⚠️ @${tag} triggered suspicious automated behavior.`, "🗑️ I could not delete the message; check my admin permission."]
      await sock.sendMessage(from, {
        text: deleted
          ? `*🤖 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— @${tag} 𝙸𝚂 𝙽𝙾𝚃 𝙰𝙻𝙻𝙾𝚆𝙴𝙳.*`
          : `${panel(title, rows)}\n\n${credit}`,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete notice failed:", e.message))
      return
    }

    if (mode === "kick") {
      const removed = await removeGroupParticipant(sock, from, participantTarget, "immediate kick")
      const text = removed
        ? `*🤖 @${tag} 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝚁𝙾𝙼 𝚃𝙷𝙴 𝙶𝚁𝙾𝚄𝙿.*`
        : panel("BOT ACTION FAILED", ["⚠️ @" + tag + " triggered suspicious automated behavior.", "👢 I could not remove the account; check my admin permission."]) + "\n\n" + credit
      await sock.sendMessage(from, {
        text,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] kick notice failed:", e.message))
      if (removed) console.log("[ANTIBOT] Removed " + senderNorm + " from " + meta.subject + " (score " + totalScore + ")")
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
