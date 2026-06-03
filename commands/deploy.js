const axios = require("axios")

module.exports = {
  pattern: "deploy",

  run: async ({ sock, from, msg }) => {

    const hook = process.env.RENDER_DEPLOY_HOOK

    if (!hook) {
      return sock.sendMessage(
        from,
        { text: "❌ RENDER_DEPLOY_HOOK not set in .env" },
        { quoted: msg }
      )
    }

    try {
      await sock.sendMessage(
        from,
        {
          text: "🚀 CYBER X Deploying...\n⚡ Sending request to Render..."
        },
        { quoted: msg }
      )

      await axios.get(hook)

      await sock.sendMessage(
        from,
        {
          text: "✅ Deploy triggered successfully!\n🔁 Render is updating CYBER X now..."
        },
        { quoted: msg }
      )

    } catch (error) {
      await sock.sendMessage(
        from,
        {
          text: "❌ Deploy failed:\n" + error.message
        },
        { quoted: msg }
      )
    }
  }
}
