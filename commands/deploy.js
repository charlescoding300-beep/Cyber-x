const axios = require("axios")

module.exports = {
  pattern: "deploy",

  run: async ({ sock, from, isOwner, msg }) => {

    // OWNER ONLY CHECK
    if (!isOwner) {
      return sock.sendMessage(
        from,
        { text: "🚫 Access denied. Owner only command." },
        { quoted: msg }
      )
    }

    const hook = process.env.RENDER_DEPLOY_HOOK

    if (!hook) {
      return sock.sendMessage(
        from,
        { text: "❌ RENDER_DEPLOY_HOOK not set in .env" },
        { quoted: msg }
      )
    }

    try {
      // START MESSAGE (QUOTED REPLY)
      await sock.sendMessage(
        from,
        {
          text: "🚀 CYBER X Deploying...\n⚡ Sending request to Render..."
        },
        { quoted: msg }
      )

      // TRIGGER RENDER DEPLOY
      await axios.get(hook)

      // SUCCESS MESSAGE (QUOTED REPLY)
      await sock.sendMessage(
        from,
        {
          text: "✅ Deploy triggered successfully!\n🔁 Render is updating CYBER X now..."
        },
        { quoted: msg }
      )

    } catch (error) {

      // ERROR MESSAGE (QUOTED REPLY)
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
