// commands/ai.js — CYBER X AI Command (Groq + Vision + Full Support)
const https = require("https")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")

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

  const model = imageBase64
    ? "meta-llama/llama-4-scout-17b-16e-instruct"
    : "llama-3.1-8b-instant"

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

  history.push({ role: "user", content: text || "Analyze this image" })
  if (history.length > 20) history.splice(0, history.length - 20)

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: `You are CYBER X AI — a powerful, smart, witty and very friendly AI assistant built into the CYBER X WhatsApp bot by Charles Chukwu (Charles Tech) from Nigeria.

Your personality:
- You are warm, fun and conversational — like talking to a smart friend
- You match the user's energy — if they're casual, you're casual. If they're serious, you're serious
- You use light humour naturally without overdoing it
- You show genuine interest in what the user is saying
- You give helpful, clear responses but make them feel natural — not robotic
- You occasionally use emojis where it fits naturally 😄
- You remember context from earlier in the conversation and reference it naturally
- When someone greets you, greet them back warmly and ask what you can help with
- When someone is struggling, be encouraging and supportive
- Never sound like a manual or a textbook — always sound like a person

You can:
- Answer any question on any topic
- Write and explain code in any programming language
- Analyze and describe images in full detail
- Tell jokes, roast people (nicely), have casual conversations
- Help with essays, stories, translations, math, science
- Give advice, explain concepts, summarize things
- Do absolutely anything a helpful AI assistant would do

Rules:
- Keep responses concise and natural unless the user needs detail
- For code always wrap in backticks with the language name
- Never refuse reasonable requests
- If asked who you are say you are CYBER X AI by Charles Chukwu (Charles Tech)
- If asked what model or AI you are say CYBER X AI powered by Groq
- Never start your response with "I" — vary your openings
- Never sound stiff or formal unless the situation calls for it`
      },
      ...history.slice(-10).slice(0, -1).map(h => ({
        role:    h.role,
        content: h.content,
      })),
      { role: "user", content: userContent }
    ],
    temperature: 0.9,
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

const run = async ({ sock, from, message, text }) => {

  if (text.trim().toLowerCase() === "reset") {
    clearHistory(from)
    return sock.sendMessage(from, {
      text: "🧹 *Memory cleared!*\nFresh start — what's on your mind?\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech",
      quoted: message
    })
  }

  const quoted      = message.message?.extendedTextMessage?.contextInfo?.quotedMessage
  const isDirectImg = !!message.message?.imageMessage
  const isQuotedImg = !!quoted?.imageMessage
  const hasImage    = isDirectImg || isQuotedImg

  if (!text && !hasImage) {
    return sock.sendMessage(from, {
      text:
`╔═══════════════════════════╗
║  🤖 *CYBER X AI*          ║
╚═══════════════════════════╝

Hey! 👋 I'm CYBER X AI — your smart assistant right here in WhatsApp.

*Here's what I can do for you:*
• 💬 Answer any question on any topic
• 💻 Write & explain code in any language
• 🖼️ Analyze images in full detail
• 😂 Tell jokes, roast you, casual chat
• ✍️ Essays, stories, translations, math
• 🧠 Advice, explanations, summaries

*How to use me:*
• *.ai <your question>* — Ask me anything
• *.ai reset* — Clear our conversation
• *.ask* | *.chat* | *.gpt* — Also works
• *Reply to an image + .ai* — I'll analyze it

💡 *Try these:*
  _.ai explain black holes like I'm 10_
  _.ai write a snake game in JS_
  _.ai roast me hard_ 😂
  _.ai translate hello to Yoruba_

Just talk to me naturally — I got you! 🔥

> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
      quoted: message
    })
  }

  await sock.sendMessage(from, {
    react: { text: "🧠", key: message.key }
  }).catch(() => {})

  await sock.sendPresenceUpdate("composing", from).catch(() => {})

  try {
    let imageBase64 = null
    let imageMime   = null

    if (hasImage) {
      try {
        const imgMsg = isDirectImg
          ? message
          : { key: message.key, message: quoted }

        const buffer = await downloadMediaMessage(
          imgMsg, "buffer", {},
          { reuploadRequest: sock.updateMediaMessage }
        )
        imageBase64 = buffer.toString("base64")
        imageMime   = isDirectImg
          ? message.message.imageMessage.mimetype
          : quoted.imageMessage.mimetype
        imageMime   = imageMime || "image/jpeg"
        console.log(`[AI] 🖼️ Image downloaded — ${Math.round(buffer.length / 1024)}KB`)
      } catch (e) {
        console.warn("[AI] Image download failed:", e.message)
        await sock.sendMessage(from, {
          text: "⚠️ *Could not download the image.* Try sending it again and I'll take a look! 👀\n\n> ⚡ *CYBER X AI*",
          quoted: message
        })
        return
      }
    }

    const reply = await askGroq(from, text, imageBase64, imageMime)

    await sock.sendMessage(from, {
      text:   reply,
      quoted: message
    })

    await sock.sendMessage(from, {
      react: { text: "✅", key: message.key }
    }).catch(() => {})

  } catch (e) {
    console.error("[AI] Error:", e.message)

    await sock.sendMessage(from, {
      react: { text: "❌", key: message.key }
    }).catch(() => {})

    const friendly =
      e.message.includes("API_KEY")
        ? "❌ *GROQ_API_KEY not set!*\nAdd it to your .env file."
      : e.message.includes("429") || e.message.includes("rate") || e.message.includes("quota")
        ? "⚠️ *Too many requests.* Give me 30 seconds and try again! 😅"
      : e.message.includes("empty")
        ? "⚠️ *Hmm, I drew a blank on that one.* Try rephrasing your question?"
      : e.message.includes("timeout") || e.message.includes("destroyed")
        ? "⚠️ *That took too long and timed out.* Try again in a moment! ⏱️"
      : e.message.includes("vision") || e.message.includes("image")
        ? "⚠️ *Had trouble reading that image.* Try sending it again!"
        : `❌ *Error:* ${e.message}`

    await sock.sendMessage(from, {
      text: `${friendly}\n\n> ⚡ *CYBER X AI* — Engineered by Charles Tech`,
      quoted: message
    })
  }
}

module.exports = {
  name:     "ai",
  aliases:  ["ask", "chat", "gpt"],
  desc:     "Chat with CYBER X AI — text, images, code, anything",
  usage:    ".ai <question> | .ai reset | reply image + .ai",
  category: 'ai',
  run
}
