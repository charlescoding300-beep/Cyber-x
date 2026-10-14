// commands/ai.js — ZEN X_Bot AI Command (Groq + Vision + Voice + Full Support)
const https = require("https")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")

const histories = new Map()

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const VOICE_CHANCE = 0.6 // 60% voice, 40% text

function getHistory(jid) {
  if (!histories.has(jid)) histories.set(jid, [])
  return histories.get(jid)
}

function clearHistory(jid) {
  histories.set(jid, [])
}

async function askAI(jid, text, imageBase64 = null, imageMime = null) {
  const xaiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  const provider = xaiKey ? "xai" : (groqKey ? "groq" : null)
  if (!provider) throw new Error("AI_API_KEY_NOT_SET")

  const apiKey = provider === "xai" ? xaiKey : groqKey
  const history = getHistory(jid)
  const model = provider === "xai"
    ? (process.env.GROK_MODEL || "grok-4.7")
    : (imageBase64 ? "qwen/qwen3.8-27b" : "openai/gpt-oss-20b")

  const userContent = imageBase64
    ? [
        { type: "text", text: text || "Analyze this image and describe what you see." },
        {
          type: "image_url",
          image_url: {
            url: "data:" + (imageMime || "image/jpeg") + ";base64," + imageBase64
          }
        }
      ]
    : text

  const systemPrompt = [
    "You are ZEN X_Bot AI, a friendly and helpful WhatsApp assistant.",
    "Answer naturally and clearly. Keep replies concise unless the user asks for detail.",
    "Use earlier messages in this chat as context when useful.",
    "If asked which AI provider you use, say " + (provider === "xai" ? "Grok" : "Groq") + ".",
    "For code, use fenced code blocks with a language name."
  ].join("\n")

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.slice(-10),
      { role: "user", content: userContent }
    ],
    temperature: 0.7,
    ...(provider === "groq"
      ? {
          max_completion_tokens: 1200,
          ...(!imageBase64 ? { reasoning_effort: "low" } : {})
        }
      : { max_tokens: 1200 })
  })

  const endpoint = provider === "xai"
    ? "https://api.x.ai/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions"

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body,
    signal: AbortSignal.timeout(45000)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error?.message || ("AI provider returned HTTP " + response.status))
  }

  let reply = data?.choices?.[0]?.message?.content
  if (Array.isArray(reply)) {
    reply = reply.map(part => part.text || "").join("")
  }
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error(data?.error?.message || "AI provider returned an empty response")
  }

  history.push({ role: "user", content: text || "Analyze this image" })
  history.push({ role: "assistant", content: reply })
  if (history.length > 20) history.splice(0, history.length - 20)
  return reply.trim()
}

