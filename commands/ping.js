// commands/ping.js — ZEN X Ping
'use strict'

module.exports = {
  pattern: "ping",

  run: async ({ sock, from, msg }) => {
    await sock.sendMessage(from, { react: { text: "🇺🇸", key: msg.key } }).catch(() => {})

    // Real latency: gap between when WhatsApp stamped the message and
    // right now — not a fabricated/estimated split.
    const msgTimestampMs = (msg.messageTimestamp || 0) * 1000
    const latency = msgTimestampMs ? Date.now() - msgTimestampMs : 0

    const text = `> 🎾 *𝙋𝙊𝙉𝙂: ${latency}ms*`

    await sock.sendMessage(from, { text }, { quoted: msg })
  }
}
