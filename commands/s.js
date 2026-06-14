// ─────────────────────────────────────────────────────────────────────────────
// commands/s.js  —  CYBER X  |  Sticker Maker
//
// Works on BOTH:
//   • Render / Linux x64  → uses wa-sticker-formatter (sharp works fine)
//   • Termux / Android    → uses ffmpeg directly (no sharp needed)
//
// Auto-detects which method to use — zero config needed
//
// RENDER:  npm install   (wa-sticker-formatter installs fine on Linux x64)
// TERMUX:  pkg install ffmpeg libwebp
//
// USAGE: Reply to any image / GIF / video → type .s
// ─────────────────────────────────────────────────────────────────────────────

const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const { spawnSync }            = require("child_process")
const fs                       = require("fs")
const path                     = require("path")
const os                       = require("os")

// ── Auto-detect: try wa-sticker-formatter (Render/Linux), fall back to ffmpeg (Termux) ──
let Sticker      = null
let StickerTypes = null
let USE_WSF      = false

try {
  const wsf    = require("wa-sticker-formatter")
  Sticker      = wsf.Sticker
  StickerTypes = wsf.StickerTypes
  USE_WSF      = true
  console.log("[STICKER] ✔ Using wa-sticker-formatter (Render/Linux mode)")
} catch {
  USE_WSF = false
  console.log("[STICKER] ✔ Using ffmpeg fallback (Termux/Android mode)")
}

// ─────────────────────────────────────────────────────────────────────────────
// STICKER METADATA
// Pack name   : CYBER X + 50 invisible chars (creates gap above WhatsApp options)
// Author line : invisible (blank — nothing shows on second line)
// Emoji       : 👾
// ─────────────────────────────────────────────────────────────────────────────

const INVISIBLE_50 = [
  "\u200B","\u200C","\u200D","\uFEFF","\u2060",
  "\u2061","\u2062","\u2063","\u2064","\u2065",
  "\u206A","\u206B","\u206C","\u206D","\u206E",
  "\u206F","\u180E","\u00AD","\u034F","\u1160",
  "\uFFA0","\u115F","\u3164","\u2800","\u200E",
  "\u200F","\u202A","\u202B","\u202C","\u202D",
  "\u202E","\u2066","\u2067","\u2068","\u2069",
  "\u200B","\u200C","\u200D","\uFEFF","\u2060",
  "\u2061","\u2062","\u2063","\u2064","\u2065",
  "\u206A","\u206B","\u206C","\u206D","\u206E",
].join("")

const PACK_NAME   = "CYBER X" + INVISIBLE_50
const PACK_AUTHOR = "\u200B\u200C\u200D\uFEFF\u2060\u2061\u2062\u2063"
const PACK_EMOJI  = "👾"

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_BYTES = 10 * 1024 * 1024   // 10 MB — trim video to 9s, never reject

// ── Temp dir ──────────────────────────────────────────────────────────────────
const TMP = path.join(os.tmpdir(), "cyberx_stickers")
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// EXIF builder — embeds pack name, author, emoji into WebP metadata
// WhatsApp reads this to show pack name and emoji in sticker tray
// ─────────────────────────────────────────────────────────────────────────────
function buildExif(packName, author, emoji) {
  const json    = JSON.stringify({
    "sticker-pack-name":      packName,
    "sticker-pack-publisher": author,
    "emojis":                 [emoji],
    "android-app-store-link": "",
    "ios-app-store-link":     "",
  })
  const jsonBuf = Buffer.from(json, "utf8")
  const exifBuf = Buffer.alloc(jsonBuf.length + 28)

  exifBuf.write("Exif\0\0", 0, "ascii")
  exifBuf.write("II",       6, "ascii")
  exifBuf.writeUInt16LE(42,        8)
  exifBuf.writeUInt32LE(8,        10)
  exifBuf.writeUInt16LE(1,        14)
  exifBuf.writeUInt16LE(0x010e,   16)
  exifBuf.writeUInt16LE(2,        18)
  exifBuf.writeUInt32LE(jsonBuf.length, 20)
  exifBuf.writeUInt32LE(28,       24)
  jsonBuf.copy(exifBuf, 28)

  return exifBuf
}

function embedExif(webpBuf, exifBuf) {
  const exifChunk = Buffer.concat([
    Buffer.from("EXIF", "ascii"),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(exifBuf.length, 0); return b })(),
    exifBuf,
  ])
  const newPayload = Buffer.concat([webpBuf.slice(8), exifChunk])
  const newSize    = Buffer.alloc(4)
  newSize.writeUInt32LE(newPayload.length + 4, 0)
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    newSize,
    Buffer.from("WEBP", "ascii"),
    newPayload.slice(4),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// FFMPEG CONVERTER — Termux fallback
