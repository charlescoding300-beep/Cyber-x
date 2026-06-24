/**
 * CYBER X — commands/antidelete.js
 * Category: owner — only owner can toggle
 *
 * ✅ Persistent state (data/antidelete.json) — survives Render restarts, defaults OFF
 * ✅ In-memory message cache — caches every incoming msg for recovery
 * ✅ Supports: text, image, video, gif, voice, audio, sticker, document
 * ✅ Shows who deleted it (name + number) + where + original time
 * ✅ Exports handleAntidelete + handleAntideleteUpdate → auto-merged onto lib by loadFile()
 */

const fs   = require("fs")
const path = require("path")

// ─── Persistent on/off state (survives restarts, defaults to OFF) ────────────
const STATE_FILE = path.join(__dirname, "../data/antidelete.json")

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
      return { enabled: parsed.enabled === true }   // strict — defaults OFF if file is corrupt
    }
  } catch {}
  return { enabled: false }
}

function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: s.enabled }, null, 2))
  } catch (e) {
    console.error("[antidelete] saveState failed:", e.message)
  }
}

// Load on boot — this runs once when the file is first require()'d
const adState = loadState()
console.log(`[antidelete] Loaded — enabled: ${adState.enabled}`)

// ─── In-memory message cache (last 1000 msgs across all chats) ───────────────
// key = message id  →  value = { from, sender, pushName, timestamp, type, ... }
const msgCache = new Map()
const MAX_CACHE = 1000

function cacheMsg(msg) {
  if (!msg?.message) return

  const m  = msg.message
  const id = msg.key?.id
  if (!id) return

  let type = null, content = null, caption = null, mimetype = null

  if (m.conversation || m.extendedTextMessage) {
    type    = "text"
    content = m.conversation || m.extendedTextMessage?.text || ""

  } else if (m.imageMessage) {
    type    = "image"
    caption = m.imageMessage.caption || ""
    mimetype = m.imageMessage.mimetype || "image/jpeg"

  } else if (m.videoMessage) {
    type    = m.videoMessage.gifPlayback ? "gif" : "video"
    caption = m.videoMessage.caption || ""
    mimetype = m.videoMessage.mimetype || "video/mp4"

  } else if (m.audioMessage) {
    type    = m.audioMessage.ptt ? "voice" : "audio"
    mimetype = m.audioMessage.mimetype || "audio/ogg; codecs=opus"

  } else if (m.stickerMessage) {
    type    = "sticker"
    mimetype = m.stickerMessage.mimetype || "image/webp"

  } else if (m.documentMessage) {
    type    = "document"
    caption = m.documentMessage.caption || ""
    mimetype = m.documentMessage.mimetype || "application/octet-stream"
    content = m.documentMessage.fileName || "file"

  } else {
    return  // unsupported type (reaction, poll, etc.) — skip
  }

  // Evict oldest entry if cache is full
  if (msgCache.size >= MAX_CACHE) {
    msgCache.delete(msgCache.keys().next().value)
  }

  msgCache.set(id, {
    from:        msg.key.remoteJid,
    sender:      msg.key.participant || msg.key.remoteJid,
    pushName:    msg.pushName || "Unknown",
    timestamp:   msg.messageTimestamp,
    type, content, caption, mimetype,
    originalMsg: msg,   // keep full msg object for downloadMediaMessage
  })
}

// ─── handleAntidelete — caches every incoming message ────────────────────────
// Called from index.js messages.upsert → lib.handleAntidelete(sock, msg)
async function handleAntidelete(sock, msg) {
  cacheMsg(msg)
}

