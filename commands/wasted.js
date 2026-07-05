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

    // Resolve the real JID via group metadata if we got a @lid instead of
    // a real number — profilePictureUrl() can hang for minutes on a @lid
    // it can't resolve, instead of failing fast.
    if (targetJid.endsWith('@lid')) {
      try {
        const gm = await sock.groupMetadata(from)
        const match = gm.participants.find(p => p.id === targetJid || p.lid === targetJid)
        if (match?.id && !match.id.endsWith('@lid')) {
          targetJid = match.id
        }
      } catch {
        console.log('[WASTED] groupMetadata lookup failed, using original JID')
      }
    }

    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ])

    let ppUrl = null
    try {
      ppUrl = await withTimeout(sock.profilePictureUrl(targetJid, 'image'), 8000)
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

    await sock.sendMessage(from, {
      text: `💀 *Applying WASTED effect on ${targetTag}...*`
    }, { quoted: msg })

    try {
      const res = await fetch(ppUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const inputBuf = Buffer.from(await res.arrayBuffer())

      const meta = await sharp(inputBuf).metadata()
      const W = meta.width || 512
      const H = meta.height || 512

      // GTA-style "wasted" text as SVG overlay — lowercase, bold red,
      // with a dark drop-shadow copy behind it (matches the in-game look)
      const fontSize  = Math.floor(W * 0.15)
      const shadowOff = Math.max(2, Math.floor(W * 0.01))
      const cx = W / 2
      const cy = H * 0.52
      const svg = `
        <svg width="${W}" height="${H}">
          <style>
            .txt {
              font-family: Arial, Helvetica, sans-serif;
              font-weight: 900;
              letter-spacing: ${Math.floor(W * 0.005)}px;
            }
          </style>
          <text x="${cx + shadowOff}" y="${cy + shadowOff}"
                text-anchor="middle" class="txt"
                font-size="${fontSize}" fill="#000000" opacity="0.55">
            wasted
          </text>
          <text x="${cx}" y="${cy}" text-anchor="middle" class="txt"
                font-size="${fontSize}" fill="#e0201a">
            wasted
          </text>
        </svg>`

      const outBuf = await sharp(inputBuf)
        .grayscale()
        .modulate({ brightness: 0.75 })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()

      // NOTE: send as a NEW message — do not try to `edit` a text message
      // into an image message, WhatsApp only supports text→text edits and
      // will hang the sendMessage promise forever if you try.
      await sock.sendMessage(from, {
        image:    outBuf,
        caption:  `💀 *${targetTag} got WASTED!*\n\n${CREDIT}`,
        mimetype: 'image/png',
        mentions: [targetJid]
      }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})

    } catch (e) {
      console.warn('[WASTED] Local render failed:', e.message)
      await sock.sendMessage(from, {
        text: `╔════════════════════════╗\n║  💀 *WASTED* 💀        ║\n╚════════════════════════╝\n\n❌ *Could not apply wasted effect*\n${e.message}\n\n${CREDIT}`,
        mentions: [targetJid]
      }, { quoted: msg }).catch(() => {})
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
    }
  }
}
