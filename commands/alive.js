'use strict'

const ZEN_X_CHANNEL_JID = '120363431058647261@newsletter'
const ZEN_X_CHANNEL_NAME = 'ZEN X'

function buildChannelContext() {
  return {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: ZEN_X_CHANNEL_JID,
      newsletterName: ZEN_X_CHANNEL_NAME,
      serverMessageId: -1,
    },
  }
}

function quoteLines(lines) {
  return lines.map(line => line.length ? `> *${line}*` : '>').join('\n')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  pattern: 'alive',
  alias: ['status'],
  desc: 'Check if bot is online',
  usage: '.alive',
  category: 'general',

  async run({ sock, from, msg }) {
    const uptime = process.uptime()
    const d = Math.floor(uptime / 86400)
    const h = Math.floor((uptime % 86400) / 3600)
    const m = Math.floor((uptime % 3600) / 60)
    const s = Math.floor(uptime % 60)
    const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(2)

    const start = Date.now()
    const sent = await sock.sendMessage(from, {
      text: quoteLines([
        '🔄 Pinging ZEN X...',
        '',
        '[░░░░░░░░░░] 0%',
      ]),
    }, { quoted: msg })
    const ping = Date.now() - start

    try {
      void sock.sendMessage(from, { react: { text: '🟢', key: msg.key } }).catch(() => {})
    } catch {}

    const frames = [
      '[██░░░░░░░░] 20%',
      '[████░░░░░░] 40%',
      '[██████░░░░] 60%',
      '[████████░░] 80%',
      '[██████████] 100%',
    ]

    const animateAndFinish = async () => {
      for (const frame of frames) {
        await delay(90)
        try {
          await sock.sendMessage(from, {
            text: quoteLines(['🔄 Pinging ZEN X...', '', frame]),
            edit: sent.key,
          })
        } catch {}
      }

      const lines = [
        '╭━━━『 *𝐙Ξ𝐍 𝐗* 』━━━╮',
        '┃',
        '┃  ✅  *STATUS:* Online',
        '┃  🟢  *Bot is Active!*',
        '┃',
        `┃  ⏱️  *Uptime:* ${d}d ${h}h ${m}m ${s}s`,
        `┃  📡  *Ping:* ${ping}ms`,
        `┃  💾  *RAM:* ${ram} MB`,
        `┃  🖥️  *Platform:* ${process.platform}`,
        `┃  🔧  *Node:* ${process.version}`,
        '┃',
        '╰━━━━━━━━━━━━━━━━━━╯',
        '',
        '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦',
        '_Type .menu to see all commands_',
      ]
      const text = quoteLines(lines)
      const contextInfo = buildChannelContext()

      try {
        await sock.sendMessage(from, { text, edit: sent.key, contextInfo })
      } catch {
        await sock.sendMessage(from, { text, contextInfo }, { quoted: msg })
      }
    }

    void animateAndFinish().catch(error => {
      console.error('[alive] Progress animation failed:', error.message)
    })

    // Return after the first quoted message so the command handler stays fast.
    return sent
  },
}
