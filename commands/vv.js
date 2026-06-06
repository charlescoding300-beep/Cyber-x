// ═══════════════════════════════════════════════════════════════
// commands/vv.js — CYBER X VIEW ONCE REVEALER
// Usage: Reply to any view-once image or video with .vv
// Handles: viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension
//          + ephemeral-wrapped view-once, all media types
// ═══════════════════════════════════════════════════════════════

const {
  downloadMediaMessage,
  extractMessageContent,
  normalizeMessageContent,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

// Pull contextInfo from ANY message type that can have a reply
function getCtx(msg) {
  const m = msg.message
  if (!m) return null
  return (
    m.extendedTextMessage?.contextInfo     ||
    m.imageMessage?.contextInfo            ||
    m.videoMessage?.contextInfo            ||
    m.audioMessage?.contextInfo            ||
    m.documentMessage?.contextInfo         ||
    m.stickerMessage?.contextInfo          ||
    m.buttonsResponseMessage?.contextInfo  ||
    m.listResponseMessage?.contextInfo     ||
    m.templateButtonReplyMessage?.contextInfo ||
    null
  )
}

// Check if a raw IMessage is a view-once (any variant)
function isViewOnce(message) {
  if (!message) return false
  return !!(
    message.viewOnceMessage               ||
    message.viewOnceMessageV2             ||
    message.viewOnceMessageV2Extension    ||
    // nested inside ephemeral
    message.ephemeralMessage?.message?.viewOnceMessage    ||
    message.ephemeralMessage?.message?.viewOnceMessageV2  ||
    message.ephemeralMessage?.message?.viewOnceMessageV2Extension
  )
}

// Fully unwrap ALL view-once + ephemeral layers → returns IMessage or null
function unwrap(message) {
  if (!message) return null

  // Peel ephemeral first if present
  let m = message
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message

  // Now peel view-once wrapper (newest → oldest priority)
  if (m.viewOnceMessageV2Extension?.message)
    return m.viewOnceMessageV2Extension.message

  if (m.viewOnceMessageV2?.message)
    return m.viewOnceMessageV2.message

  if (m.viewOnceMessage?.message)
    return m.viewOnceMessage.message

  // Fallback: run Baileys' own extractor
  const extracted = extractMessageContent(m)
  if (extracted) return normalizeMessageContent(extracted) || extracted

  return null
}

// Get the actual media node from an unwrapped IMessage
function getMediaNode(inner) {
  if (!inner) return null
  return (
    inner.imageMessage ||
    inner.videoMessage ||
    null
  )
}

// Determine media type string
function getMediaType(inner) {
  if (inner?.imageMessage) return "image"
  if (inner?.videoMessage) return "video"
  return null
}

// Determine mimetype
function getMime(inner) {
  return (
    inner?.imageMessage?.mimetype ||
    inner?.videoMessage?.mimetype ||
    null
  )
}

// ─────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "vv",
  desc:     "Reveal a view-once image or video sent to you",
  category: "utility",

  async run({ sock, from, msg, sender }) {

    // ── React ⏳ immediately so user knows bot received the command ──
    await sock.sendMessage(from, {
      react: { text: "⏳", key: msg.key }
    }).catch(() => {})

    // ── Must be a reply ──
    const ctx = getCtx(msg)
    if (!ctx?.quotedMessage || !ctx?.stanzaId) {
      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})
      return sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  👁️ *VV COMMAND*   ║
╚════════════════════╝

┌─────〔 ℹ️ *HOW TO USE* 〕─────
│ Reply to a view-once message
│ and type *.vv*
│
│ Works for:
│  • 📷 View-once images
│  • 🎥 View-once videos
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    const quotedMsg = ctx.quotedMessage

    // ── Must be a view-once message ──
    if (!isViewOnce(quotedMsg)) {
      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})
      return sock.sendMessage(from, {
        text: "❌ *That's not a view-once message!*\nReply to a 👁 view-once image or video.",
        quoted: msg
      })
    }

    try {
      // ── Unwrap all layers to get the real inner message ──
      const inner = unwrap(quotedMsg)
      if (!inner) throw new Error("Could not unwrap view-once content")

      const mediaType = getMediaType(inner)
      if (!mediaType) throw new Error("View-once contains no image or video")

      // ── Build a fake WAMessage that downloadMediaMessage can use ──
      // We try the original quotedMsg first; if that fails we try the unwrapped inner
      const fakeMsg = {
        key: {
          remoteJid:   from,
          fromMe:      false,
          id:          ctx.stanzaId,
          participant: ctx.participant || from,
        },
        message: quotedMsg   // keep original wrapper — Baileys handles unwrapping internally
      }

      // ── Download the encrypted media & decrypt it ──
      let buffer
      try {
        buffer = await downloadMediaMessage(
          fakeMsg,
          "buffer",
          {},
          {
            reuploadRequest: sock.updateMediaMessage  // re-fetches expired media from WA servers
          }
        )
      } catch (dlErr) {
        // Fallback: try with the already-unwrapped inner message
        const fakeMsgInner = {
          key: fakeMsg.key,
          message: inner
        }
        buffer = await downloadMediaMessage(
          fakeMsgInner,
          "buffer",
          {},
          { reuploadRequest: sock.updateMediaMessage }
        )
      }

      if (!buffer || buffer.length === 0)
        throw new Error("Downloaded buffer is empty")

      const mime    = getMime(inner) || (mediaType === "image" ? "image/jpeg" : "video/mp4")
      const tag     = (ctx.participant || sender || "").split("@")[0]
      const caption =
`👁️ *View Once decrypted*

┌─────〔 📤 *𝘾𝙔𝘽𝙀𝙍 𝙓* 〕─────
│ 👤 *From:* @${tag}
│ 🔓 *Type:* ${mediaType === "image" ? "📷 Image" : "🎥 Video"}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

      const mentions = ctx.participant ? [ctx.participant] : []

      // ── Send as normal (non-view-once) message ──
      if (mediaType === "image") {
        await sock.sendMessage(from, {
          image:    buffer,
          mimetype: mime,
          caption,
          mentions,
        }, { quoted: msg })

      } else if (mediaType === "video") {
        await sock.sendMessage(from, {
          video:    buffer,
          mimetype: mime,
          caption,
          mentions,
        }, { quoted: msg })
      }

      // ── React ✅ ──
      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      }).catch(() => {})

    } catch (err) {
      console.error("[VV]", err.message)

      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})

      // ── Friendly error messages based on what went wrong ──
      let errText = err.message

      if (/expired|not found|media/i.test(errText)) {
        errText = "Media has expired on WhatsApp servers. The sender needs to resend it."
      } else if (/empty/i.test(errText)) {
        errText = "Media downloaded but was empty. Try again."
      } else if (/unwrap|content/i.test(errText)) {
        errText = "Could not read view-once content. Make sure you're replying to a view-once message."
      }

      await sock.sendMessage(from, {
        text:
`╔════════════════════╗
║  ❌ *VV FAILED*    ║
╚════════════════════╝

┌─────〔 ⚠️ *ERROR* 〕─────
│ ${errText}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }
  }
}
