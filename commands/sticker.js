'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// commands/sticker.js  —  ZEN X  |  Image/Video → Sticker
//
// USAGE:
//   Reply to an image/video/gif → .s
//   Reply to an image/video/gif → .sticker
//   Send image/video with caption .s
//
// WHAT'S NEW IN THIS VERSION
//   FIX "fetch failed":
//   - Forces IPv4-first DNS (VPS with broken IPv6 is the #1 cause)
//   - Download now has 4 strategies with delays (normal → retry → stream →
//     refresh media URL → download), instead of failing on the first error
//   - The REAL network reason (e.cause) is logged and shown, not just
//     the useless "fetch failed"
//   FIX lag:
//   - Max 2 conversions at once (extra ones queue instead of choking the VPS)
//   - ffmpeg runs at low priority (nice) so the bot itself stays responsive
//   - ffmpeg only reads the first N seconds (-t before -i)
//   - Starts at a lighter tier for big input files, skips tiers when the
//     result is far too big, and only writes EXIF once (on the winner)
//   - Faster libwebp compression_level (4)
//
// TUNING (constants below):
//   MAX_SECONDS / MAX_ANIM_KB / MAX_STATIC_KB / MAX_PARALLEL
// ─────────────────────────────────────────────────────────────────────────────

// Many VPS have no working IPv6 route; Node's fetch then dies with "fetch failed"
try { require('dns').setDefaultResultOrder('ipv4first') } catch {}

const baileys = require('@whiskeysockets/baileys')
const { downloadMediaMessage, downloadContentFromMessage } = baileys
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
const MAX_SECONDS    = 10     // WhatsApp's max animated sticker length
const MAX_ANIM_KB    = 950    // size target for animated (lower to 500 if sends fail)
const MAX_STATIC_KB  = 200    // size target for static
const MAX_PARALLEL   = 2      // simultaneous conversions (extra ones wait in line)
const EXIF_ALLOWANCE = 4 * 1024
const FFMPEG_TIMEOUT = 90000  // per ffmpeg run

// Run ffmpeg at low priority so the bot never freezes while converting
const NICE = process.platform === 'win32' ? '' : 'nice -n 10 '

// Animated tiers, best first. Duration is kept at 10s as long as possible.
const ANIMATED_TIERS = [
  { seconds: MAX_SECONDS, fps: 20, quality: 75 },
  { seconds: MAX_SECONDS, fps: 15, quality: 60 },
  { seconds: 8,           fps: 15, quality: 50 },
  { seconds: 6,           fps: 12, quality: 45 },
  { seconds: 4,           fps: 10, quality: 35 },
]

const STATIC_TIERS = [90, 75, 55]

// ── Small helpers ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Node's "fetch failed" hides the real reason inside e.cause — surface it
function describeError(e) {
  const cause  = e?.cause
  const detail = cause ? (cause.code || cause.message || String(cause)) : ''
  const base   = e?.message || String(e)
  return detail ? `${base} (${detail})` : base
}

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: FFMPEG_TIMEOUT, maxBuffer: 1024 * 1024 * 20 }, (error) => {
      error ? reject(error) : resolve()
    })
  })
}

// Tiny semaphore: at most MAX_PARALLEL conversions at once
let _active = 0
const _waiting = []
function acquire() {
  return new Promise((resolve) => {
    if (_active < MAX_PARALLEL) { _active++; resolve() }
    else _waiting.push(resolve)
  })
}
function release() {
  const next = _waiting.shift()
  if (next) next()        // hand the slot straight to the next in line
  else _active--
}

// ── EXIF / pack metadata ─────────────────────────────────────────────────────

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

// ── Media download with multiple strategies ──────────────────────────────────

function mediaTypeOf(targetMessage) {
  const m = targetMessage?.message || {}
  if (m.imageMessage)    return 'image'
  if (m.videoMessage)    return 'video'
  if (m.documentMessage) return 'document'
  return null
}

async function streamDownload(mediaMessage, type) {
  const stream = await downloadContentFromMessage(mediaMessage, type)
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks)
}

async function downloadMedia(sock, targetMessage, mediaMessage) {
  const type = mediaTypeOf(targetMessage)

  const normal = () =>
    downloadMediaMessage(targetMessage, 'buffer', {}, {
      logger: undefined,
      reuploadRequest: sock.updateMediaMessage,
    })

  const attempts = [
    { name: 'download',          delay: 0,    fn: normal },
    { name: 'download (retry)',  delay: 1500, fn: normal },
  ]

  if (typeof downloadContentFromMessage === 'function' && type) {
    attempts.push({ name: 'stream download', delay: 1000, fn: () => streamDownload(mediaMessage, type) })
  }

  if (typeof sock.updateMediaMessage === 'function') {
    attempts.push({
      name: 'refresh URL + download',
      delay: 1500,
      fn: async () => {
        const fresh = await sock.updateMediaMessage(targetMessage)
        return downloadMediaMessage(fresh || targetMessage, 'buffer', {}, {
          logger: undefined,
          reuploadRequest: sock.updateMediaMessage,
        })
      },
    })
  }

  let lastErr
  for (const a of attempts) {
    if (a.delay) await sleep(a.delay)
    try {
      const buf = await a.fn()
      if (buf?.length) return buf
      throw new Error('empty download')
    } catch (e) {
      lastErr = e
      console.error(`[STICKER] ${a.name} failed:`, describeError(e))
    }
  }
  throw lastErr
}

