// commands/autotag.js
// ─────────────────────────────────────────────────────────────────────────────
// AUTOTAG — silently mentions EVERY member (admins + super admins included)
// on every message the session owner / bot sends in a group.
//
//   .autotag on      → enable for ALL groups (current + any group joined later)
//   .autotag off     → disable
//   .autotag status  → show state
//
// HOW IT WORKS (two layers, both attached per-socket via autoTagAttach):
//
//  1) OUTGOING WRAPPER — sock.sendMessage is wrapped. Any message the bot
//     sends to a group (command replies, images, stickers, audio, videos,
//     documents, locations, contacts, polls...) gets the full member list
//     injected as hidden mentions BEFORE it is sent. One send, no edits.
//
//  2) OWN-MESSAGE WATCHER — when YOU type/send something in a group from
//     your phone (e.g. "hi guys"), the bot catches it and adds the hidden
//     mentions to that same message:
//        • text / image / video / document → EDITED in place (single message)
//        • sticker / audio / voice / contact / location (WhatsApp can't edit
//          these) → re-sent with mentions, original deleted
//
// Mentions have no visible @text, so nobody sees anything — they just get
// pinged. Member list is read from the live group cache, so new members are
// included automatically, and new groups work with no setup.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs")
const path = require("path")

const BRAND         = "> © Charles Tech"
const FLAG_KEY      = "autotag"
const DATA_DIR      = path.join(__dirname, "..", "data", "autotag")
const META_TTL_MS   = 10 * 60 * 1000   // refetch group metadata if cache older than this
const META_TIMEOUT  = 5000             // max wait for a groupMetadata fetch
const MAX_AGE_SEC   = 60               // ignore own messages older than this (history sync)
const EDIT_DELAY_MS = 400              // lets the wrapper mark its own sends first
const HANDLED_MAX   = 3000

try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}

// ── tiny helpers ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms))

function normalizePhone(raw = "") {
  return String(raw).replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "")
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ])
}

// ids of messages we've already dealt with (bot-sent or already tagged)
const handled  = new Set()
const inFlight = new Set()
function markHandled(id) {
  if (!id) return
  handled.add(id)
  while (handled.size > HANDLED_MAX) handled.delete(handled.values().next().value)
}

// ── ON/OFF FLAG (per session; settings system first, JSON file as mirror) ────
const fileCache = new Map()

function flagFile(phone) {
  return path.join(DATA_DIR, `${phone || "unknown"}.json`)
}

function readFileFlag(phone) {
  if (fileCache.has(phone)) return fileCache.get(phone)
  let v = false
  try {
    const f = flagFile(phone)
    if (fs.existsSync(f)) v = !!JSON.parse(fs.readFileSync(f, "utf8")).enabled
  } catch {}
  fileCache.set(phone, v)
  return v
}

function readFlag(state) {
  try {
    const v = state.settings?.get?.(FLAG_KEY)
    if (typeof v === "boolean") return v
  } catch {}
  return readFileFlag(state.phone)
}

function writeFlag(state, enabled) {
  try { state.settings?.set?.(FLAG_KEY, enabled) } catch (e) {
    console.error(`[AUTOTAG:${state.phone}] settings.set failed:`, e.message)
  }
  fileCache.set(state.phone, enabled)
  try { fs.writeFileSync(flagFile(state.phone), JSON.stringify({ enabled }, null, 2)) } catch (e) {
    console.error(`[AUTOTAG:${state.phone}] file save failed:`, e.message)
  }
}

// ── MEMBER LIST ──────────────────────────────────────────────────────────────
// Returns every participant JID (members + admins + superadmins).
async function getMentions(state, sock, groupJid) {
  let meta = state.groupCache?.[groupJid]
  const fresh = meta?.participants?.length && (Date.now() - (meta._cachedAt || 0)) < META_TTL_MS
  if (!fresh) {
    try {
      const live = await withTimeout(sock.groupMetadata(groupJid), META_TIMEOUT)
      meta = { ...live, _cachedAt: Date.now() }
      if (state.groupCache) state.groupCache[groupJid] = meta
    } catch (e) {
      // fall back to stale cache if we have one
      if (!meta?.participants?.length) {
        console.warn(`[AUTOTAG:${state.phone}] no member list for ${groupJid}: ${e.message}`)
      }
    }
  }
  return [...new Set((meta?.participants || []).map(p => p.id).filter(Boolean))]
}

