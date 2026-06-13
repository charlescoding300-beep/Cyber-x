'use strict'
/**
 * ⚡ CYBER X — sticker.js
 * Drop into: commands/sticker.js
 * Usage: reply to image / gif / video with  .s
 */

const { execFileSync } = require('child_process')
const { downloadMediaMessage, getContentType } = require('@whiskeysockets/baileys')
const fs     = require('fs')
const os     = require('os')
const path   = require('path')
const crypto = require('crypto')

// ── ffmpeg: try ffmpeg-static first, fall back to system ─────────────────────
function getFF() {
  try {
    const p = require('ffmpeg-static')
    if (p && fs.existsSync(p)) return p
  } catch (_) {}
  return 'ffmpeg'  // system (pkg install ffmpeg)
}

// ── Temp file helper ──────────────────────────────────────────────────────────
const tmp = ext => path.join(os.tmpdir(), `cyx_${crypto.randomBytes(4).toString('hex')}.${ext}`)

// ── WhatsApp Exif metadata (pack name + author in sticker tray) ──────────────
function exifBuf(packname, author) {
  const json    = JSON.stringify({
    'sticker-pack-id':        `com.cyberx.${Date.now()}`,
    'sticker-pack-name':      packname,
    'sticker-pack-publisher': author,
    'emojis':                 ['⚡','🤖','💻'],
  })
  const jb   = Buffer.from(json, 'utf8')
  const tiff = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00])
  const cnt  = Buffer.alloc(2);  cnt.writeUInt16LE(1, 0)
  const ent  = Buffer.alloc(12)
  ent.writeUInt16LE(0x010E, 0)
  ent.writeUInt16LE(2, 2)
  ent.writeUInt32LE(jb.length + 1, 4)
  ent.writeUInt32LE(26, 8)
  return Buffer.concat([tiff, cnt, ent, Buffer.alloc(4), jb, Buffer.alloc(1)])
}

function embedExif(webp, exif) {
  if (webp.slice(0,4).toString() !== 'RIFF') return webp
  const h = Buffer.alloc(8)
  h.write('EXIF', 0, 'ascii')
  h.writeUInt32LE(exif.length, 4)
  const pad = exif.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([webp.slice(0,12), h, exif, pad, webp.slice(12)])
}

// ── Convert ANY media → WebP sticker using ffmpeg ────────────────────────────
function toWebp(inputBuf, inputExt, isAnimated) {
  const ff  = getFF()
  const inF = tmp(inputExt)
  const out = tmp('webp')
  fs.writeFileSync(inF, inputBuf)
  try {
    const args = [
      '-y',
      ...(isAnimated ? ['-t','8'] : []),
      '-i', inF,
      '-vf', [
        'scale=512:512:force_original_aspect_ratio=decrease',
        'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000@0',
        ...(isAnimated ? ['fps=12'] : []),
      ].join(','),
      '-vcodec', 'libwebp',
      '-lossless', isAnimated ? '0' : '0',
      '-compression_level', '6',
      '-q:v', isAnimated ? '70' : '80',
      ...(isAnimated ? ['-loop','0','-an','-vsync','0'] : ['-vframes','1']),
      '-preset', 'picture',
      out,
    ]
    execFileSync(ff, args, { stdio: 'pipe', timeout: 30_000 })
    return fs.readFileSync(out)
  } finally {
    try { fs.unlinkSync(inF) } catch (_) {}
    try { fs.unlinkSync(out) } catch (_) {}
  }
}

// ── Mime → file extension map ─────────────────────────────────────────────────
const EXT = {
  'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
  'image/gif':'gif','video/mp4':'mp4','video/webm':'webm',
  'video/3gpp':'3gp','video/mpeg':'mpg',
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMMAND HANDLER
// ─────────────────────────────────────────────────────────────────────────────
const PACK   = '⚡ Cyber X'
const AUTHOR = '@CyberXBot'
const CMD    = '.s'

async function handler(sock, m) {
  const jid  = m.key.remoteJid
  const body = (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption || ''
  ).trim()

  if (!body.toLowerCase().startsWith(CMD)) return

  // ── Find quoted / replied-to message ───────────────────────────────────────
  const ctx   = m.message?.extendedTextMessage?.contextInfo
  const qmsg  = ctx?.quotedMessage
  const media = qmsg
    ? { key: { remoteJid: jid, id: ctx.stanzaId, participant: ctx.participant }, message: qmsg }
    : m   // direct (user sent image + caption .s)

  const ct  = getContentType(media.message)
  const obj = media.message[ct]

  const supported = ['imageMessage','videoMessage','stickerMessage','gifMessage']
  if (!supported.includes(ct)) {
    return sock.sendMessage(jid, {
      text: `┌─「 *⚡ Cyber X* 」\n│ Reply to an *image, gif or video*\n│ with *.s* to make a sticker!\n└────────────────`,
    }, { quoted: m })
  }

  // ── React immediately ───────────────────────────────────────────────────────
  await sock.sendMessage(jid, { react: { text: '📊', key: m.key } }).catch(() => {})

  const mime      = obj?.mimetype || 'image/jpeg'
  const isAnimated = ct === 'videoMessage' || mime === 'image/gif'
  const ext       = EXT[mime] || 'jpg'

  // ── Download ────────────────────────────────────────────────────────────────
  let buf
  try {
    buf = await downloadMediaMessage(media, 'buffer', {}, {
      logger: { debug(){}, info(){}, warn(){}, error: console.error },
      reuploadRequest: sock.updateMediaMessage,
    })
  } catch (e) {
    await sock.sendMessage(jid, { react: { text: '❌', key: m.key } }).catch(() => {})
    return sock.sendMessage(jid, { text: '❌ *Cyber X:* Download failed, try again.' }, { quoted: m })
  }

  // ── Convert → WebP ─────────────────────────────────────────────────────────
  let webp
  try {
    const raw  = toWebp(buf, ext, isAnimated)
    webp = embedExif(raw, exifBuf(PACK, AUTHOR))
  } catch (e) {
    await sock.sendMessage(jid, { react: { text: '❌', key: m.key } }).catch(() => {})
    return sock.sendMessage(jid, { text: `❌ *Cyber X:* Convert failed.\n\`${e.message.slice(0,80)}\`` }, { quoted: m })
  }

  // ── Send sticker ────────────────────────────────────────────────────────────
  await sock.sendMessage(jid, { sticker: webp }, { quoted: m })
  await sock.sendMessage(jid, { react: { text: '✅', key: m.key } }).catch(() => {})
}

// ── Export — adjust to match YOUR bot's loader format ────────────────────────
module.exports = { handler }
// If your bot uses:  module.exports = async (sock, m) => {}
// then change to:    module.exports = (sock, m) => handler(sock, m)
