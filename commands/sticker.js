'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/sticker.js  —  CYBER X  |  Image/Video → Sticker
//
// USAGE:
//   Reply to an image/video/gif → .s
//   Reply to an image/video/gif → .sticker
//   Send image/video with caption .s
//
// FEATURES:
//   - Static images AND animated (gif/video) → WebP sticker
//   - Multi-tier fallback compression for animated stickers that come out
//     too large (WhatsApp caps sticker size around ~1MB)
//   - Embeds CYBER X pack name + emoji into the sticker EXIF metadata
//   - Auto temp file cleanup, even on failure
// ─────────────────────────────────────────────────────────────────────────────

const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const { exec } = require('child_process')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')

let webp
try { webp = require('node-webpmux') } catch { webp = null }

const PACK_NAME   = process.env.BOT_NAME || 'CYBER X'
const PACK_EMOJI  = '👾'
const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => error ? reject(error) : resolve())
  })
}

function buildExif() {
  const json = {
    'sticker-pack-id':   crypto.randomBytes(16).toString('hex'),
    'sticker-pack-name': PACK_NAME,
    'emojis':            [PACK_EMOJI],
  }
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ])
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  const exif = Buffer.concat([exifAttr, jsonBuffer])
  exif.writeUIntLE(jsonBuffer.length, 14, 4)
  return exif
}

async function embedMetadata(webpBuffer) {
  if (!webp) return webpBuffer   // node-webpmux not installed — send without pack metadata
  try {
    const img = new webp.Image()
    await img.load(webpBuffer)
    img.exif = buildExif()
    return await img.save(null)
  } catch (e) {
    console.error('[STICKER] exif embed failed:', e.message)
    return webpBuffer
  }
}

module.exports = {
  pattern:  's',
  alias:    ['sticker'],
  desc:     'Convert image/video/gif to a sticker',
  usage:    'Reply to image/video → .s',
  category: 'media',

  async run({ sock, from, msg, quoted: ctxQuoted }) {
    // ── Resolve target media (quoted message OR the message itself) ────────────
    const ctx = msg.message?.extendedTextMessage?.contextInfo
    let targetMessage = msg

    if (ctx?.quotedMessage) {
      targetMessage = {
        key: {
          remoteJid:   from,
          id:          ctx.stanzaId,
          participant: ctx.participant,
        },
        message: ctx.quotedMessage,
      }
    }

    const mediaMessage =
      targetMessage.message?.imageMessage ||
      targetMessage.message?.videoMessage ||
      targetMessage.message?.documentMessage

    if (!mediaMessage) {
      return sock.sendMessage(from, {
        text: `↩️ Reply to an *image*, *video*, or *gif* with *.s*\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    await sock.sendMessage(from, { react: { text: '🗿', key: msg.key } }).catch(() => {})

    const tmpDir = path.join(__dirname, '..', 'temp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const id          = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const tempInput   = path.join(tmpDir, `in_${id}`)
    const tempOutput  = path.join(tmpDir, `out_${id}.webp`)
    const cleanupPaths = [tempInput, tempOutput]

    try {
      // ── Download media ─────────────────────────────────────────────────────
      const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
        logger: undefined,
        reuploadRequest: sock.updateMediaMessage,
      })

      if (!mediaBuffer?.length) {
        return sock.sendMessage(from, {
          text: `❌ Failed to download media. Try again.\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      fs.writeFileSync(tempInput, mediaBuffer)

      const isAnimated =
        mediaMessage.mimetype?.includes('gif') ||
        mediaMessage.mimetype?.includes('video') ||
        mediaMessage.seconds > 0

      // ── Convert to WebP ──────────────────────────────────────────────────────
      const baseCmd = isAnimated
        ? `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
        : `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`

      await run(baseCmd)

      let webpBuffer = fs.readFileSync(tempOutput)

      // ── Fallback tier 1: re-encode harder if animated sticker is too big ──────
      if (isAnimated && webpBuffer.length > 1000 * 1024) {
        const tempOutput2 = path.join(tmpDir, `fb1_${id}.webp`)
        cleanupPaths.push(tempOutput2)

        const fileSizeKB = mediaBuffer.length / 1024
        const isLargeFile = fileSizeKB > 5000

        const fallbackCmd = isLargeFile
          ? `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=8,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k -max_muxing_queue_size 1024 "${tempOutput2}"`
          : `ffmpeg -y -i "${tempInput}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 45 -compression_level 6 -b:v 150k -max_muxing_queue_size 1024 "${tempOutput2}"`

        try {
          await run(fallbackCmd)
          if (fs.existsSync(tempOutput2)) webpBuffer = fs.readFileSync(tempOutput2)
        } catch (e) {
          console.error('[STICKER] fallback tier 1 failed:', e.message)
        }
      }

      // ── Embed CYBER X pack metadata ─────────────────────────────────────────
      let finalBuffer = await embedMetadata(webpBuffer)

      // ── Fallback tier 2: still too large — shrink to 320px ───────────────────
      if (isAnimated && finalBuffer.length > 900 * 1024) {
        const tempOutput3 = path.join(tmpDir, `fb2_${id}.webp`)
        cleanupPaths.push(tempOutput3)

        const smallCmd = `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=320:320:force_original_aspect_ratio=decrease,fps=8,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 80k -max_muxing_queue_size 1024 "${tempOutput3}"`

        try {
          await run(smallCmd)
          if (fs.existsSync(tempOutput3)) {
            const smallWebp = fs.readFileSync(tempOutput3)
            finalBuffer = await embedMetadata(smallWebp)
          }
        } catch (e) {
          console.error('[STICKER] fallback tier 2 failed:', e.message)
        }
      }

      // ── Send the sticker ──────────────────────────────────────────────────────
      await sock.sendMessage(from, { sticker: finalBuffer }, { quoted: msg })

    } catch (e) {
      console.error('[STICKER]', e.message)
      await sock.sendMessage(from, {
        text: `❌ Failed to create sticker: ${e.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    } finally {
      // ── Always clean up temp files, success or failure ──────────────────────
      for (const p of cleanupPaths) {
        try { fs.unlinkSync(p) } catch {}
      }
    }
  },
}
