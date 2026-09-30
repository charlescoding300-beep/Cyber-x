'use strict'
// 𓃦 𝗭Ξ𝗡 𝗫 — .toimg
//
// Reply to a sticker, video, or GIF with .toimg to extract a high-quality
// static image from it.
//
// Stickers (static or animated .webp) → first frame, converted to JPG.
// Videos / GIFs (WhatsApp GIFs are actually looping MP4s) → a frame
// grabbed a fraction of a second in, converted to JPG.

const fs   = require('fs')
const os   = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { downloadMediaMessage } = require('@whiskeysockets/baileys')

const execFileAsync = promisify(execFile)

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

function getQuotedMessage(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.stickerMessage?.contextInfo

  if (!ctx?.quotedMessage) return null

  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
  }
}

function detectMediaType(quotedMsg) {
  const m = quotedMsg.message
  if (m.stickerMessage) return 'sticker'
  if (m.videoMessage)   return 'video'   // covers both real videos AND WhatsApp "GIFs"
  if (m.imageMessage)   return 'image'
  return null
}

async function toJpegViaFfmpeg(inputBuffer, inputExt, isVideo) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zenx-toimg-'))
  const inputPath  = path.join(workDir, `in.${inputExt}`)
  const outputPath = path.join(workDir, 'out.jpg')

  try {
    fs.writeFileSync(inputPath, inputBuffer)

    const args = isVideo
      ? ['-y', '-ss', '0.3', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outputPath]
      : ['-y', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outputPath]

    await execFileAsync('ffmpeg', args, { timeout: 30000 })

    if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output')
    return fs.readFileSync(outputPath)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

module.exports = {
  pattern:  'toimg',
  alias:    ['toimage', 'stickertoimg'],
  desc:     'Convert a replied sticker, video, or GIF into a static image',
  usage:    'Reply to a sticker/video/GIF with .toimg',
  category: 'converter',

  run: async ({ sock, from, msg }) => {
    const quotedMsg = getQuotedMessage(msg)

    if (!quotedMsg) {
      return sock.sendMessage(from, {
        text:
`> ❌ *NO MEDIA FOUND*
>
> Reply to a *sticker*, *video*, or *GIF* with *.toimg*.
>
${CREDIT}`,
        quoted: msg,
      })
    }

    const mediaType = detectMediaType(quotedMsg)

    if (!mediaType || mediaType === 'image') {
      return sock.sendMessage(from, {
        text:
`> ❌ *UNSUPPORTED MEDIA*
>
> *.toimg* works on stickers, videos, and GIFs — not on plain images.
>
${CREDIT}`,
        quoted: msg,
      })
    }

    await sock.sendMessage(from, { react: { text: '🖼️', key: msg.key } }).catch(() => {})

    try {
      const mediaBuffer = await downloadMediaMessage(
        quotedMsg,
        'buffer',
        {},
        { logger: console, reuploadRequest: sock.updateMediaMessage }
      )

      const isVideo = mediaType === 'video'
      const inputExt = mediaType === 'sticker' ? 'webp' : 'mp4'

      const jpegBuffer = await toJpegViaFfmpeg(mediaBuffer, inputExt, isVideo)

      await sock.sendMessage(from, {
        image: jpegBuffer,
        caption: `> ✅ *Converted to image*\n>\n${CREDIT}`,
      }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})

    } catch (error) {
      console.error('[TOIMG ERROR]', error?.message || error)
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(from, {
        text:
`> ❌ *CONVERSION FAILED*
>
> ${error?.message || 'Could not convert that media to an image.'}
>
${CREDIT}`,
        quoted: msg,
      }).catch(() => {})
    }
  },
}
