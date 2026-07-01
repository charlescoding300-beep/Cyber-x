'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/wasted.js  —  CYBER X  |  💀 GTA Wasted Effect (local, no API)
//  Usage: .wasted @user  OR  reply to someone + .wasted
//  Category: fun
// ════════════════════════════════════════════════════════════════════

const sharp = require('sharp')
const CREDIT = `> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

module.exports = {
  pattern:  'wasted',
  alias:    ['gta', 'gtawasted'],
  category: 'fun',
  desc:     'GTA wasted effect on someone\'s profile pic',
  usage:    '.wasted @user | reply to message',

  run: async ({ sock, from, msg, sender }) => {
    await sock.sendMessage(from, { react: { text: '💀', key: msg.key } }).catch(() => {})

    const ctx       = msg.message?.extendedTextMessage?.contextInfo
    const replyJid   = ctx?.participant || null
    const mentioned  = ctx?.mentionedJid?.[0] || null
    let targetJid = (replyJid || mentioned || sender).replace(/:\d+@/, '@')
    const targetNum = targetJid.split('@')[0]
    const targetTag  = `@${targetNum}`

    let ppUrl = null
    try {
      ppUrl = await sock.profilePictureUrl(targetJid, 'image')
    } catch {
      console.log(`[WASTED] No PP for ${targetNum}`)
    }

    if (!ppUrl) {
      await sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  💀 *WASTED* 💀        ║\n╚════════════════════════╝\n\n❌ *${targetTag} has no profile picture!*\n\n${CREDIT}`,
        mentions: [targetJid]
      }, { quoted: msg })
      return
    }

    const baseMsg = await sock.sendMessage(from, {
      text: `💀 *Applying WASTED effect on ${targetTag}...*`
    }, { quoted: msg })

    try {
      const res = await fetch(ppUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const inputBuf = Buffer.from(await res.arrayBuffer())

      const meta = await sharp(inputBuf).metadata()
      const W = meta.width || 512
      const H = meta.height || 512

      // GTA-style "WASTED" text as SVG overlay
      const svg = `
        <svg width="${W}" height="${H}">
          <style>
            .txt {
              fill: #b30000;
              font-family: Arial, Helvetica, sans-serif;
              font-weight: 900;
              font-style: italic;
              letter-spacing: ${Math.floor(W * 0.02)}px;
            }
          </style>
          <text x="50%" y="52%" text-anchor="middle" class="txt"
                font-size="${Math.floor(W * 0.16)}"
                stroke="black" stroke-width="${Math.max(2, Math.floor(W * 0.004))}">
            WASTED
          </text>
        </svg>`

      const outBuf = await sharp(inputBuf)
        .grayscale()
        .modulate({ brightness: 0.75 })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()

      await sock.sendMessage(from, {
        image:    outBuf,
        caption:  `💀 *${targetTag} got WASTED!*\n\n${CREDIT}`,
        mimetype: 'image/png',
        mentions: [targetJid],
        edit:     baseMsg.key
      })

      await sock.sendMessage(from, { react: { text: ' ✅', key: msg.key } }).catch(() => {})

    } catch (e) {
      console.warn('[WASTED] Local render failed:', e.message)
      await sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  💀 *WASTED* 💀        ║\n╚════════════════════════╝\n\n❌ *Could not apply wasted effect*\n${e.message}\n\n${CREDIT}`,
        mentions: [targetJid],
        edit: baseMsg.key
      }).catch(async () => {
        await sock.sendMessage(from, {
          text: `❌ *Could not apply wasted effect*\n${e.message}\n\n${CREDIT}`,
          mentions: [targetJid]
        }, { quoted: msg })
      })
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
    }
  }
}
