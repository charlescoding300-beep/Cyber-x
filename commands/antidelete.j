/**
 * CYBER X — commands/antidelete.js
 * Category: owner — only owner can toggle
 *
 * ✅ Persistent per-session state (data/antidelete_<phone>.json)
 * ✅ Downloads & saves media to tmp/ immediately on arrival
 * ✅ Auto-cleans tmp/ when folder exceeds 200MB
 * ✅ Supports: text, image, video, gif, voice, audio, sticker, document, viewOnce
 * ✅ Shows who deleted + sender + group name + time
 * ✅ Exports storeMessage + handleMessageRevocation → auto-merged onto lib by loadFile()
 * ✅ Always caches (even when antidelete is OFF) so enabling later still works
 * ✅ TTL-based cache expiry (6 hours) to prevent RAM bloat
 * ✅ Handles ephemeral-wrapped delete events
 * ✅ Uses sock.user.id directly for owner JID (multi-device safe)
 * ✅ Logs errors to console instead of silently swallowing them
 */

const fs   = require("fs")
const path = require("path")
const { downloadContentFromMessage } = require("@whiskeysockets/baileys")
const { writeFile } = require("fs/promises")

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../data")
const TMP_DIR  = path.join(__dirname, "../tmp")

for (const d of [DATA_DIR, TMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

// ─── Per-session config ───────────────────────────────────────────────────────
function configPath(phone) {
  return path.join(DATA_DIR, `antidelete_${phone}.json`)
}

function loadConfig(phone) {
  try {
    const p = configPath(phone)
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"))
      return { enabled: parsed.enabled === true }
    }
  } catch {}
  return { enabled: false }
}

function saveConfig(phone, config) {
  try {
    fs.writeFileSync(configPath(phone), JSON.stringify({ enabled: config.enabled }, null, 2))
  } catch (e) {
    console.error("[antidelete] saveConfig failed:", e.message)
  }
}

// ─── Owner JID helper (multi-device safe) ────────────────────────────────────
// Always use sock.user.id directly — never reconstruct from phone number.
function getOwnerJid(sock) {
  const raw = sock.user?.id || ""
  // sock.user.id is already like "2348012345678:0@s.whatsapp.net"
  // WhatsApp DMs need the bare JID without device suffix
  const bare = raw.split(":")[0] + "@s.whatsapp.net"
  return bare
}

function getPhone(sock) {
  const raw = sock.user?.id || ""
  return raw.split(":")[0].split("@")[0]
}

// ─── In-memory message store with TTL ────────────────────────────────────────
// key = message id → value = { ..., expiresAt }
// Always populated regardless of enabled state — toggling on later still works.
const TTL_MS      = 6 * 60 * 60 * 1000  // 6 hours
const messageStore = new Map()

// Purge expired entries every 30 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of messageStore) {
    if (entry.expiresAt < now) messageStore.delete(id)
  }
}, 30 * 60 * 1000)

// ─── Tmp folder size + cleanup ────────────────────────────────────────────────
function getTmpSizeMB() {
  try {
    return fs.readdirSync(TMP_DIR).reduce((total, f) => {
      try { return total + fs.statSync(path.join(TMP_DIR, f)).size } catch { return total }
    }, 0) / (1024 * 1024)
  } catch { return 0 }
}

function cleanTmp() {
  try {
    if (getTmpSizeMB() > 200) {
      for (const f of fs.readdirSync(TMP_DIR)) {
        try { fs.unlinkSync(path.join(TMP_DIR, f)) } catch {}
      }
      console.log("[antidelete] 🧹 Cleared tmp/ (exceeded 200MB)")
    }
  } catch (e) {
    console.error("[antidelete] cleanTmp error:", e.message)
  }
}

setInterval(cleanTmp, 60 * 1000)

// ─── Helper: stream → buffer ──────────────────────────────────────────────────
async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// ─── Helper: unwrap viewOnce ──────────────────────────────────────────────────
function unwrapMessage(m) {
  if (!m) return m
  // viewOnceMessage wraps the real message one level deeper
  if (m.viewOnceMessage?.message)        return m.viewOnceMessage.message
  if (m.viewOnceMessageV2?.message)      return m.viewOnceMessageV2.message
  if (m.viewOnceMessageV2Extension?.message) return m.viewOnceMessageV2Extension.message
  return m
}

