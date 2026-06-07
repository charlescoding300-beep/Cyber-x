// ═══════════════════════════════════════════════════════════════
// commands/vv.js — CYBER X VIEW ONCE REVEALER v4
// Fixed: quoted message view-once detection
// ═══════════════════════════════════════════════════════════════

const {
  downloadMediaMessage,
  getContentType,
} = require("@whiskeysockets/baileys")

// ─────────────────────────────────────────────────────────
// GET CONTEXT INFO from any message type
// ─────────────────────────────────────────────────────────

function getCtx(msg) {
  const m = msg?.message
  if (!m) return null
  return (
    m.extendedTextMessage?.contextInfo        ||
    m.imageMessage?.contextInfo               ||
    m.videoMessage?.contextInfo               ||
    m.audioMessage?.contextInfo               ||
    m.documentMessage?.contextInfo            ||
    m.stickerMessage?.contextInfo             ||
    m.buttonsResponseMessage?.contextInfo     ||
    m.listResponseMessage?.contextInfo        ||
    m.templateButtonReplyMessage?.contextInfo ||
    null
  )
}

// ─────────────────────────────────────────────────────────
// UNWRAP all known layers → bare inner IMessage
// ─────────────────────────────────────────────────────────

function unwrap(message) {
  if (!message) return null
  let m = message

  // Peel associatedChildMessage (Baileys bug #1872)
  if (m.associatedChildMessage?.message)
    m = m.associatedChildMessage.message

  // Peel ephemeral
  if (m.ephemeralMessage?.message)
    m = m.ephemeralMessage.message

  // Peel view-once wrappers newest → oldest
  if (m.viewOnceMessageV2Extension?.message)
    return m.viewOnceMessageV2Extension.message

  if (m.viewOnceMessageV2?.message)
    return m.viewOnceMessageV2.message

  if (m.viewOnceMessage?.message)
    return m.viewOnceMessage.message

  return m
}

// ─────────────────────────────────────────────────────────
// DETECT view-once — checks ALL possible locations
// WhatsApp sometimes strips viewOnce flag from quoted msg
// so we also accept any quoted media as valid
// ─────────────────────────────────────────────────────────

function isViewOnce(message) {
  if (!message) return false

  // Standard view-once wrappers
  if (
    message.viewOnceMessage            ||
    message.viewOnceMessageV2          ||
    message.viewOnceMessageV2Extension ||
    message.associatedChildMessage?.message?.viewOnceMessage      ||
    message.associatedChildMessage?.message?.viewOnceMessageV2    ||
    message.associatedChildMessage?.message?.viewOnceMessageV2Extension ||
    message.ephemeralMessage?.message?.viewOnceMessage            ||
    message.ephemeralMessage?.message?.viewOnceMessageV2          ||
    message.ephemeralMessage?.message?.viewOnceMessageV2Extension
  ) return true

  // WhatsApp strips the wrapper in quoted/contextInfo messages
  // but the inner imageMessage/videoMessage/audioMessage still
  // has viewOnce: true on it — check that flag directly
  const inner = unwrap(message)
  if (!inner) return false

  const type = getContentType(inner)
  if (!type) return false

  const node = inner[type]
  if (!node) return false

  // viewOnce flag on media node = view-once message
  if (node.viewOnce === true) return true

  // If it has media AND came from contextInfo (quoted),
  // allow it — user is intentionally replying to it
  if (["imageMessage","videoMessage","audioMessage"].includes(type)) return true

  return false
}

// ─────────────────────────────────────────────────────────
// DOWNLOAD — stream first (fixes audio empty-buffer bug)
// ─────────────────────────────────────────────────────────

