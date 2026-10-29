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
//   +3  sent 3+ messages within 2 seconds, or 5+ within 5 seconds
//   +2  repeated identical content in one group, or sent it across groups
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
const aiBotDetector = require('./aiBotDetector')
const { ocrMessageText } = require('./antilink')
const { getParticipantMention, deleteGroupMessage } = require('./groupModeration')

const MAX_WARNINGS = 3
const pendingWarnKicks = new Set()
const SCORE_THRESHOLD    = 2
const SCORE_WINDOW_MS    = 5 * 60 * 1000   // 5 min rolling window
const SPEED_WINDOW_MS    = 2 * 1000
const SPEED_MSG_COUNT    = 2
const VOLUME_WINDOW_MS   = 5 * 1000
const VOLUME_MSG_COUNT   = 5
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000
const SAME_GROUP_REPEAT_COUNT = 2
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
const TEXT_FIELDS = new Set([
  'conversation', 'text', 'caption', 'title', 'description', 'body',
  'selectedDisplayText', 'selectedButtonId', 'selectedId',
])
const SKIP_DEEP_FIELDS = new Set(['contextInfo', 'quotedMessage', 'messageContextInfo'])
const FORMAT_CHAR_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g
const CONFUSABLES = new Map(Object.entries({
  'а':'a','ɑ':'a','α':'a','е':'e','ё':'e','ε':'e','ο':'o','о':'o','р':'p','ρ':'p',
  'с':'c','ϲ':'c','х':'x','χ':'x','і':'i','ι':'i','у':'y','ყ':'y','к':'k','κ':'k',
  'м':'m','μ':'m','т':'t','τ':'t','в':'b','Ь':'b','н':'h','һ':'h','ј':'j','ո':'n',
}))

function deepMessageText(message) {
  const parts = []
  const seen = new Set()
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_DEEP_FIELDS.has(key)) continue
      if (typeof child === 'string' && TEXT_FIELDS.has(key)) {
        if (child.trim()) parts.push(child.slice(0, 4096))
      } else if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }
  visit(message, 0)
  return parts.join('\n').slice(0, 12000)
}

function analyzeDetectionText(raw) {
  const value = String(raw || '').normalize('NFKC')
  const formatChars = value.match(FORMAT_CHAR_RE) || []
  const stripped = value.replace(FORMAT_CHAR_RE, '').toLowerCase()
  let confusableCount = 0
  let letterCount = 0
  let normalized = ''
  for (const char of stripped) {
    if (/\p{L}/u.test(char)) letterCount++
    const replacement = CONFUSABLES.get(char)
    if (replacement) {
      confusableCount++
      normalized += replacement
    } else normalized += char
  }
  normalized = normalized.replace(/\s+/g, ' ').trim()
  const unicodeSuspicious = formatChars.length >= 2 ||
    (confusableCount >= 4 && letterCount > 0 && confusableCount / letterCount >= 0.18)
  return { normalized, unicodeSuspicious }
}

