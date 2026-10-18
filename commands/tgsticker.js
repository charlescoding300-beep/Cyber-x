'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/tgsticker.js — ZEN X | .tgsticker <Telegram sticker link>  (alias: .tgs)
//                          bot owner only
//
//  .tgsticker https://t.me/addstickers/NameOfPack
//  .tgsticker NameOfPack
//
//  What it does:
//    • reads the sticker set through the Telegram Bot API (needs TELEGRAM_BOT_TOKEN)
//    • converts static (.webp) and video (.webm) stickers to WhatsApp stickers (512×512)
//    • rebrands each sticker: pack name "ZenX Sticker" padded with invisible characters to
//      WhatsApp's 128-character limit, so the name fills the space shown on the sticker
//    • skips animated .tgs stickers (they need Lottie rendering, which this bot does not have)
//    • sends the stickers to your DM, quoted to your command (max 30 per run, WhatsApp's pack limit)
//
//  Get a free bot token: open @BotFather on Telegram, send /newbot, then add
//    TELEGRAM_BOT_TOKEN=123456:ABC...   to .env
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const PACK_NAME = 'ZenX Sticker'
const PUBLISHER = 'ZenX Bot'
const FILLER = '\u3164'                 // Hangul filler: looks like empty space, counts as a character
const MAX_PACK_CHARS = 128              // WhatsApp's limit for pack name and publisher
const MAX_STICKERS = 30                 // WhatsApp's limit for one sticker pack
const SEND_GAP_MS = 700                 // pause between sends so WhatsApp does not throttle
const QUALITY_STEPS = [80, 60, 40, 25]  // lowered until the sticker fits WhatsApp's size limit
const LIMITS = { static: 100 * 1024, animated: 500 * 1024 }   // WhatsApp's per-sticker limits
const VIDEO_SECONDS = 6
const VIDEO_FPS = 15
const SCALE = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba'

// WhatsApp reads its sticker metadata from an EXIF block with this fixed header.
// The JSON starts at byte 22, and its length is stored at byte 14.
const EXIF_HEADER = Buffer.from([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
])

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── link → set name ──────────────────────────────────────────────────────────
function parseSetName(input) {
  const s = String(input || '').trim()
  const m = s.match(/t\.me\/(?:addstickers|addemoji)\/([A-Za-z0-9_]{1,64})/i)
  if (m) return m[1]
  if (/^[A-Za-z0-9_]{1,64}$/.test(s)) return s
  return null
}

