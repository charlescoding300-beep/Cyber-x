'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/sticker.js  —  ZEN X  |  Image/Video → Sticker
//
// USAGE:
//   Reply to an image/video/gif → .s
//   Reply to an image/video/gif → .sticker
//   Send image/video with caption .s
//
// FEATURES:
//   - Static images AND animated (gif/video) → WebP sticker
//   - Always full 512x512 canvas (WhatsApp's max sticker dimension)
//   - Animated stickers use WhatsApp's max duration (10s) at a smooth 20 fps
//   - Quality ladder: if the result is too big, it lowers fps/quality FIRST and
//     only shortens the duration as a last resort, so stickers stay long + smooth
//   - Embeds ZEN X pack name + emoji into the sticker EXIF metadata
//   - Auto temp file cleanup, even on failure
//
// TUNING (edit the constants below):
//   MAX_SECONDS    → animation length cap (WhatsApp spec max is 10s)
//   MAX_ANIM_KB    → size target for animated stickers
//   MAX_STATIC_KB  → size target for static stickers
// ─────────────────────────────────────────────────────────────────────────────

const { downloadMediaMessage } = require('@whiskeysockets/baileys')
const { exec } = require('child_process')
const fs   = require('fs')
const path = require('path')
const crypto = require('crypto')

let webp
try { webp = require('node-webpmux') } catch { webp = null }

const PACK_NAME  = process.env.BOT_NAME || 'ZEN X'
const PACK_EMOJI = '👾'
const CREDIT     = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

// ── Limits ───────────────────────────────────────────────────────────────────
// WhatsApp's published sticker spec: 512x512, animated max 10s.
// Official pack limit for animated is 500 KB, but stickers sent directly in
// chat are accepted up to roughly 1 MB, so we aim just under that.
// If a sticker ever fails to send, lower MAX_ANIM_KB (try 500).
const MAX_SECONDS   = 10
const MAX_ANIM_KB   = 950
const MAX_STATIC_KB = 200

// Animated tiers: best quality first. Duration is kept at 10s as long as possible.
const ANIMATED_TIERS = [
  { seconds: MAX_SECONDS, fps: 20, quality: 80 },
  { seconds: MAX_SECONDS, fps: 15, quality: 70 },
  { seconds: MAX_SECONDS, fps: 15, quality: 55 },
  { seconds: 8,           fps: 15, quality: 50 },
  { seconds: 6,           fps: 12, quality: 45 },
  { seconds: 5,           fps: 10, quality: 40 },
  { seconds: 3,           fps: 10, quality: 30 },
]

// Static tiers: quality only
const STATIC_TIERS = [90, 80, 65, 50]

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 20 }, (error) => {
      error ? reject(error) : resolve()
    })
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

// ── ffmpeg command builders ──────────────────────────────────────────────────
const FIT = 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0'

function animatedCmd(input, output, { seconds, fps, quality }) {
  return `ffmpeg -y -i "${input}" -t ${seconds} -an ` +
    `-vf "fps=${fps},${FIT}" ` +
    `-c:v libwebp -lossless 0 -quality ${quality} -compression_level 6 -preset default ` +
    `-loop 0 -pix_fmt yuva420p -max_muxing_queue_size 1024 "${output}"`
}

function staticCmd(input, output, quality) {
  return `ffmpeg -y -i "${input}" -frames:v 1 -an ` +
    `-vf "${FIT}" ` +
    `-c:v libwebp -lossless 0 -quality ${quality} -compression_level 6 -preset default ` +
    `-pix_fmt yuva420p "${output}"`
}

module.exports = {
  pattern:  's',
  alias:    ['sticker'],
  desc:     'Convert image/video/gif to a sticker',
  usage:    'Reply to image/video → .s',
  category: 'sticker',

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

    const id           = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    const tempInput    = path.join(tmpDir, `in_${id}`)
    const cleanupPaths = [tempInput]

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

      let finalBuffer = null
      let smallest    = null   // best-effort fallback if no tier hits the size target

      if (isAnimated) {
        // ── Animated: walk the quality ladder until it fits ───────────────────
        const limit = MAX_ANIM_KB * 1024

        for (let i = 0; i < ANIMATED_TIERS.length; i++) {
          const tier = ANIMATED_TIERS[i]
          const out  = path.join(tmpDir, `out_${id}_${i}.webp`)
          cleanupPaths.push(out)

          try {
            await run(animatedCmd(tempInput, out, tier))
            if (!fs.existsSync(out)) continue

            const buf = await embedMetadata(fs.readFileSync(out))
            if (!smallest || buf.length < smallest.length) smallest = buf

            if (buf.length <= limit) { finalBuffer = buf; break }
          } catch (e) {
            console.error(`[STICKER] animated tier ${i + 1} failed:`, e.message)
          }
        }

        if (!finalBuffer) finalBuffer = smallest
      } else {
        // ── Static: single image, lower quality only if it is too large ───────
        const limit = MAX_STATIC_KB * 1024

        for (let i = 0; i < STATIC_TIERS.length; i++) {
          const out = path.join(tmpDir, `out_${id}_s${i}.webp`)
          cleanupPaths.push(out)

          try {
            await run(staticCmd(tempInput, out, STATIC_TIERS[i]))
            if (!fs.existsSync(out)) continue

            const buf = await embedMetadata(fs.readFileSync(out))
            if (!smallest || buf.length < smallest.length) smallest = buf

            if (buf.length <= limit) { finalBuffer = buf; break }
          } catch (e) {
            console.error(`[STICKER] static tier ${i + 1} failed:`, e.message)
          }
        }

        if (!finalBuffer) finalBuffer = smallest
      }

      if (!finalBuffer) throw new Error('conversion failed (is ffmpeg installed?)')

      // ── Send the sticker ──────────────────────────────────────────────────────
      await sock.sendMessage(from, { sticker: finalBuffer }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: '❤️', key: msg.key } }).catch(() => {})

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
