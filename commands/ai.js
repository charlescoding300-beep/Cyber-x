// commands/ai.js — CYBER X AI Command (Groq + Vision + Full Support)
const https = require("https")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")

// ── Conversation history per chat ──
const histories = new Map()

function getHistory(jid) {
  if (!histories.has(jid)) histories.set(jid, [])
  return histories.get(jid)
}

function clearHistory(jid) {
  histories.set(jid, [])
}

async function askGroq(jid, text, imageBase64 = null, imageMime = null) {
  const GROQ_KEY = process.env.GROQ_API_KEY
  if (!GROQ_KEY) throw new Error("API_KEY not set")

  const history = getHistory(jid)

  // ── Use vision model if image, fast model if text only ──
  const model = imageBase64
    ? "meta-llama/llama-4-scout-17b-16e-instruct"
    : "llama3-8b-8192"

  // ── Build current user message ──
  const userContent = imageBase64
    ? [
        { type: "text", text: text || "Analyze this image and describe everything you see in detail" },
        {
          type: "image_url",
          image_url: {
            url: `data:${imageMime || "image/jpeg"};base64,${imageBase64}`
          }
        }
      ]
    : text

  // ── Add to history (text only for memory efficiency) ──
  history.push({ role: "user", content: text || "Analyze this image" })
  if (history.length > 20) history.splice(0, history.length - 20)

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: `You are CYBER X AI — a powerful, smart, and friendly AI assistant built into the CYBER X WhatsApp bot by Charles Chukwu (Charles Tech) from Nigeria.

You can:
- Answer any question on any topic
- Write and explain code in any programming language
- Analyze and describe images in full detail
- Tell jokes, roast people, have casual conversations
- Help with essays, stories, translations, math, science
- Give advice, explain concepts, summarize things
- Do absolutely anything a normal AI assistant would do

Rules:
- Be conversational and match the user energy
- Keep responses concise unless detail is needed
- For code always wrap in backticks with language name
- Never refuse reasonable requests
- If asked who you are say you are CYBER X AI by Charles Chukwu
- If asked what model or AI you are say CYBER X AI powered by Groq`
      },
      // history for context
      ...history.slice(-10).slice(0, -1).map(h => ({
        role:    h.role,
        content: h.content,
      })),
      // current message with image if present
      { role: "user", content: userContent }
    ],
    temperature: 0.85,
    max_tokens:  1500,
  })

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/chat/completions",
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${GROQ_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      }
    }, res => {
      let d = ""
      res.on("data", c => d += c)
      res.on("end",  () => { try { resolve(JSON.parse(d)) } catch { resolve(null) } })
    })
    req.on("error", reject)
    req.setTimeout(30000, () => req.destroy())
    req.write(body)
    req.end()
  })

  if (!data?.choices?.[0]?.message?.content) {
    const errMsg = data?.error?.message || "empty response"
    throw new Error(errMsg)
  }

  const reply = data.choices[0].message.content
  history.push({ role: "assistant", content: reply })
  return reply
}

module.exports = {
  pattern:  "ai",
  alias:    ["ask", "chat", "gpt"],
  desc:     "Chat with CYBER X AI — text, images, code, anything",
  usage:    ".ai <question> | .ai reset | reply image + .ai",
  category: "ai",

  run: async ({ sock, from, msg, text }) => {

    // ── .ai reset — clear memory ──
    if (text.trim().toLowerCase() === "reset") {
      clearHistory(from)
      return sock.sendMessage(from, {
        text: "🧹 *Memory cleared!*\nStarting fresh conversation.\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech",
        quoted: msg
      })
    }

    // ── Check for image (direct or quoted) ──
    const quoted      = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
    const isDirectImg = !!msg.message?.imageMessage
    const isQuotedImg = !!quoted?.imageMessage
    const hasImage    = isDirectImg || isQuotedImg

    // ── Must have text or image ──
    if (!text && !hasImage) {
      return sock.sendMessage(from, {
        text:
`╔═══════════════════════════╗
║  🤖 *CYBER X AI*          ║
╚═══════════════════════════╝

*What I can do:*
• Answer any question
• Write & explain code
• Analyze images in detail
• Tell jokes & roast you 😂
• Help with essays & stories
• Math, science, advice — anything

*How to use:*
• *.ai <question>* — Ask anything
• *.ai reset* — Clear my memory
• *.ask* | *.chat* | *.gpt* — Also works
• *Reply to image + .ai* — Analyze image

💡 *Examples:*
  _.ai explain black holes_
  _.ai write a snake game in JS_
  _.ai roast me hard_
  _.ai translate hello to Yoruba_
  _.ai what is in this image_

> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
        quoted: msg
      })
    }

    // ── React to show processing ──
    await sock.sendMessage(from, {
      react: { text: "🧠", key: msg.key }
    }).catch(() => {})

    // ── Show typing ──
    await sock.sendPresenceUpdate("composing", from).catch(() => {})

    try {
      let imageBase64 = null
      let imageMime   = null

      // ── Download image if present ──
      if (hasImage) {
        try {
          const imgMsg = isDirectImg
            ? msg
            : { key: msg.key, message: quoted }

          const buffer = await downloadMediaMessage(
            imgMsg, "buffer", {},
            { reuploadRequest: sock.updateMediaMessage }
          )
          imageBase64 = buffer.toString("base64")
          imageMime   = isDirectImg
            ? msg.message.imageMessage.mimetype
            : quoted.imageMessage.mimetype
          imageMime   = imageMime || "image/jpeg"
          console.log(`[AI] 🖼️ Image downloaded — ${Math.round(buffer.length / 1024)}KB`)
        } catch (e) {
          console.warn("[AI] Image download failed:", e.message)
          await sock.sendMessage(from, {
            text: "⚠️ *Could not download image.* Try sending it again.\n\n> ⚡ *CYBER X AI*",
            quoted: msg
          })
          return
        }
      }

      // ── Get AI response ──
      const reply = await askGroq(from, text, imageBase64, imageMime)

      // ── Send response ──
      await sock.sendMessage(from, {
        text:   reply,
        quoted: msg
      })

      // ── React success ──
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
          ? "❌ *GROQ_API_KEY not set!*\nAdd it to your .env file."
        : e.message.includes("429") || e.message.includes("rate") || e.message.includes("quota")
          ? "⚠️ *Too many requests.* Wait 30 seconds and try again."
        : e.message.includes("empty")
          ? "⚠️ *AI returned nothing.* Try rephrasing your question."
        : e.message.includes("timeout") || e.message.includes("destroyed")
          ? "⚠️ *Request timed out.* Try again in a moment."
        : e.message.includes("vision") || e.message.includes("image")
          ? "⚠️ *Image analysis failed.* Try sending the image again."
          : `❌ *Error:* ${e.message}`

      await sock.sendMessage(from, {
        text: `${friendly}\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
        quoted: msg
      })
    }
  }
}