// ── Telegram Bot API ─────────────────────────────────────────────────────────
async function tgCall(token, method, query) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}${query}`, { signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) throw new Error(data.description || `HTTP ${res.status}`)
  return data.result
}

async function tgDownload(token, filePath) {
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// ── conversion (ffmpeg) ──────────────────────────────────────────────────────
// animated stickers need ffmpeg's animated encoder (libwebp_anim); the still-image
// encoder (libwebp) is the fallback for servers that only have that one
async function ffmpegToWebp(input, output, animated, quality) {
  const head = ['-y', '-i', input]
  const vf = animated ? ['-t', String(VIDEO_SECONDS), '-vf', `fps=${VIDEO_FPS},${SCALE}`] : ['-vf', SCALE]
  const tail = ['-an', '-lossless', '0', '-q:v', String(quality), '-loop', '0', output]
  const encoders = animated ? ['libwebp_anim', 'libwebp'] : ['libwebp']
  let lastErr = null
  for (const encoder of encoders) {
    try {
      await execFileAsync('ffmpeg', [...head, ...vf, '-c:v', encoder, ...tail], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

// returns a WhatsApp-sized WebP, or throws if it can't be made small enough
async function makeWhatsAppWebp(srcBuf, ext, animated) {
  const id = crypto.randomBytes(6).toString('hex')
  const inPath = path.join(os.tmpdir(), `tgs-in-${id}.${ext}`)
  const outPath = path.join(os.tmpdir(), `tgs-out-${id}.webp`)
  try {
    await fs.promises.writeFile(inPath, srcBuf)
    const limit = animated ? LIMITS.animated : LIMITS.static
    for (const quality of QUALITY_STEPS) {
      await ffmpegToWebp(inPath, outPath, animated, quality)
      const out = await fs.promises.readFile(outPath)
      if (out.length <= limit) return out
    }
    throw new Error(`too large for WhatsApp (over ${Math.round(limit / 1024)} KB even at the lowest quality)`)
  } finally {
    await fs.promises.unlink(inPath).catch(() => {})
    await fs.promises.unlink(outPath).catch(() => {})
  }
}

// ── WhatsApp sticker metadata (EXIF inside the WebP) ─────────────────────────
const padded = text => text + FILLER.repeat(Math.max(0, MAX_PACK_CHARS - text.length))

function buildExif(meta) {
  const json = Buffer.from(JSON.stringify(meta), 'utf8')
  const exif = Buffer.concat([EXIF_HEADER, json])
  exif.writeUIntLE(json.length, 14, 4)
  return exif
}

// Adds an EXIF chunk to a WebP file (keeps everything else as it is).
function addExifToWebp(webp, exif) {
  if (webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP file')
  }
  const chunks = []
  let pos = 12
  while (pos + 8 <= webp.length) {
    const type = webp.toString('latin1', pos, pos + 4)
    const size = webp.readUInt32LE(pos + 4)
    chunks.push({ type, data: webp.subarray(pos + 8, pos + 8 + size) })
    pos += 8 + size + (size % 2)
  }

  // canvas size, from the VP8X chunk when it exists, otherwise from the image itself
  let width = 512, height = 512
  const vp8x = chunks.find(c => c.type === 'VP8X')
  const image = chunks.find(c => c.type === 'VP8 ' || c.type === 'VP8L' || c.type === 'ANIM')
  if (vp8x) {
    width = 1 + vp8x.data.readUIntLE(4, 3)
    height = 1 + vp8x.data.readUIntLE(7, 3)
  } else if (image?.type === 'VP8L') {
    const bits = image.data.readUInt32LE(1)
    width = (bits & 0x3fff) + 1
    height = ((bits >> 14) & 0x3fff) + 1
  } else if (image?.type === 'VP8 ') {
    width = image.data.readUInt16LE(6) & 0x3fff
    height = image.data.readUInt16LE(8) & 0x3fff
  }

  const flags = (vp8x ? vp8x.data[0] : 0) | 0x08      // 0x08 = "has EXIF"
  const vp8xData = Buffer.alloc(10)
  vp8xData[0] = flags
  vp8xData.writeUIntLE(width - 1, 4, 3)
  vp8xData.writeUIntLE(height - 1, 7, 3)

  const body = [{ type: 'VP8X', data: vp8xData }]
  for (const c of chunks) if (c.type !== 'VP8X' && c.type !== 'EXIF') body.push(c)
  body.push({ type: 'EXIF', data: exif })

  const parts = []
  for (const c of body) {
    const header = Buffer.alloc(8)
    header.write(c.type, 0, 4, 'latin1')
    header.writeUInt32LE(c.data.length, 4)
    parts.push(header, c.data)
    if (c.data.length % 2) parts.push(Buffer.alloc(1))
  }
  const payload = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 4, 'latin1')
  riff.writeUInt32LE(payload.length, 4)
  return Buffer.concat([riff, payload])
}

// ── the job ──────────────────────────────────────────────────────────────────
async function rebrandSet(sock, msg, dm, token, setName) {
  const set = await tgCall(token, 'getStickerSet', `?name=${encodeURIComponent(setName)}`)
  const all = Array.isArray(set.stickers) ? set.stickers : []
  if (!all.length) throw new Error('that sticker set is empty')
  const picked = all.slice(0, MAX_STICKERS)
  const packId = crypto.randomUUID()

  let sent = 0, animatedSkipped = 0
  const failed = []

  for (const s of picked) {
    if (s.is_animated) { animatedSkipped++; continue }
    try {
      const file = await tgCall(token, 'getFile', `?file_id=${encodeURIComponent(s.file_id)}`)
      const src = await tgDownload(token, file.file_path)
      const ext = path.extname(file.file_path).slice(1) || (s.is_video ? 'webm' : 'webp')
      const webp = await makeWhatsAppWebp(src, ext, !!s.is_video)
      const exif = buildExif({
        'sticker-pack-id': packId,
        'sticker-pack-name': padded(PACK_NAME),
        'sticker-pack-publisher': PUBLISHER,
        emojis: s.emoji ? [s.emoji] : [],
      })
      await sock.sendMessage(dm, { sticker: addExifToWebp(webp, exif) }, { quoted: msg })
      sent++
    } catch (e) {
      failed.push(e.message)
      console.warn(`[TGSTICKER] sticker failed: ${e.message}`)
    }
    await sleep(SEND_GAP_MS)
  }

  const lines = [
    `✅ *Sticker set rebranded*`,
    `📦 From: *${set.title || setName}*`,
    `🏷️ Pack name: *${PACK_NAME}*`,
    `📤 Sent: *${sent}* of ${picked.length}`,
  ]
  if (animatedSkipped) lines.push(`⏭️ Skipped animated (.tgs) stickers: ${animatedSkipped}`)
  if (all.length > MAX_STICKERS) lines.push(`ℹ️ The set has ${all.length} stickers. WhatsApp packs hold ${MAX_STICKERS}, so only the first ${MAX_STICKERS} were used.`)
  if (failed.length) lines.push(`⚠️ Failed: ${failed.length} (${failed[0]})`)
  return `${lines.join('\n')}\n\n${CREDIT}`
}

// ── the command ──────────────────────────────────────────────────────────────
module.exports = {
  name: 'tgsticker',
  aliases: ['tgs'],
  heavy: true,
  desc: 'Rebrand a Telegram sticker pack for WhatsApp and send it to your DM',
  usage: '.tgsticker <Telegram sticker link>',
  category: 'owner',

  _internals: { parseSetName, buildExif, addExifToWebp, padded, makeWhatsAppWebp, LIMITS, PACK_NAME, MAX_PACK_CHARS, FILLER, rebrandSet },

  run: async ({ sock, from, msg, args, text, isOwner }) => {
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}` }, { quoted: msg })

    if (!isOwner) return reply('❌ Only the bot owner can use this command.')

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      return reply('❌ No Telegram bot token set.\nGet a free one from @BotFather on Telegram (send /newbot), then add\n*TELEGRAM_BOT_TOKEN=...* to .env and restart the bot.')
    }

    const input = (Array.isArray(args) ? args.join(' ') : String(text || '')).trim()
    const setName = parseSetName(input)
    if (!setName) {
      return reply('❌ Send a Telegram sticker link.\nExample: *.tgsticker https://t.me/addstickers/NameOfPack*')
    }

    await reply('⏳ Rebranding that sticker set. The stickers will arrive here one by one.')
    try {
      const summary = await rebrandSet(sock, msg, from, token, setName)
      return sock.sendMessage(from, { text: summary }, { quoted: msg })
    } catch (e) {
      console.error('[TGSTICKER]', e.message)
      return reply(`❌ Could not read that sticker set.\nReason: ${e.message}`)
    }
  },
}