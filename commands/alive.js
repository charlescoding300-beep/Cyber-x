'use strict'

module.exports = {
  pattern: 'alive',
  alias: ['status'],
  desc: 'Check if bot is online',
  usage: '.alive',
  category: 'general',
  heavy: true,

  async run({ sock, from, msg }) {
    const uptime = process.uptime()
    const d = Math.floor(uptime / 86400)
    const h = Math.floor((uptime % 86400) / 3600)
    const m = Math.floor((uptime % 3600) / 60)
    const s = Math.floor(uptime % 60)
    const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(1)

    const lines = [
      '╭━━━『 *𝐙Ξ𝐍 𝐗* 』━━━╮',
      '┃',
      '┃  ✅  *STATUS:* Online',
      '┃  🟢  *Bot is Active!*',
      '┃',
      `┃  ⏱️  *Uptime:* ${d}d ${h}h ${m}m ${s}s`,
      `┃  💾  *RAM:* ${ram} MB`,
      `┃  🖥️  *Platform:* ${process.platform}`,
      `┃  🔧  *Node:* ${process.version}`,
      '┃',
      '╰━━━━━━━━━━━━━━━━━━╯',
      '',
      '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦',
      '_Type .menu to see all commands_'
    ]

    const text = lines.map(line => line.length ? `> *${line}*` : '>').join('\n')
    return sock.sendMessage(from, { text }, { quoted: msg })
  }
}