// ─── storeMessage — called from index.js messages.upsert ─────────────────────
// ALWAYS caches regardless of enabled state. Errors logged, never silently swallowed.
async function storeMessage(sock, msg) {
  try {
    if (!msg?.key?.id || !msg?.message) return

    const id       = msg.key.id
    const sender   = msg.key.participant || msg.key.remoteJid || ""
    const group    = msg.key.remoteJid?.endsWith("@g.us") ? msg.key.remoteJid : null
    const rawMsg   = unwrapMessage(msg.message)

    let content   = ""
    let mediaType = ""
    let mediaPath = ""

    if (rawMsg.conversation) {
      content = rawMsg.conversation

    } else if (rawMsg.extendedTextMessage) {
      content = rawMsg.extendedTextMessage.text || ""

    } else if (rawMsg.imageMessage) {
      mediaType = "image"
      content   = rawMsg.imageMessage.caption || ""
      try {
        const stream = await downloadContentFromMessage(rawMsg.imageMessage, "image")
        const buf    = await streamToBuffer(stream)
        mediaPath    = path.join(TMP_DIR, `${id}.jpg`)
        await writeFile(mediaPath, buf)
      } catch (e) {
        console.error("[antidelete] image download failed:", e.message)
      }

    } else if (rawMsg.videoMessage) {
      mediaType = rawMsg.videoMessage.gifPlayback ? "gif" : "video"
      content   = rawMsg.videoMessage.caption || ""
      try {
        const stream = await downloadContentFromMessage(rawMsg.videoMessage, "video")
        const buf    = await streamToBuffer(stream)
        mediaPath    = path.join(TMP_DIR, `${id}.mp4`)
        await writeFile(mediaPath, buf)
      } catch (e) {
        console.error("[antidelete] video download failed:", e.message)
      }

    } else if (rawMsg.audioMessage) {
      mediaType    = rawMsg.audioMessage.ptt ? "voice" : "audio"
      const mime   = rawMsg.audioMessage.mimetype || ""
      const ext    = mime.includes("ogg") ? "ogg" : "mp3"
      try {
        const stream = await downloadContentFromMessage(rawMsg.audioMessage, "audio")
        const buf    = await streamToBuffer(stream)
        mediaPath    = path.join(TMP_DIR, `${id}.${ext}`)
        await writeFile(mediaPath, buf)
      } catch (e) {
        console.error("[antidelete] audio download failed:", e.message)
      }

    } else if (rawMsg.stickerMessage) {
      mediaType = "sticker"
      try {
        const stream = await downloadContentFromMessage(rawMsg.stickerMessage, "sticker")
        const buf    = await streamToBuffer(stream)
        mediaPath    = path.join(TMP_DIR, `${id}.webp`)
        await writeFile(mediaPath, buf)
      } catch (e) {
        console.error("[antidelete] sticker download failed:", e.message)
      }

    } else if (rawMsg.documentMessage) {
      mediaType = "document"
      content   = rawMsg.documentMessage.fileName || "file"
      try {
        const stream = await downloadContentFromMessage(rawMsg.documentMessage, "document")
        const buf    = await streamToBuffer(stream)
        const ext    = path.extname(content) || ".bin"
        mediaPath    = path.join(TMP_DIR, `${id}${ext}`)
        await writeFile(mediaPath, buf)
      } catch (e) {
        console.error("[antidelete] document download failed:", e.message)
      }

    } else {
      return  // unsupported type — skip storing
    }

    messageStore.set(id, {
      content, mediaType, mediaPath,
      sender, group,
      pushName:  msg.pushName || "Unknown",
      timestamp: new Date().toISOString(),
      expiresAt: Date.now() + TTL_MS,
    })

  } catch (e) {
    console.error("[antidelete] storeMessage error:", e.message)
  }
}

