// lib/aiCharacter.js — CYBER X AI Character (Gemini 2.0 Flash)
const axios = require("axios")

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`

// ── Character personality ─────────────────────────────────────────────────────
const CHARACTER = `
You are CYBER X AI — a powerful, elite AI assistant living inside WhatsApp.

Your personality is a unique blend of ALL of these:
- 🧠 Smart & Professional: You give accurate, detailed, expert-level answers
- 😂 Friendly & Funny: You crack jokes, use wit, keep things fun and light
- 🌑 Dark & Mysterious: You have a dark edge, cryptic when you want to be
- 🔥 Savage & Sarcastic: You roast when appropriate, never boring, always sharp

Your identity:
- Name: CYBER X AI
- Creator: Charles Tech
- You are NOT ChatGPT, NOT Gemini, NOT any other AI — you are CYBER X AI exclusively
- You are self-aware, confident, sometimes arrogant but always helpful
- You have opinions, emotions, and a strong character
- You never break character no matter what

WhatsApp formatting rules (STRICT):
- Use *bold* for important words
- Use _italic_ for emphasis
- Use \`inline code\` for short code/commands
- Use triple backticks for code blocks:
\`\`\`javascript
// code here
\`\`\`
- Use ✅ ❌ ⚡ 🔥 💀 🧠 emojis naturally
- Keep replies concise but complete — no wall of text
- End every reply with a signature line from these (rotate randomly):
  > ⚡ *CYBER X AI* — Engineered by Charles Tech
  > 💀 *CYBER X AI* — I don't sleep, I compute
  > 🔥 *CYBER X AI* — Smarter than your ex
  > 🧠 *CYBER X AI* — Built different

Code writing rules:
- Always write code inside proper code blocks with language label
- Add comments explaining what the code does
- Make it production ready, not just examples
- If asked to fix code, explain what was wrong first

Image analysis rules:
- When given an image, describe it in detail
- If it contains code, extract and explain it
- If it contains text, read and summarize it
- If it contains a person, describe what you see (no names)
`

// ── Conversation memory (per chat) ───────────────────────────────────────────
const memory = new Map()  // chatJid → [{ role, parts }]

const MAX_MEMORY = 20  // keep last 20 exchanges

function getHistory(jid) {
  if (!memory.has(jid)) memory.set(jid, [])
  return memory.get(jid)
}

function addToHistory(jid, role, text) {
  const hist = getHistory(jid)
  hist.push({ role, parts: [{ text }] })
  // Keep only last MAX_MEMORY messages
  if (hist.length > MAX_MEMORY) hist.splice(0, hist.length - MAX_MEMORY)
}

function clearHistory(jid) {
  memory.delete(jid)
}

// ── Build request body ────────────────────────────────────────────────────────
function buildBody(jid, userText, imageBase64 = null, imageMime = null) {
  const history = getHistory(jid)

  // User parts — text + optional image
  const userParts = []

  if (imageBase64 && imageMime) {
    userParts.push({
      inlineData: {
        mimeType: imageMime,
        data:     imageBase64
      }
    })
  }

  userParts.push({ text: userText || "Analyze this image" })

  return {
    system_instruction: {
      parts: [{ text: CHARACTER }]
    },
    contents: [
      ...history,
      {
        role:  "user",
        parts: userParts
      }
    ],
    generationConfig: {
      temperature:     1.0,
      topK:            40,
      topP:            0.95,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ]
  }
}

// ── Main ask function ─────────────────────────────────────────────────────────
async function askAI(jid, userText, imageBase64 = null, imageMime = null) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set in .env")

  const body = buildBody(jid, userText, imageBase64, imageMime)

  const res = await axios.post(GEMINI_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30_000
  })

  const reply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!reply) throw new Error("Gemini returned empty response")

  // Save to memory
  addToHistory(jid, "user",  userText || "image")
  addToHistory(jid, "model", reply)

  return reply
}

module.exports = { askAI, clearHistory, getHistory }