// Always trims video to 9s max, scales to 512x512, smooth 15fps animation
// ─────────────────────────────────────────────────────────────────────────────
async function toWebPviaFFmpeg(inputBuf, isAnimated) {
  const id  = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const inp = path.join(TMP, `inp_${id}`)
  const out = path.join(TMP, `out_${id}.webp`)

  fs.writeFileSync(inp, inputBuf)

  try {
    if (isAnimated) {
      const r = spawnSync("ffmpeg", [
        "-y",
        "-i",       inp,
        "-t",       "9",
        "-vf",      "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15",
        "-vcodec",  "libwebp",
        "-lossless","0",
        "-q:v",     "80",
        "-loop",    "0",
        "-preset",  "picture",
        "-an",
        "-vsync",   "0",
        out,
      ], { timeout: 60000 })

      if (r.status !== 0) throw new Error(r.stderr?.toString() || "ffmpeg failed")

    } else {
      // Static image → PNG → cwebp (or ffmpeg fallback)
      const png = path.join(TMP, `out_${id}.png`)

      spawnSync("ffmpeg", [
        "-y", "-i", inp,
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-frames:v", "1", png,
      ], { timeout: 30000 })

      const r2 = spawnSync("cwebp", ["-q", "90", png, "-o", out], { timeout: 30000 })

      try { fs.unlinkSync(png) } catch {}

      if (r2.status !== 0) {
        // cwebp failed — use ffmpeg static webp directly
        const r3 = spawnSync("ffmpeg", [
          "-y", "-i", inp,
          "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
          "-frames:v", "1",
          "-vcodec", "libwebp", "-lossless", "0", "-q:v", "90",
          out,
        ], { timeout: 30000 })

        if (r3.status !== 0) throw new Error("ffmpeg static conversion failed")
      }
    }

    return fs.readFileSync(out)

  } finally {
    try { fs.unlinkSync(inp) } catch {}
    try { fs.unlinkSync(out) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE COMMAND
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  pattern:  "s",
  desc:     "Convert image / GIF / video to WhatsApp sticker",
  usage:    "Reply to image, GIF or video → .s",
  category: "media",

  async run({ sock, from, msg }) {

    // ── Must reply to media ───────────────────────────────────────────────────
    const ctx    = msg.message?.extendedTextMessage?.contextInfo
    const quoted = ctx?.quotedMessage

    if (!quoted) {
      return sock.sendMessage(from, {
        text: "↩️ Reply to an *image*, *GIF*, or *video* and type *.s*",
      }, { quoted: msg })
    }

    const isImage   = !!quoted.imageMessage
    const isVideo   = !!quoted.videoMessage
    const isGif     = isVideo && quoted.videoMessage?.gifPlayback === true
    const isSticker = !!quoted.stickerMessage

    if (!isImage && !isVideo && !isSticker) {
      return sock.sendMessage(from, {
        text: "❌ Only *images*, *GIFs*, and *videos* can be converted to stickers.",
      }, { quoted: msg })
    }

    // ── File size guard ───────────────────────────────────────────────────────
    const fileSize = Number(
      quoted.imageMessage?.fileLength   ||
      quoted.videoMessage?.fileLength   ||
      quoted.stickerMessage?.fileLength ||
      0
    )
    if (fileSize > MAX_BYTES) {
      return sock.sendMessage(from, {
        text: "❌ File too large (max 10 MB).",
      }, { quoted: msg })
    }

    // ── Videos longer than 9s → trimmed automatically, never rejected ─────────

    // ── React instantly 👾 ────────────────────────────────────────────────────
    try {
      await sock.sendMessage(from, {
        react: { text: "👾", key: msg.key }
      })
    } catch {}

    // ── Download quoted media ─────────────────────────────────────────────────
    const fakeMsg = {
      key: {
        remoteJid:   from,
        fromMe:      false,
        id:          ctx.stanzaId,
        participant: ctx.participant,
      },
      message: quoted,
    }

    let mediaBuf
    try {
      mediaBuf = await downloadMediaMessage(fakeMsg, "buffer", {}, {
        logger: {
          level: "silent",
          info:  () => {}, warn:  () => {}, error: () => {},
          child: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
        },
        reuploadRequest: sock.updateMediaMessage,
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Download failed: ${e.message}`,
      }, { quoted: msg })
    }

    if (!mediaBuf?.length) {
      return sock.sendMessage(from, {
        text: "❌ Could not read media. Try again.",
      }, { quoted: msg })
    }

    // ── Convert to sticker ────────────────────────────────────────────────────
    const animated = isVideo || isGif
    let finalBuf

    try {
      if (USE_WSF && Sticker) {
        // ── RENDER / LINUX x64 — wa-sticker-formatter ─────────────────────
        const sticker = new Sticker(mediaBuf, {
          pack:       PACK_NAME,
          author:     PACK_AUTHOR,
          type:       StickerTypes.FULL,
          categories: [PACK_EMOJI],
          quality:    100,
          background: "transparent",
        })
        finalBuf = await sticker.toBuffer()

      } else {
        // ── TERMUX / ANDROID — pure ffmpeg ────────────────────────────────
        const webpBuf = await toWebPviaFFmpeg(mediaBuf, animated)
        try {
          const exif = buildExif(PACK_NAME, PACK_AUTHOR, PACK_EMOJI)
          finalBuf   = embedExif(webpBuf, exif)
        } catch {
          finalBuf = webpBuf
        }
      }
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Conversion failed: ${e.message}`,
      }, { quoted: msg })
    }

    // ── Send sticker ──────────────────────────────────────────────────────────
    try {
      await sock.sendMessage(from, {
        sticker: finalBuf,
      }, { quoted: msg })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Send failed: ${e.message}`,
      }, { quoted: msg })
    }
  }
}