// ─── handleAntideleteUpdate — detects deletes, forwards to owner ─────────────
// Called from index.js messages.update → lib.handleAntideleteUpdate(sock, updates, ownerJid)
async function handleAntideleteUpdate(sock, updates, ownerJid) {
  if (!adState.enabled) return
  if (!ownerJid) return

  for (const update of updates) {
    // WhatsApp delete = protocolMessage type REVOKE (0)
    const proto = update.update?.message?.protocolMessage
    if (!proto) continue
    if (proto.type !== 0 && proto.type !== "REVOKE") continue

    const deletedId = proto.key?.id
    if (!deletedId) continue

    const cached = msgCache.get(deletedId)
    if (!cached) continue   // message not in our cache (bot wasn't running when it was sent)

    const { from, sender, pushName, type, content, caption, mimetype, timestamp, originalMsg } = cached

    const isGroup   = from?.endsWith("@g.us")
    const senderNum = sender.replace(/[^0-9]/g, "")
    const timeStr   = new Date(Number(timestamp) * 1000).toLocaleString("en-GB")
    const chatLabel = isGroup
      ? `Group (${from.replace("@g.us", "")})`
      : `Private DM`

    const header =
      `╔══════════════════════════╗\n` +
      `║   🗑️  *ANTI-DELETE LOG*   ║\n` +
      `╚══════════════════════════╝\n\n` +
      `👤 *Deleted by:* ${pushName} (+${senderNum})\n` +
      `📍 *Where:* ${chatLabel}\n` +
      `🕒 *Originally sent:* ${timeStr}\n` +
      `📦 *Type:* ${type.toUpperCase()}\n` +
      `─────────────────────────\n`

    try {
      // ── TEXT ──────────────────────────────────────────────────────────────
      if (type === "text") {
        await sock.sendMessage(ownerJid, {
          text: `${header}💬 *Message:*\n${content || "_(empty)_"}`
        })
        continue
      }

      // ── MEDIA ─────────────────────────────────────────────────────────────
      // Send the header first, then the media
      await sock.sendMessage(ownerJid, { text: header })

      let buf = null
      try {
        const { downloadMediaMessage } = require("@whiskeysockets/baileys")
        buf = await downloadMediaMessage(
          originalMsg,
          "buffer",
          {},
          {
            logger: { info: () => {}, warn: () => {}, error: () => {} },
            reuploadRequest: sock.updateMediaMessage,
          }
        )
      } catch (dlErr) {
        console.error("[antidelete] media download failed:", dlErr.message)
      }

      if (!buf) {
        // Media expired on WhatsApp servers before we could download it
        await sock.sendMessage(ownerJid, {
          text: `⚠️ *Media could not be recovered* (expired on WA servers)\n📝 Caption: ${caption || "none"}`
        })
        continue
      }

      const capText = caption ? `📝 *Caption:* ${caption}` : undefined

      if      (type === "image")    await sock.sendMessage(ownerJid, { image:    buf, mimetype, caption: capText })
      else if (type === "video")    await sock.sendMessage(ownerJid, { video:    buf, mimetype, caption: capText })
      else if (type === "gif")      await sock.sendMessage(ownerJid, { video:    buf, mimetype, gifPlayback: true, caption: capText })
      else if (type === "voice")    await sock.sendMessage(ownerJid, { audio:    buf, ptt: true, mimetype })
      else if (type === "audio")    await sock.sendMessage(ownerJid, { audio:    buf, mimetype })
      else if (type === "sticker")  await sock.sendMessage(ownerJid, { sticker:  buf })
      else if (type === "document") await sock.sendMessage(ownerJid, { document: buf, mimetype, fileName: content || "file", caption: capText })

    } catch (sendErr) {
      console.error("[antidelete] failed to forward to owner:", sendErr.message)
    }
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
  pattern:  "antidelete",
  alias:    ["antidel", "ad"],
  category: "owner",
  desc:     "Forward any deleted message (text/image/video/gif/voice/sticker/doc) to your DM",
  usage:    ".antidelete on | off | status",

  // ↓ These get auto-merged onto `lib` by loadFile() in index.js
  handleAntidelete,
  handleAntideleteUpdate,

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: "❌ Only the bot owner can use this command."
      }, { quoted: msg })
    }

    const sub = (args[0] || "").toLowerCase()

    if (sub === "on") {
      adState.enabled = true
      saveState(adState)
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   🛡️  *ANTI-DELETE*       ║\n` +
          `╚══════════════════════════╝\n\n` +
          `✅ *Status:* ENABLED\n\n` +
          `All deleted messages across groups & DMs will be forwarded to your DM.\n\n` +
          `*Supports:*\n` +
          `› Text  › Image  › Video  › GIF\n` +
          `› Voice › Audio  › Sticker › Document\n\n` +
          `_This setting persists through bot restarts._`
      }, { quoted: msg })
    }

    if (sub === "off") {
      adState.enabled = false
      saveState(adState)
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   🛡️  *ANTI-DELETE*       ║\n` +
          `╚══════════════════════════╝\n\n` +
          `🔴 *Status:* DISABLED\n\n` +
          `Deleted messages will no longer be forwarded.\n\n` +
          `_This setting persists through bot restarts._`
      }, { quoted: msg })
    }

    if (sub === "status") {
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   🛡️  *ANTI-DELETE*       ║\n` +
          `╚══════════════════════════╝\n\n` +
          `*Status:* ${adState.enabled ? "✅ ENABLED" : "🔴 DISABLED"}\n` +
          `*Cached msgs:* ${msgCache.size} / ${MAX_CACHE}\n\n` +
          `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text:
        `╔══════════════════════════╗\n` +
        `║   🛡️  *ANTI-DELETE*       ║\n` +
        `╚══════════════════════════╝\n\n` +
        `*Usage:*\n` +
        `› *.antidelete on* — Enable\n` +
        `› *.antidelete off* — Disable\n` +
        `› *.antidelete status* — Check status`
    }, { quoted: msg })
  }
}