async function downloadToBuffer(fakeMsg, sock) {
  // Try 1: stream → concat
  try {
    const stream = await downloadMediaMessage(
      fakeMsg, "stream", {},
      { reuploadRequest: sock.updateMediaMessage }
    )
    const chunks = []
    await new Promise((res, rej) => {
      stream.on("data",  c => chunks.push(c))
      stream.on("end",   res)
      stream.on("error", rej)
    })
    const buf = Buffer.concat(chunks)
    if (buf?.length > 0) return buf
  } catch {}

  // Try 2: direct buffer
  try {
    const buf = await downloadMediaMessage(
      fakeMsg, "buffer", {},
      { reuploadRequest: sock.updateMediaMessage }
    )
    if (buf?.length > 0) return buf
  } catch {}

  return null
}

// ─────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────

module.exports = {
  pattern:  "vv",
  desc:     "Reveal a view-once image, video, or voice note",
  category: "utility",

  async run({ sock, from, msg, sender }) {

    // React ⏳ immediately
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
│ then type *.vv*
│
│ Works for:
│  📷 View-once image
│  🎥 View-once video
│  🎤 View-once voice note
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        quoted: msg
      })
    }

    const quotedMsg = ctx.quotedMessage

    try {
      // ── Unwrap all layers ──
      const inner = unwrap(quotedMsg)
      if (!inner) throw new Error("Could not read quoted message content")

      // ── Detect media type ──
      const contentType = getContentType(inner)

      if (!contentType || !["imageMessage","videoMessage","audioMessage"].includes(contentType)) {
        // Not a media message at all
        await sock.sendMessage(from, {
          react: { text: "❌", key: msg.key }
        }).catch(() => {})
        return sock.sendMessage(from, {
          text: "❌ *Reply to a view-once* 📷 *image,* 🎥 *video or* 🎤 *voice note.*",
          quoted: msg
        })
      }

      const mediaNode = inner[contentType]
      const mime = mediaNode?.mimetype || (
        contentType === "imageMessage" ? "image/jpeg"           :
        contentType === "videoMessage" ? "video/mp4"            :
                                         "audio/ogg; codecs=opus"
      )
      const isPtt = contentType === "audioMessage" && mediaNode?.ptt === true

      // ── Build fake WAMessage key ──
      const key = {
        remoteJid:   from,
        fromMe:      false,
        id:          ctx.stanzaId,
        participant: ctx.participant || from,
      }

      // ── Download — try original wrapper first, then unwrapped ──
      let buffer = await downloadToBuffer({ key, message: quotedMsg }, sock)
      if (!buffer) buffer = await downloadToBuffer({ key, message: inner }, sock)

      if (!buffer || buffer.length === 0)
        throw new Error("Media has expired on WhatsApp servers — sender needs to resend it")

      // ── Caption ──
      const tag      = (ctx.participant || sender || "").split("@")[0]
      const typeIcon = contentType === "imageMessage" ? "📷 Image"
                     : contentType === "videoMessage" ? "🎥 Video"
                     : isPtt                          ? "🎤 Voice Note"
                     :                                  "🔊 Audio"

      const caption =
`👁️ *View Once Revealed*

┌─────〔 📤 *CYBER X* 〕─────
│ 👤 *From:* @${tag}
│ 🔓 *Type:* ${typeIcon}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

      const mentions = ctx.participant ? [ctx.participant] : []

      // ── Send as permanent message ──
      if (contentType === "imageMessage") {
        await sock.sendMessage(from, {
          image: buffer, mimetype: mime,
          caption, mentions,
        }, { quoted: msg })

      } else if (contentType === "videoMessage") {
        await sock.sendMessage(from, {
          video: buffer, mimetype: mime,
          caption, mentions,
        }, { quoted: msg })

      } else if (contentType === "audioMessage") {
        await sock.sendMessage(from, {
          text: caption, mentions,
        }, { quoted: msg })
        await sock.sendMessage(from, {
          audio: buffer, mimetype: mime, ptt: isPtt,
        })
      }

      // React ✅
      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      }).catch(() => {})

    } catch (err) {
      console.error("[VV]", err.message)

      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})

      let errText = err.message
      if (/expired|empty|server/i.test(errText))
        errText = "Media has expired — the sender needs to resend it."
      else if (/unsupported|unknown|read/i.test(errText))
        errText = "Could not read this message. Make sure you are replying to a view-once."

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
