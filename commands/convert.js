// ─────────────────────────────────────────────────────────────────────────────
// commands/convert.js  —  CYBER X  |  Sticker → Video / Image Converter
//
// USAGE:
//   Reply to any sticker → type .convert
//
// WHAT IT DOES:
//   Animated sticker (WebP) → MP4 video sent as GIF (loops, no sound)
//   Static sticker  (WebP) → PNG image
//
// Reacts with 📽️ instantly when command fires
//
// Works on BOTH Render (Linux x64) and Termux (Android ARM64)
// Only needs ffmpeg — already installed on both
// ─────────────────────────────────────────────────────────────────────────────

const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const { spawnSync }            = require("child_process")
const fs                       = require("fs")
const path                     = require("path")
const os                       = require("os")

// ── Temp dir ──────────────────────────────────────────────────────────────────
const TMP = path.join(os.tmpdir(), "cyberx_convert")
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// Check if a WebP buffer is animated
// Animated WebP contains the chunk marker "ANIM" in its bytes
// ─────────────────────────────────────────────────────────────────────────────
function isAnimatedWebP(buf) {
  if (!buf || buf.length < 12) return false
  // Search for ANIM chunk marker in the buffer
  const str = buf.toString("ascii", 0, Math.min(buf.length, 200))
  return str.includes("ANIM") || str.includes("ANMF")
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert animated WebP → MP4 via ffmpeg
// Sent back as gifPlayback: true so it loops like a gif in WhatsApp
// ─────────────────────────────────────────────────────────────────────────────
function webpToMp4(inputBuf) {
  const id  = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const inp = path.join(TMP, `inp_${id}.webp`)
  const out = path.join(TMP, `out_${id}.mp4`)

  fs.writeFileSync(inp, inputBuf)

  try {
    const r = spawnSync("ffmpeg", [
      "-y",
      "-i",        inp,
      "-movflags", "faststart",
      "-pix_fmt",  "yuv420p",
      "-vf",       "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",
      "-r",        "15",
      "-c:v",      "libx264",
      "-crf",      "20",
      "-preset",   "fast",
      "-an",
      out,
    ], { timeout: 60000 })

    if (r.status !== 0) {
      throw new Error(r.stderr?.toString()?.slice(0, 300) || "ffmpeg mp4 conversion failed")
    }

    return fs.readFileSync(out)

  } finally {
    try { fs.unlinkSync(inp) } catch {}
    try { fs.unlinkSync(out) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert static WebP → PNG via ffmpeg
// ─────────────────────────────────────────────────────────────────────────────
function webpToPng(inputBuf) {
  const id  = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const inp = path.join(TMP, `inp_${id}.webp`)
  const out = path.join(TMP, `out_${id}.png`)

  fs.writeFileSync(inp, inputBuf)

  try {
    const r = spawnSync("ffmpeg", [
      "-y",
      "-i",        inp,
      "-frames:v", "1",
      "-vf",       "scale=512:512:force_original_aspect_ratio=decrease",
      out,
    ], { timeout: 30000 })

    if (r.status !== 0) {
      throw new Error(r.stderr?.toString()?.slice(0, 300) || "ffmpeg png conversion failed")
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
  pattern:  "convert",
  desc:     "Convert a sticker to video (animated) or image (static)",
  usage:    "Reply to a sticker → .convert",
  category: "media",

  async run({ sock, from, msg }) {

    // ── Must be a reply ───────────────────────────────────────────────────────
    const ctx    = msg.message?.extendedTextMessage?.contextInfo
    const quoted = ctx?.quotedMessage

    if (!quoted) {
      return sock.sendMessage(from, {
        text: "↩️ Reply to a *sticker* and type *.convert*",
      }, { quoted: msg })
    }

    // ── Must be a sticker ─────────────────────────────────────────────────────
    if (!quoted.stickerMessage) {
      return sock.sendMessage(from, {
        text: "❌ Only *stickers* can be converted.\nReply to a sticker → *.convert*",
      }, { quoted: msg })
    }

    // ── React instantly 📽️ ───────────────────────────────────────────────────
    try {
      await sock.sendMessage(from, {
        react: { text: "📽️", key: msg.key }
      })
    } catch {}

    // ── Download the sticker ──────────────────────────────────────────────────
    const fakeMsg = {
      key: {
        remoteJid:   from,
        fromMe:      false,
        id:          ctx.stanzaId,
        participant: ctx.participant,
      },
      message: quoted,
    }

    let webpBuf
    try {
      webpBuf = await downloadMediaMessage(fakeMsg, "buffer", {}, {
        logger: {
          level: "silent",
          info:  () => {}, warn:  () => {}, error: () => {},
          child: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
        },
        reuploadRequest: sock.updateMediaMessage,
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Failed to download sticker: ${e.message}`,
      }, { quoted: msg })
    }

    if (!webpBuf?.length) {
      return sock.sendMessage(from, {
        text: "❌ Could not read sticker. Try again.",
      }, { quoted: msg })
    }

    // ── Detect animated or static ─────────────────────────────────────────────
    const animated = quoted.stickerMessage?.isAnimated === true || isAnimatedWebP(webpBuf)

    // ── Convert & send ────────────────────────────────────────────────────────
    try {
      if (animated) {
        // ── Animated sticker → MP4 (sent as looping GIF) ──────────────────
        const mp4Buf = webpToMp4(webpBuf)

        await sock.sendMessage(from, {
          video:       mp4Buf,
          gifPlayback: true,           // loops like a GIF in WhatsApp
          mimetype:    "video/mp4",
          caption:     "🎬 *CYBER X* | Animated sticker → Video",
        }, { quoted: msg })

      } else {
        // ── Static sticker → PNG image ─────────────────────────────────────
        const pngBuf = webpToPng(webpBuf)

        await sock.sendMessage(from, {
          image:   pngBuf,
          caption: "🖼️ *CYBER X* | Sticker → Image",
        }, { quoted: msg })
      }

    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Conversion failed: ${e.message}\n\nMake sure ffmpeg is installed:\n*Termux:* pkg install ffmpeg\n*Render:* ffmpeg is pre-available`,
      }, { quoted: msg })
    }
  }
}
