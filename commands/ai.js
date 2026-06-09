// commands/ai.js — CYBER X AI Command
const { askAI, clearHistory } = require("../lib/aiCharacter")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")

module.exports = {
  pattern: "ai",
  desc:    "Chat with CYBER X AI — powered by Gemini 2.0",

  run: async ({ sock, from, msg, args, text, sender }) => {

    // ── .ai reset — clear conversation memory ──
    if (text.trim().toLowerCase() === "reset") {
      clearHistory(from)
      return sock.sendMessage(from, {
        text: "🧹 *Memory cleared!*\nStarting fresh conversation.\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech",
        quoted: msg
      })
    }

    // ── Check if replying to an image ──
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    const isImageMsg =
      msg.message?.imageMessage ||
      quoted?.imageMessage

    // ── Must have text OR image ──
    if (!text && !isImageMsg) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🤖 *CYBER X AI*          ║
╚═══════════════════════════╝

*How to use:*
• *.ai <question>* — Ask anything
• *.ai reset* — Clear memory
• Reply to an image + *.ai* — Analyze image
• *.ai write code for <task>* — Generate code

💡 *Examples:*
  _.ai explain quantum computing_
  _.ai write a Node.js REST API_
  _.ai what is in this image_
  _.ai roast me_

> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
        quoted: msg
      })
    }

    // ── React immediately ──
    await sock.sendMessage(from, {
      react: { text: "🧠", key: msg.key }
    }).catch(() => {})

    // ── Typing indicator ──
    await sock.sendPresenceUpdate("composing", from).catch(() => {})

    try {
      let imageBase64 = null
      let imageMime   = null

      // ── Download image if present ──
      const imgMessage = msg.message?.imageMessage
        ? msg
        : quoted?.imageMessage
          ? { key: msg.key, message: quoted }
          : null

      if (imgMessage?.message?.imageMessage || imgMessage?.message?.imageMessage) {
        try {
          const buffer = await downloadMediaMessage(
            imgMessage, "buffer", {},
            { reuploadRequest: sock.updateMediaMessage }
          )
          imageBase64 = buffer.toString("base64")
          imageMime   = imgMessage.message?.imageMessage?.mimetype || "image/jpeg"
        } catch (e) {
          console.warn("[AI] Image download failed:", e.message)
        }
      }

      // ── Ask CYBER X AI ──
      const reply = await askAI(from, text || "Analyze this image", imageBase64, imageMime)

      // ── Send reply ──
      await sock.sendMessage(from, {
        text:   reply,
        quoted: msg
      })

      await sock.sendMessage(from, {
        react: { text: "✅", key: msg.key }
      }).catch(() => {})

    } catch (e) {
      console.error("[AI] Error:", e.message)

      await sock.sendMessage(from, {
        react: { text: "❌", key: msg.key }
      }).catch(() => {})

      const friendly =
        e.message.includes("API_KEY")
          ? "❌ *GEMINI_API_KEY not set!*\nAdd it to your .env file."
        : e.message.includes("quota") || e.message.includes("429")
          ? "⚠️ *Rate limited.* Wait 30s and try again."
        : e.message.includes("empty")
          ? "⚠️ *AI returned nothing.* Try rephrasing your question."
          : `❌ *Error:* ${e.message}`

      await sock.sendMessage(from, {
        text: `${friendly}\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
        quoted: msg
      })
    }
  }
}