// ─── handleMessageRevocation — called from index.js messages.update ───────────
async function handleMessageRevocation(sock, updates) {
  try {
    const phone    = getPhone(sock)
    const config   = loadConfig(phone)
    if (!config.enabled) return

    const ownerJid = getOwnerJid(sock)

    for (const update of updates) {
      // ── Unwrap: handle both direct and ephemeral-wrapped delete events ──────
      // Direct:    update.update.message.protocolMessage
      // Ephemeral: update.update.message.ephemeralMessage.message.protocolMessage
      const updateMsg = update.update?.message
      let proto =
        updateMsg?.protocolMessage ||
        updateMsg?.ephemeralMessage?.message?.protocolMessage ||
        null

      if (!proto) continue

      // type 0 = REVOKE (message delete). Also guard string "REVOKE" for older Baileys.
      if (proto.type !== 0 && proto.type !== "REVOKE") continue

      const deletedId = proto.key?.id
      if (!deletedId) {
        console.warn("[antidelete] revoke event missing proto.key.id")
        continue
      }

      const original = messageStore.get(deletedId)
      if (!original) {
        // Message wasn't cached (arrived before bot started, or unsupported type)
        continue
      }

      const deletedBy    = update.key?.participant || update.key?.remoteJid || "Unknown"
      const deletedByNum = deletedBy.replace(/[^0-9]/g, "")
      const senderNum    = original.sender.replace(/[^0-9]/g, "")

      // Don't report if the owner deleted their own message
      if (deletedByNum === phone) continue

      const time = new Date().toLocaleString("en-GB", {
        hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit",
        day: "2-digit", month: "2-digit", year: "numeric"
      })

      let groupName = ""
      if (original.group) {
        try {
          const meta = await sock.groupMetadata(original.group)
          groupName = meta.subject || ""
        } catch (e) {
          console.error("[antidelete] groupMetadata failed:", e.message)
        }
      }

      let reportText =
        `╔══════════════════════════╗\n` +
        `║   🗑️  *ANTI-DELETE LOG*   ║\n` +
        `╚══════════════════════════╝\n\n` +
        `🗑️ *Deleted by:* @${deletedByNum}\n` +
        `👤 *Sender:* @${senderNum} (${original.pushName})\n` +
        `🕒 *Time:* ${time}\n`

      if (groupName) reportText += `👥 *Group:* ${groupName}\n`

      if (original.content) {
        reportText += `\n💬 *${original.mediaType === "document" ? "File" : "Message"}:*\n${original.content}`
      }

      reportText += `\n\n_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`

      try {
        await sock.sendMessage(ownerJid, {
          text: reportText,
          mentions: [deletedBy, original.sender].filter(Boolean)
        })
      } catch (e) {
        console.error("[antidelete] sendMessage (text report) failed:", e.message)
      }

      // Send media if saved
      if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
        try {
          const capText = `🗑️ *Deleted ${original.mediaType}*\nFrom: @${senderNum}`

          switch (original.mediaType) {
            case "image":
              await sock.sendMessage(ownerJid, { image:    { url: original.mediaPath }, caption: capText, mentions: [original.sender] })
              break
            case "video":
            case "gif":
              await sock.sendMessage(ownerJid, { video:    { url: original.mediaPath }, caption: capText, gifPlayback: original.mediaType === "gif", mentions: [original.sender] })
              break
            case "voice":
              await sock.sendMessage(ownerJid, { audio:    { url: original.mediaPath }, ptt: true, mimetype: "audio/ogg; codecs=opus" })
              break
            case "audio":
              await sock.sendMessage(ownerJid, { audio:    { url: original.mediaPath }, mimetype: "audio/mpeg" })
              break
            case "sticker":
              await sock.sendMessage(ownerJid, { sticker:  { url: original.mediaPath } })
              break
            case "document":
              await sock.sendMessage(ownerJid, { document: { url: original.mediaPath }, fileName: original.content || "file", caption: capText, mentions: [original.sender] })
              break
          }
        } catch (e) {
          console.error("[antidelete] sendMessage (media) failed:", e.message)
          try {
            await sock.sendMessage(ownerJid, { text: `⚠️ Could not send media: ${e.message}` })
          } catch {}
        }

        try { fs.unlinkSync(original.mediaPath) } catch {}
      }

      messageStore.delete(deletedId)
    }
  } catch (e) {
    console.error("[antidelete] handleMessageRevocation error:", e.message)
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
  pattern:  "antidelete",
  alias:    ["antidel", "ad"],
  category: "owner",
  desc:     "Forward deleted messages (all types) to your DM. Persistent per session.",
  usage:    ".antidelete on | off | status",

  storeMessage,
  handleMessageRevocation,

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: "❌ Only the bot owner can use this command."
      }, { quoted: msg })
    }

    const phone  = getPhone(sock)
    const config = loadConfig(phone)
    const sub    = (args[0] || "").toLowerCase()

    if (sub === "on") {
      config.enabled = true
      saveConfig(phone, config)
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
          `_This setting persists through bot restarts._\n\n` +
          `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
      }, { quoted: msg })
    }

    if (sub === "off") {
      config.enabled = false
      saveConfig(phone, config)
      return sock.sendMessage(from, {
        text:
          `╔══════════════════════════╗\n` +
          `║   🛡️  *ANTI-DELETE*       ║\n` +
          `╚══════════════════════════╝\n\n` +
          `🔴 *Status:* DISABLED\n\n` +
          `Deleted messages will no longer be forwarded.\n\n` +
          `_This setting persists through bot restarts._\n\n` +
          `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
      }, { quoted: msg })
    }

    // .antidelete / .antidelete status
    return sock.sendMessage(from, {
      text:
        `╔══════════════════════════╗\n` +
        `║   🛡️  *ANTI-DELETE*       ║\n` +
        `╚══════════════════════════╝\n\n` +
        `*Status:* ${config.enabled ? "✅ ENABLED" : "🔴 DISABLED"}\n` +
        `*Cached msgs:* ${messageStore.size}\n` +
        `*Tmp folder:* ${getTmpSizeMB().toFixed(1)}MB / 200MB\n\n` +
        `*.antidelete on* — Enable\n` +
        `*.antidelete off* — Disable\n\n` +
        `_© 𝕮𝖄𝕭𝕰𝕽 𝖃 ™_`
    }, { quoted: msg })
  }
}