function trackMessage(senderKey, text, groupId, messageKey) {
  const now = Date.now()
  if (!recentMessages.has(senderKey)) recentMessages.set(senderKey, [])
  const history = recentMessages.get(senderKey)

  const analysis = analyzeDetectionText(text)
  history.push({
    ts: now,
    text: analysis.normalized.slice(0, 4096),
    unicodeSuspicious: analysis.unicodeSuspicious,
    groupId,
    key: messageKey ? { ...messageKey } : null,
  })

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

function computeScore(senderKey, history, groupId) {
  const now = Date.now()
  let score = 0
  const reasons = []
  const recent = history.filter(h => h.groupId === groupId && now - h.ts <= SPEED_WINDOW_MS)
  const volume = history.filter(h => now - h.ts <= VOLUME_WINDOW_MS)
  if (recent.length >= SPEED_MSG_COUNT) {
    score += 3
    reasons.push(recent.length + ' messages within ' + (SPEED_WINDOW_MS / 1000) + 's')
  } else if (volume.length >= VOLUME_MSG_COUNT) {
    score += 3
    reasons.push(volume.length + ' messages within ' + (VOLUME_WINDOW_MS / 1000) + 's')
  }

  // Repeated text is a second signal, but never triggers action by itself.
  const unicodeObfuscation = history.some(h =>
    h.unicodeSuspicious && now - h.ts <= DUPLICATE_WINDOW_MS
  )
  if (unicodeObfuscation) {
    score += 1
    reasons.push('hidden formatting or mixed-script lookalikes in repeated text')
  }

  const withinDup = history.filter(h => now - h.ts <= DUPLICATE_WINDOW_MS && h.text)
  const textStats = new Map()
  for (const h of withinDup) {
    const text = String(h.text).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
    if (text.length < 8 || text.length > 4096) continue
    let stats = textStats.get(text)
    if (!stats) {
      stats = { groups: new Set(), groupCounts: new Map() }
      textStats.set(text, stats)
    }
    stats.groups.add(h.groupId)
    stats.groupCounts.set(h.groupId, (stats.groupCounts.get(h.groupId) || 0) + 1)
  }
  let crossGroupRepeat = false
  let sameGroupRepeat = false
  for (const stats of textStats.values()) {
    if (stats.groups.size >= 2) { crossGroupRepeat = true; break }
  }
  for (const stats of textStats.values()) {
    if ([...stats.groupCounts.values()].some(count => count >= SAME_GROUP_REPEAT_COUNT)) {
      sameGroupRepeat = true
      break
    }
  }
  if (crossGroupRepeat) {
    score += 2
    reasons.push('identical content sent to multiple groups within ' + (DUPLICATE_WINDOW_MS / 60000) + 'min')
  }
  if (sameGroupRepeat) {
    score += 2
    reasons.push('identical content repeated ' + SAME_GROUP_REPEAT_COUNT + '+ times in one group')
  }
  return { score, reasons }
}

function relatedRecentMessages(history, current, currentText) {
  const now = Date.now()
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedText = normalize(currentText)
  return history.filter(item => {
    if (item.groupId !== current.key?.remoteJid || !item.key?.id || item.key.id === current.key?.id) return false
    return now - item.ts <= SPEED_WINDOW_MS || (normalizedText.length >= 8 && normalize(item.text) === normalizedText)
  })
}

async function deleteRelatedMessages(sock, history, current, text, sender) {
  for (const item of relatedRecentMessages(history, current, text)) {
    const result = await deleteGroupMessage(sock, { key: item.key }, sender)
    if (!result.deleted) console.error('[ANTIBOT] earlier detected message delete failed:', result.error?.message || result.error)
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
    const aiMode = "enforce"

    const senderAlt  = msg.key.participantPn || msg.key.participantAlt || msg.participantPn || msg.participantAlt
    const sender     = msg.key.participant || senderAlt || from
    if (!sender || sender === from) return
    const senderNorm = normalizeNum(senderAlt || sender)
    if (!senderNorm) return

    const selfNum = normalizeNum(sock.user?.id || "")
    if (senderNorm === selfNum) return

    const bodyText = extractBody ? extractBody(msg) : ""
    const deepText = deepMessageText(msg.message)
    const text = [bodyText, deepText].filter(Boolean).join("\n").slice(0, 12000)
    const senderKey = phone + ':' + senderNorm
    const history = trackMessage(senderKey, text, from, msg.key)
    const { score: totalScore, reasons: allReasons } = computeScore(senderKey, history, from)
    const behaviorTriggered = mode !== "off" && totalScore >= SCORE_THRESHOLD
    let aiTriggered = false
    let aiResult = null
    let adminContext = null

    // Every active anti-bot mode runs AI scoring automatically. Eligible text
    // and OCR text are checked asynchronously through the existing listener.
    if (aiMode === "review" || aiMode === "enforce") {
      let aiText = text
      const ocrText = await ocrMessageText(sock, msg)
      if (ocrText) aiText = [aiText, ocrText].filter(Boolean).join("\n").slice(0, 8000)
      if (aiBotDetector.wordCount(aiText) >= aiBotDetector.MIN_WORDS) {
        try {
          adminContext = await adminLib.getGroupAdminContext(sock, from, sender, senderAlt, phone)
        } catch (e) {
          adminContext = { available: false }
          console.error("[ANTIBOT] metadata fetch failed:", e.message)
        }
        if (adminContext.available) {
          const aiParticipant = adminContext.meta?.participants?.find(p => adminLib.participantMatches(p, sender, senderAlt))
          const aiSenderAdmin = adminContext.senderAdmin || adminLib.isAdminParticipant(aiParticipant)
          const aiExempt = (state.exemptJids || []).some(jid => adminLib.participantMatches({ id: jid }, sender, senderAlt))
          if (!aiSenderAdmin && !aiExempt && adminContext.botAdmin) {
            aiResult = await aiBotDetector.classify(aiText)
            if (aiResult.status === "scored" && aiResult.review) {
              await aiBotDetector.logReview({
                session: phone,
                group: from,
                sender,
                messageId: msg.key.id,
                score: aiResult.score,
                gemini: aiResult.gemini,
                grok: aiResult.grok,
                action: aiMode === "enforce" && aiResult.enforce ? "enforce" : "review",
                text: aiText,
              })
            }
            aiTriggered = mode !== "off" && aiMode === "enforce" && aiResult.enforce === true
            if (aiTriggered) allReasons.push(`AI-text consensus ${aiResult.score.toFixed(2)}`)
          }
        }
      }
    }

    if (!behaviorTriggered && !aiTriggered) return

    // Ordinary messages retain the fast path: group metadata is fetched only
    // after a behavior signal or an enforced, high-confidence AI-text verdict.
    if (!adminContext) {
      try { adminContext = await adminLib.getGroupAdminContext(sock, from, sender, senderAlt, phone) } catch (e) {
        console.error("[ANTIBOT] metadata fetch failed:", e.message)
        return
      }
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

    const deletion = await deleteGroupMessage(sock, msg, sender)
    if (!deletion.deleted) {
      recentMessages.delete(senderKey)
      console.error("[ANTIBOT] delete failed; stopping action:", deletion.error?.message || deletion.error)
      const failureText =
        "╭───「 ANTIBOT ACTION FAILED 」───╮\n" +
        "│ ⚠️ I could not delete the detected message.\n" +
        "│ Check that I am a group admin, then try again.\n" +
        "╰───────────────────────────────╯"
      await sock.sendMessage(from, {
        text: failureText,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete failure notice failed:", e.message))
      return
    }
    if (behaviorTriggered) await deleteRelatedMessages(sock, history, msg, text, sender)
    recentMessages.delete(senderKey)

    if (mode === "warn") {
      const warningIdentity = senderParticipant?.phoneNumber || senderParticipant?.id || sender
      const count = addWarning(phone, from, warningIdentity)

      if (count >= MAX_WARNINGS) {
        const kickKey = phone + ':' + from + ':' + (adminLib.normalizeJid(participantTarget) || senderNorm)
        if (pendingWarnKicks.has(kickKey)) return
        pendingWarnKicks.add(kickKey)
        try {
          const removed = await removeGroupParticipant(sock, from, participantTarget, "warn-limit kick")
          const notice = removed
            ? `*🤖 @${tag} 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝚁𝙾𝙼 𝚃𝙷𝙴 𝙶𝚁𝙾𝚄𝙿.*`
            : panel("BOT ACTION FAILED", ["⚠️ Warning limit reached: " + MAX_WARNINGS + "/" + MAX_WARNINGS + ".", "👢 @" + tag + " could not be removed; check that I am a group admin."])
          await sock.sendMessage(from, {
            text: notice + (removed ? '' : "\n\n" + credit),
            mentions: [mentionJid],
          }, { quoted: msg }).catch(e => console.error("[ANTIBOT] final-warning notice failed:", e.message))
          if (removed) console.log("[ANTIBOT] Removed " + senderNorm + " after " + count + " warnings in " + meta.subject)
        } finally {
          pendingWarnKicks.delete(kickKey)
        }
        return
      }

      const notice = "*⚠️ @" + tag + " 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚆𝙰𝚁𝙽𝙸𝙽𝙶: " + count + "/" + MAX_WARNINGS + "*"
      await sock.sendMessage(from, {
        text: notice,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] warning send failed:", e.message))
      return
    }

    if (mode === "delete") {
      const notice = "*🤖 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— @" + tag + " 𝙸𝚂 𝙽𝙾𝚃 𝙰𝙻𝙻𝙾𝚆𝙴𝙳.*"
      await sock.sendMessage(from, {
        text: notice,
        mentions: [mentionJid],
      }, { quoted: msg }).catch(e => console.error("[ANTIBOT] delete notice failed:", e.message))
      return
    }

    if (mode === "kick") {
      const removed = await removeGroupParticipant(sock, from, participantTarget, "immediate kick")
      const notice = removed
        ? `*🤖 @${tag} 𝙱𝙾𝚃 𝙳𝙴𝚃𝙴𝙲𝚃𝙴𝙳.*\n*— 𝚁𝙴𝙼𝙾𝚅𝙴𝙳 𝙵𝚁𝙾𝙼 𝚃𝙷𝙴 𝙶𝚁𝙾𝚄𝙿.*`
        : panel("BOT ACTION FAILED", ["⚠️ @" + tag + " triggered suspicious automated behavior.", "👢 I could not remove the account; check my admin permission."]) + "\n\n" + credit
      await sock.sendMessage(from, {
        text: notice,
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
