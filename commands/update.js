const axios = require("axios")

module.exports = {
  pattern: ".update",

  run: async ({ sock, from, msg }) => {

    const hook = process.env.RENDER_DEPLOY_HOOK

    if (!hook) {
      return sock.sendMessage(from, {
        text: "❌ RENDER_DEPLOY_HOOK not found in environment variables"
      }, { quoted: msg })
    }

    try {
      await sock.sendMessage(from, {
        text:
          "🚀 *𝘾𝙔𝘽𝙀𝙍 𝙓  UPDATE TRIGGERED*\n\n" +
          "⚡ Sending deploy request to Render...\n" +
          "⏳ Please wait..."
      }, { quoted: msg })

      const res = await axios.get(hook)

      await sock.sendMessage(from, {
        text:
          "✅ *UPDATE SUCCESSFUL*\n\n" +
          "🚀 𝘾𝙔𝘽𝙀𝙍 𝙓  has been redeployed on Render\n" +
          "⚡ Latest changes are now live"
      }, { quoted: msg })

    } catch (err) {
      await sock.sendMessage(from, {
        text:
          "❌ *UPDATE FAILED*\n\n" +
          "Reason: " + (err.response?.status || err.message)
      }, { quoted: msg })
    }
  }
}
