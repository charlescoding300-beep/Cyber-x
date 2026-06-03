const axios = require("axios")

module.exports = {
  pattern: ".ai",

  run: async ({ sock, from, msg, sender, args }) => {

    const text = args.join(" ")
    if (!text) {
      return sock.sendMessage(from, {
        text: "❌ Give me something to respond to.\nExample: .ai hello"
      }, { quoted: msg })
    }

    try {

      await sock.sendPresenceUpdate("composing", from)

      const prompt = `
You are CYBER X AI.
You behave like a highly intelligent GPT-5.5 level assistant.

Rules:
- Be smart, direct, helpful
- No long unnecessary text
- No repetition
- Act like a powerful AI system inside WhatsApp
- Respond naturally like ChatGPT

User: ${text}
`

      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        }
      )

      const reply =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "I couldn't generate a response."

      await sock.sendMessage(from, {
        text: `🤖 *CYBER X AI*\n\n${reply}\n\n> © CYBER X`
      }, { quoted: msg })

    } catch (e) {
      console.log("AI ERROR:", e.message)

      await sock.sendMessage(from, {
        text: "⚠️ AI error occurred. Try again later."
      }, { quoted: msg })
    }
  }
}