function mergeMentions(existing, all) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...all])]
}

// ── MESSAGE INSPECTION ───────────────────────────────────────────────────────
const WRAP_SKIP_KEYS = ["react", "delete", "edit", "forward", "pin", "disappearingMessagesInChat"]

function hasSkipKey(content) {
  return WRAP_SKIP_KEYS.some(k => k in content)
}

const IGNORE_TYPES = new Set([
  "protocolMessage", "reactionMessage", "encReactionMessage", "pollUpdateMessage",
  "editedMessage", "keepInChatMessage", "senderKeyDistributionMessage",
  "messageContextInfo", "call", "bcallMessage", "requestPhoneNumberMessage",
])

function unwrap(message) {
  if (!message) return null
  if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return null // leave view-once alone
  let m = message
  for (let i = 0; i < 3; i++) {
    const next = m.ephemeralMessage?.message || m.documentWithCaptionMessage?.message
    if (!next) break
    m = next
  }
  return m
}

function pickType(inner) {
  return Object.keys(inner).find(k => !IGNORE_TYPES.has(k) && inner[k] !== null && inner[k] !== undefined)
}

function bodyOf(inner) {
  return inner.conversation ||
         inner.extendedTextMessage?.text ||
         inner.imageMessage?.caption ||
         inner.videoMessage?.caption ||
         inner.documentMessage?.caption || ""
}

const EDITABLE_MEDIA = new Set(["imageMessage", "videoMessage", "documentMessage"])

// ── OWN MESSAGE → ADD MENTIONS ───────────────────────────────────────────────
async function processOwnMessage(state, sock, origSend, m) {
  if (!m?.message || !m.key?.id || !m.key.fromMe) return
  const jid = m.key.remoteJid
  if (!jid || !jid.endsWith("@g.us")) return
  if (!readFlag(state)) return

  const ts = Number(m.messageTimestamp) || 0
  if (ts && Date.now() / 1000 - ts > MAX_AGE_SEC) return

  const id = m.key.id
  if (handled.has(id) || inFlight.has(id)) return

  const inner = unwrap(m.message)
  if (!inner) return
  const typeKey = pickType(inner)
  if (!typeKey) return

  // typed bot commands (".menu" etc.) — the bot's reply gets tagged instead
  const prefix = state.settings?.get?.("prefix") || process.env.BOT_PREFIX || "."
  if (bodyOf(inner).startsWith(prefix)) return

  inFlight.add(id)
  try {
    // give the sendMessage wrapper time to mark its own sends
    await sleep(EDIT_DELAY_MS)
    if (handled.has(id)) return

    const all = await getMentions(state, sock, jid)
    if (!all.length) return

    const orig     = inner[typeKey]
    const origCtx  = typeKey === "conversation" ? {} : (orig?.contextInfo || {})
    const have     = new Set(origCtx.mentionedJid || [])
    if (all.every(j => have.has(j))) return // already tags everyone

    const contextInfo = { ...origCtx, mentionedJid: mergeMentions(origCtx.mentionedJid, all) }

    // the message body with mentions attached
    let payload
    if (typeKey === "conversation") {
      payload = { extendedTextMessage: { text: orig, contextInfo } }
    } else {
      payload = { [typeKey]: { ...orig, contextInfo } }
    }

    const canEdit = typeKey === "conversation" || typeKey === "extendedTextMessage" || EDITABLE_MEDIA.has(typeKey)

    if (canEdit) {
      try {
        await sock.relayMessage(jid, {
          protocolMessage: {
            key: m.key,
            type: 14, // MESSAGE_EDIT
            editedMessage: payload,
            timestampMs: Date.now(),
          },
        }, { additionalAttributes: { edit: "1" } })
        console.log(`[AUTOTAG:${state.phone}] ✏️ edited ${typeKey} in ${jid} → ${all.length} tagged`)
        return
      } catch (e) {
        console.warn(`[AUTOTAG:${state.phone}] edit failed (${e.message}) — falling back to resend`)
      }
    }

    // Non-editable types (sticker, audio, voice, contact, location...) or edit failure:
    // relay the SAME media (no re-download/upload) with mentions, then delete the original.
    await sock.relayMessage(jid, payload, {})
    try { await origSend(jid, { delete: m.key }) } catch (e) {
      console.warn(`[AUTOTAG:${state.phone}] could not delete original ${typeKey}: ${e.message}`)
    }
    console.log(`[AUTOTAG:${state.phone}] 🔁 resent ${typeKey} in ${jid} → ${all.length} tagged`)
  } finally {
    markHandled(id)
    inFlight.delete(id)
  }
}

