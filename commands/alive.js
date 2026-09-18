'use strict'

const ZEN_X_CHANNEL_JID  = '120363431058647261@newsletter'
const ZEN_X_CHANNEL_NAME = 'ZEN X'

function buildChannelContext() {
  return {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid:   ZEN_X_CHANNEL_JID,
      newsletterName:  ZEN_X_CHANNEL_NAME,
      serverMessageId: -1,
    },
  }
}

module.exports = {
  pattern:  "alive",
  alias:    ["status"],
  desc:     "Check if bot is online",
  usage:    ".alive",
  category: 'general',

  async run({ sock, from, msg }) {
    const uptime = process.uptime()
    const d = Math.floor(uptime / 86400)
    const h = Math.floor((uptime % 86400) / 3600)
    const m = Math.floor((uptime % 3600) / 60)
    const s = Math.floor(uptime % 60)
    const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(2)

    try {
      await sock.sendMessage(from, { react: { text: "🟢", key: msg.key } })
    } catch {}

    const start = Date.now()
    const sent = await sock.sendMessage(from, {
      text: "> 🔄 *Pinging ZEN X...*\n>\n> *[░░░░░░░░░░] 0%*"
    }, { quoted: msg })
    const ping = Date.now() - start

    const frames = [
      "[█░░░░░░░░░] 10%",
      "[██░░░░░░░░] 20%",
      "[███░░░░░░░] 30%",
      "[████░░░░░░] 40%",
      "[█████░░░░░] 50%",
      "[██████░░░░] 60%",
      "[███████░░░] 70%",
      "[████████░░] 80%",
      "[█████████░] 90%",
      "[██████████] 100%",
    ]

    for (const frame of frames) {
      await new Promise(r => setTimeout(r, 180))
      try {
        await sock.sendMessage(from, {
          text: `> 🔄 *Pinging ZEN X...*\n>\n> *${frame}*`,
          edit: sent.key
        })
      } catch {}
    }

    const lines = [
      "╭━━━『 *𝐙Ξ𝐍 𝐗* 』━━━╮",
      "┃",
      "┃  ✅  *STATUS:* Online",
      "┃  🟢  *Bot is Active!*",
      "┃",
      `┃  ⏱️  *Uptime:* ${d}d ${h}h ${m}m ${s}s`,
      `┃  📡  *Ping:* ${ping}ms`,
      `┃  💾  *RAM:* ${ram} MB`,
      `┃  🖥️  *Platform:* ${process.platform}`,
      `┃  🔧  *Node:* ${process.version}`,
      "┃",
      "╰━━━━━━━━━━━━━━━━━━╯",
      "",
      "© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦",
      "_Type .menu to see all commands_"
    ]

    // Every line gets the grey/bold WhatsApp quote treatment
    const text = lines
      .map(line => line.length ? `> *${line}*` : '>')
      .join('\n')

    const contextInfo = buildChannelContext()

    try {
      await sock.sendMessage(from, { text, edit: sent.key, contextInfo })
    } catch {
      await sock.sendMessage(from, { text, contextInfo }, { quoted: msg })
    }
  }
}