// ── ffmpeg command builders ──────────────────────────────────────────────────

const FIT = 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0'

// -t BEFORE -i = ffmpeg only reads the first N seconds (much faster on long videos)
function animatedCmd(input, output, { seconds, fps, quality }) {
  return `${NICE}ffmpeg -y -hide_banner -loglevel error -t ${seconds} -i "${input}" -an ` +
    `-vf "fps=${fps},${FIT}" ` +
    `-c:v libwebp -lossless 0 -quality ${quality} -compression_level 4 -preset default ` +
    `-loop 0 -pix_fmt yuva420p "${output}"`
}

function staticCmd(input, output, quality) {
  return `${NICE}ffmpeg -y -hide_banner -loglevel error -i "${input}" -frames:v 1 -an ` +
    `-vf "${FIT}" ` +
    `-c:v libwebp -lossless 0 -quality ${quality} -compression_level 4 -preset default ` +
    `-pix_fmt yuva420p "${output}"`
}

// ── Conversion (runs inside the queue) ───────────────────────────────────────

async function convert({ isAnimated, tempInput, tmpDir, id, inputBytes, cleanupPaths }) {
  let winner = null
  let smallest = null

  if (isAnimated) {
    const limit = MAX_ANIM_KB * 1024 - EXIF_ALLOWANCE
    const sizeMB = inputBytes / (1024 * 1024)

    // Big source files start on a lighter tier instead of wasting a slow first pass
    let start = 0
    if (sizeMB > 15) start = 2
    else if (sizeMB > 6) start = 1

    for (let i = start; i < ANIMATED_TIERS.length; i++) {
      const out = path.join(tmpDir, `out_${id}_${i}.webp`)
      cleanupPaths.push(out)

      try {
        await run(animatedCmd(tempInput, out, ANIMATED_TIERS[i]))
        if (!fs.existsSync(out)) continue

        let raw
        try { raw = await fs.promises.readFile(out) } catch { continue }
        if (!smallest || raw.length < smallest.length) smallest = raw

        if (raw.length <= limit) { winner = raw; break }
        if (raw.length > limit * 2.2) i++      // far too big → skip a tier
      } catch (e) {
        console.error(`[STICKER] animated tier ${i + 1} failed:`, describeError(e))
      }
    }
  } else {
    const limit = MAX_STATIC_KB * 1024 - EXIF_ALLOWANCE

    for (let i = 0; i < STATIC_TIERS.length; i++) {
      const out = path.join(tmpDir, `out_${id}_s${i}.webp`)
      cleanupPaths.push(out)

      try {
        await run(staticCmd(tempInput, out, STATIC_TIERS[i]))
        if (!fs.existsSync(out)) continue

        let raw
        try { raw = await fs.promises.readFile(out) } catch { continue }
        if (!smallest || raw.length < smallest.length) smallest = raw

        if (raw.length <= limit) { winner = raw; break }
      } catch (e) {
        console.error(`[STICKER] static tier ${i + 1} failed:`, describeError(e))
      }
    }
  }

  const pick = winner || smallest
  if (!pick) throw new Error('conversion failed (is ffmpeg installed?)')

  // EXIF is written once, on the final pick only
  return embedMetadata(pick)
}

// ── Command ──────────────────────────────────────────────────────────────────

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
      // ── Download media (4 strategies, real error reason on failure) ────────
      let mediaBuffer
      try {
        mediaBuffer = await downloadMedia(sock, targetMessage, mediaMessage)
      } catch (e) {
        console.error('[STICKER] all download strategies failed:', describeError(e))
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
        return sock.sendMessage(from, {
          text:
            `❌ Couldn't download that media.\n` +
            `Reason: ${describeError(e)}\n\n` +
            `Please resend the image/video and try again.\n\n${CREDIT}`,
        }, { quoted: msg })
      }

      await fs.promises.writeFile(tempInput, mediaBuffer)

      const isAnimated =
        mediaMessage.mimetype?.includes('gif') ||
        mediaMessage.mimetype?.includes('video') ||
        mediaMessage.seconds > 0

      // ── Convert (queued so many requests can't choke the VPS) ──────────────
      await acquire()
      let finalBuffer
      try {
        finalBuffer = await convert({
          isAnimated,
          tempInput,
          tmpDir,
          id,
          inputBytes: mediaBuffer.length,
          cleanupPaths,
        })
      } finally {
        release()
      }

      // ── Send the sticker ──────────────────────────────────────────────────────
      await sock.sendMessage(from, { sticker: finalBuffer }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: '❤️', key: msg.key } }).catch(() => {})

    } catch (e) {
      console.error('[STICKER]', describeError(e))
      await sock.sendMessage(from, {
        text: `❌ Failed to create sticker: ${describeError(e)}\n\n${CREDIT}`,
      }, { quoted: msg })
    } finally {
      // ── Always clean up temp files, success or failure ──────────────────────
      for (const p of cleanupPaths) {
        await fs.promises.unlink(p).catch(() => {})
      }
    }
  },
}