// ── ATTACH TO A SOCKET (called from startBot in index.js) ────────────────────
function autoTagAttach(state, sock) {
  if (!sock || sock.__autoTagAttached) return
  sock.__autoTagAttached = true
  sock.__autoTagState    = state

  const origSend = sock.sendMessage.bind(sock)
  sock.__origSendMessage = origSend

  // Layer 1 — outgoing wrapper
  sock.sendMessage = async (jid, content, options) => {
    const isGroup = typeof jid === "string" && jid.endsWith("@g.us")
    if (isGroup && content && typeof content === "object") {
      try {
        if (readFlag(state) && !content.noTag && !hasSkipKey(content)) {
          const all = await getMentions(state, sock, jid)
          if (all.length) content = { ...content, mentions: mergeMentions(content.mentions, all) }
        }
      } catch (e) {
        console.error(`[AUTOTAG:${state.phone}] wrapper error:`, e.message)
      }
    }
    const sent = await origSend(jid, content, options)
    if (isGroup && sent?.key?.id) markHandled(sent.key.id)
    return sent
  }

  // Layer 2 — messages you send yourself from your phone
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return
    for (const m of messages) {
      processOwnMessage(state, sock, origSend, m).catch(e =>
        console.error(`[AUTOTAG:${state.phone}] ERR:`, e.message)
      )
    }
  })

  console.log(`[AUTOTAG:${state.phone}] ✔ attached (currently ${readFlag(state) ? "ON" : "OFF"})`)
}

// ── THE COMMAND ──────────────────────────────────────────────────────────────
module.exports = {
  pattern:  "autotag",
  alias:    [],
  category: "group",
  desc:     "Silently tag every member on every message you/the bot send in groups",
  usage:    ".autotag on | off | status",

  run: async ({ sock, from, msg, args, isOwner, settings }) => {
    // noTag:true → this reply itself never pings the group
    const reply = text => sock.sendMessage(from, { text, noTag: true }, { quoted: msg })

    if (!isOwner) return reply("❌ *Owner only command.*")

    // state is stashed on the socket by autoTagAttach
    const state = sock.__autoTagState || { phone: normalizePhone(sock.user?.id), settings, groupCache: {} }
    const sub = (args[0] || "status").toLowerCase()

    if (sub === "on") {
      writeFlag(state, true)
      return reply(
        `╭━━━〔 🔥 AUTO TAG 〕━━━╮\n┃\n┃ 🟢 *Status:* ON\n┃ 👥 Every member gets tagged silently\n┃ 🌍 Applies to ALL groups (new ones too)\n┃\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n${BRAND}`
      )
    }

    if (sub === "off") {
      writeFlag(state, false)
      return reply(
        `╭━━━〔 🔥 AUTO TAG 〕━━━╮\n┃\n┃ 🔴 *Status:* OFF\n┃ Messages will no longer tag members\n┃\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n${BRAND}`
      )
    }

    if (sub === "status") {
      const on = readFlag(state)
      const groups = Object.keys(state.groupCache || {}).filter(j => j.endsWith("@g.us")).length
      return reply(
        `╭━━━〔 🔥 AUTO TAG 〕━━━╮\n┃\n┃ ${on ? "🟢 *Status:* ON" : "🔴 *Status:* OFF"}\n┃ 👥 Groups loaded: ${groups}\n┃\n┃ 🟢 .autotag on\n┃ 🔴 .autotag off\n┃ ℹ️ .autotag status\n┃\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n${BRAND}`
      )
    }

    return reply("ℹ️ Usage: *.autotag on* | *.autotag off* | *.autotag status*")
  },

  // exported with the autoTag* prefix so it doesn't collide on the shared lib object
  autoTagAttach,
}