// ── VoiceRSS TTS — smooth UK female voice (Amy) ──
// Docs: https://www.voicerss.org/api/
function stripForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, "code block, check the text above")
    .replace(/[*_~`]/g, "")
    .replace(/https?:\/\/\S+/g, "link, check the text above")
    .slice(0, 900) // keep it within a sane TTS length
}

async function voiceRssTTS(text) {
  const VOICE_KEY = process.env.VOICERSS_API_KEY
  if (!VOICE_KEY) throw new Error("VOICERSS_API_KEY not set")

  const clean = stripForSpeech(text)
  const params = new URLSearchParams({
    key:  VOICE_KEY,
    hl:   "en-gb",
    v:    "Amy",          // smooth UK female voice
    c:    "MP3",
    f:    "44khz_16bit_stereo",
    src:  clean,
  })

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.voicerss.org",
      path:     `/?${params.toString()}`,
      method:   "GET",
    }, res => {
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end",  () => resolve(Buffer.concat(chunks)))
    })
    req.on("error", reject)
    req.setTimeout(20000, () => req.destroy())
    req.end()
  })

  // VoiceRSS returns plain-text "ERROR: ..." (not audio) on failure
  const head = data.slice(0, 20).toString("utf8")
  if (head.startsWith("ERROR")) throw new Error(data.toString("utf8"))
  if (!data || data.length < 500) throw new Error("empty audio response")

  return data
}

const run = async ({ sock, from, message, text = "" }) => {
  const requestText = String(text || "").trim()

  if (requestText.toLowerCase() === "reset") {
    clearHistory(from)
    return sock.sendMessage(from, {
      text: "🧹 *Memory cleared!*\nFresh start — what's on your mind?\n\n" + CREDIT
    }, { quoted: message })
  }

  const content = message?.message || {}
  const contextInfo =
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    {}
  const quoted = contextInfo.quotedMessage
  const quotedContent =
    quoted?.ephemeralMessage?.message ||
    quoted?.viewOnceMessage?.message ||
    quoted
  const quotedText =
    quotedContent?.conversation ||
    quotedContent?.extendedTextMessage?.text ||
    quotedContent?.imageMessage?.caption ||
    quotedContent?.videoMessage?.caption ||
    quotedContent?.documentMessage?.caption ||
    ""

  let prompt = requestText
  if (quotedText && requestText) {
    prompt = "Quoted message:\n" + quotedText + "\n\nYour request:\n" + requestText
  } else if (quotedText) {
    prompt = "Reply to this message:\n" + quotedText
  }

  const directImage = content.imageMessage
  const quotedImage = quotedContent?.imageMessage
  const hasImage = !!(directImage || quotedImage)

  if (!prompt && !hasImage) {
    const help = [
      "╔═══════════════════════════╗",
      "║  🤖 *ZEN X_Bot AI*        ║",
      "╚═══════════════════════════╝",
      "",
      "Ask a question with *.ai <question>*.",
      "Reply to a message with *.ai* to ask about it.",
      "Reply to an image with *.ai* to analyze it.",
      "Use *.ai reset* to clear this chat's AI history.",
      "",
      "Text replies quote your command. Voice replies are used only when VoiceRSS is configured."
    ].join("\n")
    return sock.sendMessage(from, {
      text: help + "\n\n" + CREDIT
    }, { quoted: message })
  }

  await sock.sendMessage(from, {
    react: { text: "🧠", key: message.key }
  }).catch(() => {})
  await sock.sendPresenceUpdate("composing", from).catch(() => {})

  try {
    let imageBase64 = null
    let imageMime = null

    if (hasImage) {
      try {
        const imageMessage = directImage
          ? message
          : { key: message.key, message: quoted }

        const buffer = await downloadMediaMessage(
          imageMessage,
          "buffer",
          {},
          { reuploadRequest: sock.updateMediaMessage }
        )
        imageBase64 = buffer.toString("base64")
        imageMime = (directImage ? directImage.mimetype : quotedImage.mimetype) || "image/jpeg"
      } catch (error) {
        console.warn("[AI] Image download failed:", error.message)
        await sock.sendMessage(from, {
          text: "⚠️ Could not download the image. Please send it again.\n\n" + CREDIT
        }, { quoted: message })
        return
      }
    }

    const reply = await askAI(from, prompt, imageBase64, imageMime)
    let voiceSent = false

    if (process.env.VOICERSS_API_KEY && Math.random() < VOICE_CHANCE) {
      try {
        const audio = await voiceRssTTS(reply)
        await sock.sendMessage(from, {
          audio,
          mimetype: "audio/mpeg",
          ptt: true
        }, { quoted: message })
        await sock.sendMessage(from, {
          text: "🎙️ Voice reply\n\n" + CREDIT
        }, { quoted: message })
        voiceSent = true
      } catch (voiceError) {
        console.warn("[AI] Voice reply failed; sending text instead:", voiceError.message)
      }
    }

    if (!voiceSent) {
      await sock.sendMessage(from, {
        text: reply + "\n\n" + CREDIT
      }, { quoted: message })
    }

    await sock.sendMessage(from, {
      react: { text: "✅", key: message.key }
    }).catch(() => {})
  } catch (error) {
    console.error("[AI] Error:", error.message)
    await sock.sendMessage(from, {
      react: { text: "❌", key: message.key }
    }).catch(() => {})

    const friendly = error.message === "AI_API_KEY_NOT_SET"
      ? "❌ No AI API key is configured. Set GROQ_API_KEY or XAI_API_KEY/GROK_API_KEY."
      : error.message.includes("429") || error.message.toLowerCase().includes("rate") || error.message.toLowerCase().includes("quota")
        ? "⚠️ Too many requests. Please try again shortly."
        : error.message.toLowerCase().includes("timeout")
          ? "⚠️ The AI request timed out. Please try again."
          : "❌ AI error: " + error.message

    await sock.sendMessage(from, {
      text: friendly + "\n\n" + CREDIT
    }, { quoted: message })
  }
}

module.exports = {
  name:     "ai",
  aliases:  ["ask", "chat", "gpt"],
  desc:     "Chat with ZEN X_Bot AI by quoting messages or asking questions; supports text and images.",
  usage:    ".ai <question> | reply to a message/image + .ai | .ai reset",
  category: 'ai',
  run
}
