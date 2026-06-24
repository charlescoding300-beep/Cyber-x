/**
 * CYBER X — commands/antidelete.js
 * Category: owner — only owner can toggle
 *
 * ✅ Persistent per-session state (data/antidelete_<phone>.json) — survives restarts, defaults OFF
 * ✅ Downloads & saves media to tmp/ immediately on arrival (most reliable approach)
 * ✅ Auto-cleans tmp/ when folder exceeds 200MB
 * ✅ Supports: text, image, video, gif, voice, audio, sticker, document
 * ✅ Shows who deleted + sender + group name + time
 * ✅ Exports storeMessage + handleMessageRevocation → auto-merged onto lib by loadFile()
 */

const fs   = require("fs")
const path = require("path")
const { downloadContentFromMessage } = require("@whiskeysockets/baileys")
const { writeFile } = require("fs/promises")

// ─── Paths ───────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, "../data")
const TMP_DIR   = path.join(__dirname, "../tmp")

for (const d of [DATA_DIR, TMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

// ─── Per-session state files ──────────────────────────────────────────────────
// Each WhatsApp session linked to the bot gets its own config keyed by phone number.
// This means if you have multiple users linked, each can have antidelete toggled
// independently and their setting persists through restarts.
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

// ─── In-memory message store ──────────────────────────────────────────────────
// key = message id → value = { content, mediaType, mediaPath, sender, group, timestamp }
const messageStore = new Map()

// ─── Tmp folder cleanup (auto-clean at 200MB) ─────────────────────────────────
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

setInterval(cleanTmp, 60 * 1000)  // check every minute

// ─── Helper: stream → buffer ──────────────────────────────────────────────────
async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

// ─── storeMessage — called from index.js messages.upsert ─────────────────────
// Downloads & saves media to disk immediately so it's available even after
// WhatsApp CDN expires the link (which happens fast — sometimes under a minute).
async function storeMessage(sock, msg) {
  try {
    if (!msg?.key?.id || !msg?.message) return

    // Get phone number of this session to check per-session config
    const phone = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0] || ""
    const config = loadConfig(phone)
    if (!config.enabled) return

    const id      = msg.key.id
    const sender  = msg.key.participant || msg.key.remoteJid
    const group   = msg.key.remoteJid?.endsWith("@g.us") ? msg.key.remoteJid : null
    const m       = msg.message

    let content   = ""
    let mediaType = ""
    let mediaPath = ""

    if (m.conversation) {
      content = m.conversation

    } else if (m.extendedTextMessage) {
      content = m.extendedTextMessage.text || ""

    } else if (m.imageMessage) {
      mediaType = "image"
      content   = m.imageMessage.caption || ""
      const stream = await downloadContentFromMessage(m.imageMessage, "image")
      const buf    = await streamToBuffer(stream)
      mediaPath    = path.join(TMP_DIR, `${id}.jpg`)
      await writeFile(mediaPath, buf)

    } else if (m.videoMessage) {
      mediaType = m.videoMessage.gifPlayback ? "gif" : "video"
      content   = m.videoMessage.caption || ""
      const stream = await downloadContentFromMessage(m.videoMessage, "video")
      const buf    = await streamToBuffer(stream)
      mediaPath    = path.join(TMP_DIR, `${id}.mp4`)
      await writeFile(mediaPath, buf)

    } else if (m.audioMessage) {
      mediaType    = m.audioMessage.ptt ? "voice" : "audio"
      const mime   = m.audioMessage.mimetype || ""
      const ext    = mime.includes("ogg") ? "ogg" : "mp3"
      const stream = await downloadContentFromMessage(m.audioMessage, "audio")
      const buf    = await streamToBuffer(stream)
      mediaPath    = path.join(TMP_DIR, `${id}.${ext}`)
      await writeFile(mediaPath, buf)

    } else if (m.stickerMessage) {
      mediaType    = "sticker"
      const stream = await downloadContentFromMessage(m.stickerMessage, "sticker")
      const buf    = await streamToBuffer(stream)
      mediaPath    = path.join(TMP_DIR, `${id}.webp`)
      await writeFile(mediaPath, buf)

    } else if (m.documentMessage) {
      mediaType    = "document"
      content      = m.documentMessage.fileName || "file"
      const stream = await downloadContentFromMessage(m.documentMessage, "document")
      const buf    = await streamToBuffer(stream)
      const ext    = path.extname(content) || ".bin"
      mediaPath    = path.join(TMP_DIR, `${id}${ext}`)
      await writeFile(mediaPath, buf)

    } else {
      return  // unsupported type
    }

    messageStore.set(id, {
      content, mediaType, mediaPath,
      sender, group,
      pushName:  msg.pushName || "Unknown",
      timestamp: new Date().toISOString(),
    })

  } catch (e) {
    console.error("[antidelete] storeMessage error:", e.message)
  }
}

// ─── handleMessageRevocation — called from index.js messages.update ───────────
async function handleMessageRevocation(sock, updates) {
  try {
    const phone    = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0] || ""
    const config   = loadConfig(phone)
    if (!config.enabled) return

    const ownerJid = `${phone}@s.whatsapp.net`

    for (const update of updates) {
      const proto = update.update?.message?.protocolMessage
      if (!proto || (proto.type !== 0 && proto.type !== "REVOKE")) continue

      const deletedId  = proto.key?.id
      if (!deletedId) continue

      const original = messageStore.get(deletedId)
      if (!original) continue

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
        } catch {}
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

      await sock.sendMessage(ownerJid, {
        text: reportText,
        mentions: [deletedBy, original.sender].filter(Boolean)
      })

      // Send media if we have it saved
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
        } catch (mediaErr) {
          await sock.sendMessage(ownerJid, { text: `⚠️ Could not send media: ${mediaErr.message}` })
        }

        // Clean up tmp file after sending
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

  // ↓ Auto-merged onto lib by loadFile() in index.js
  storeMessage,
  handleMessageRevocation,

  run: async ({ sock, from, msg, args, isOwner }) => {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: "❌ Only the bot owner can use this command."
      }, { quoted: msg })
    }

    const phone  = sock.user?.id?.split(":")[0] || sock.user?.id?.split("@")[0] || ""
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

    // .antidelete or .antidelete status
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
