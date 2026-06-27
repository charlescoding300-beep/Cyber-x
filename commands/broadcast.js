// commands/broadcast.js — CYBER X Broadcast Command
'use strict'

const CREDIT = `> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™ *All rights reserved*\n_Charles Tech broadcast_`

module.exports = {
  pattern:  'broadcast',
  alias:    ['bc'],
  desc:     'Broadcast a message to all connected WhatsApp sessions',
  usage:    '.broadcast <message>',
  category: 'owner',

  run: async ({ sock, from, msg, text, sender, isOwner, helper }) => {

    // ── Owner only ──
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ *Access Denied!*\nThis command is *OWNER ONLY*.\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Must have message ──
    if (!text || !text.trim()) {
      return sock.sendMessage(from, {
        text:
`📻 *CYBER X BROADCAST*

❌ *No message attached!*

*How to use:*
*.broadcast <your message>*

💡 *Example:*
_.broadcast Good morning everyone! 🌅_
_.broadcast Server maintenance in 10 mins ⚠️_
_.bc I haven't eaten ooooo 😭🤲🏻_

*How broadcast works:*
┌─────────────────────────
│ • Only owner can use this
│ • Sends to ALL connected sessions
│ • Each person gets it personally
│ • Delivery report sent back to you
└─────────────────────────

${CREDIT}`,
        quoted: msg
      })
    }

    const broadcastText = text.trim()
    const senderNum     = (sender || from).split('@')[0]

    // ── React immediately ──
    await sock.sendMessage(from, {
      react: { text: '📻', key: msg.key }
    }).catch(() => {})

    // ── Get all connected sessions ──
    let allBots = []
    try {
      allBots = global.__listBots ? global.__listBots() : []
    } catch {}

    // filter only connected ones
    const connected = allBots.filter(b => b.connected)
    const total     = connected.length

    if (total === 0) {
      return sock.sendMessage(from, {
        text: `⚠️ *No connected sessions found!*\nNo one to broadcast to right now.\n\n${CREDIT}`,
        quoted: msg
      })
    }

    // ── Notify owner broadcast is starting ──
    await sock.sendMessage(from, {
      text:
`📡 *Broadcasting...*
👥 *Sending to:* ${total} connected session(s)
⏳ Please wait...`,
      quoted: msg
    })

    // ── Build broadcast message ──
    const buildMessage = (recipientNum) =>
`@${senderNum} sent a message to everyone connected to *CYBER X BOT* 📢

┌─────────────────────────
│
│  ${broadcastText}
│
└─────────────────────────

${CREDIT}`

    // ── Send to all connected sessions ──
    let sent    = 0
    let failed  = 0
    const failedNums = []

    for (const bot of connected) {
      try {
        const recipientJid = `${bot.phone}@s.whatsapp.net`
        await sock.sendMessage(recipientJid, {
          text:     buildMessage(bot.phone),
          mentions: [`${senderNum}@s.whatsapp.net`],
        })
        sent++
        // small delay to avoid spam detection
        await new Promise(r => setTimeout(r, 500))
      } catch (e) {
        failed++
        failedNums.push(bot.phone)
        console.error(`[BROADCAST] ❌ Failed to send to ${bot.phone}:`, e.message)
      }
    }

    // ── Delivery report ──
    if (sent === total) {
      // ── All delivered ──
      await sock.sendMessage(from, {
        text:
`╔══════════════════════════════╗
║   📻 *BROADCAST DELIVERED!*  ║
╚══════════════════════════════╝

✅ *All sessions received your message!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *Broadcast Summary*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 *Message sent by:* @${senderNum}
👥 *Total sessions:*  ${total}
✅ *Delivered to:*    ${sent}/${total}
❌ *Failed:*          0
📊 *Success rate:*    100% 🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎉 *Every single session on CYBER X*
*has received your broadcast!* 

💬 *Message sent:*
_"${broadcastText}"_

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        mentions: [`${senderNum}@s.whatsapp.net`],
        quoted: msg
      })

    } else {
      // ── Partial delivery ──
      await sock.sendMessage(from, {
        text:
`╔══════════════════════════════╗
║   📻 *BROADCAST REPORT*      ║
╚══════════════════════════════╝

⚠️ *Partial delivery — some sessions missed*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *Broadcast Summary*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 *Message sent by:* @${senderNum}
👥 *Total sessions:*  ${total}
✅ *Delivered to:*    ${sent}/${total}
❌ *Failed:*          ${failed}
📊 *Success rate:*    ${Math.round((sent/total)*100)}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${failed > 0 ? `⚠️ *Failed sessions:*\n${failedNums.map(n => `• ${n}`).join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : ''}

💬 *Message sent:*
_"${broadcastText}"_

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        mentions: [`${senderNum}@s.whatsapp.net`],
        quoted: msg
      })
    }
  }
}
