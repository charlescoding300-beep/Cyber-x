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
// NOTE ON ANIMATED STICKERS:
//   The system ffmpeg on Render (and many Debian builds) is compiled WITHOUT
//   libwebp support, so it cannot decode animated WebP (ANIM/ANMF chunks) —
//   neither the native "webp" decoder nor "libwebp_anim" work.
//   To work around this, we decode each animated frame using `sharp`
//   (bundles its own libvips/libwebp, no system deps), write the frames as
//   PNGs, then use ffmpeg ONLY to encode the PNG sequence into an MP4 using
//   the concat demuxer with per-frame durations.
//
// Static stickers are still handled directly by ffmpeg (single-frame WebP
// decode works fine even without libwebp).
//
// Requires: npm install sharp
// ─────────────────────────────────────────────────────────────────────────────

const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const { spawnSync }            = require("child_process")
const fs                       = require("fs")
const path                     = require("path")
const os                       = require("os")
const sharp                    = require("sharp")

// ── Temp dir ──────────────────────────────────────────────────────────────────
const TMP = path.join(os.tmpdir(), "cyberx_convert")
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

// ─────────────────────────────────────────────────────────────────────────────
// Check if a WebP buffer is animated
// Animated WebP contains the chunk marker "ANIM" / "ANMF" in its bytes
// ─────────────────────────────────────────────────────────────────────────────
function isAnimatedWebP(buf) {
  if (!buf || buf.length < 12) return false
  const str = buf.toString("ascii", 0, Math.min(buf.length, 200))
  return str.includes("ANIM") || str.includes("ANMF")
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract the real error line from ffmpeg's stderr.
// ffmpeg always prints a big version/build banner FIRST, then the actual
// error at the END — so we grab the tail, not the head.
// ─────────────────────────────────────────────────────────────────────────────
function ffmpegError(r) {
  const out = (r.stderr?.toString() || r.error?.message || "").trim()
  if (!out) return "unknown ffmpeg error (no stderr captured)"
  console.error("[CONVERT] ffmpeg failed:\n" + out)
  return out.slice(-400)
}

// ─────────────────────────────────────────────────────────────────────────────
// Animated WebP → MP4 (sent as looping GIF)
//
// 1. Use sharp to read animation metadata (page count + per-frame delays)
// 2. Export each page/frame as a PNG via sharp (handles ANIM/ANMF natively)
// 3. Build an ffmpeg concat list with each frame's real duration
// 4. ffmpeg encodes the PNG sequence to MP4 (h264)
// ─────────────────────────────────────────────────────────────────────────────
async function animatedWebpToMp4(inputBuf) {
  const id       = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const workDir  = path.join(TMP, id)
  const listPath = path.join(workDir, "list.txt")
  const outPath  = path.join(workDir, "out.mp4")

  fs.mkdirSync(workDir, { recursive: true })

  try {
    // ── Read animation metadata ──────────────────────────────────────────────
    const meta  = await sharp(inputBuf, { animated: true }).metadata()
    const pages = meta.pages && meta.pages > 1 ? meta.pages : 1
    const { width, pageHeight } = meta
    const frameHeight = pageHeight || meta.height

    // delay[] is in milliseconds per frame; fall back to 100ms (10fps) if missing
    const delays = (Array.isArray(meta.delay) && meta.delay.length === pages)
      ? meta.delay
      : new Array(pages).fill(100)

    // ── Decode the WHOLE animation ONCE into raw RGBA pixels ─────────────────
    // sharp stacks all frames vertically when animated:true, so we get one
    // big buffer of size width x (pageHeight * pages) x 4 channels, then slice
    // each frame out of memory instead of re-decoding the webp per frame.
    const { data: raw, info } = await sharp(inputBuf, { animated: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const channels  = info.channels
    const frameBytes = width * frameHeight * channels

    // ── Export each frame as PNG from the sliced raw buffer ──────────────────
    const frameFiles = []
    for (let i = 0; i < pages; i++) {
      const slice = raw.subarray(i * frameBytes, (i + 1) * frameBytes)
      const frameBuf = await sharp(slice, {
        raw: { width, height: frameHeight, channels },
      }).png().toBuffer()

      const framePath = path.join(workDir, `frame_${String(i).padStart(4, "0")}.png`)
      fs.writeFileSync(framePath, frameBuf)
      frameFiles.push({ file: framePath, duration: Math.max(delays[i], 20) / 1000 })
    }

    // ── Build ffmpeg concat list (last frame repeated, per ffmpeg quirk) ─────
    let list = ""
    for (const f of frameFiles) {
      list += `file '${f.file}'\n`
      list += `duration ${f.duration}\n`
    }
    list += `file '${frameFiles[frameFiles.length - 1].file}'\n`
    fs.writeFileSync(listPath, list)

    // ── Encode PNG sequence → MP4 ────────────────────────────────────────────
    const r = spawnSync("ffmpeg", [
      "-y",
      "-f",        "concat",
      "-safe",     "0",
      "-i",        listPath,
      "-vsync",    "vfr",
      "-pix_fmt",  "yuv420p",
      "-vf",       "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",
      "-c:v",      "libx264",
      "-crf",      "20",
      "-preset",   "ultrafast",
      "-movflags", "faststart",
      "-an",
      outPath,
    ], { timeout: 60000 })

    if (r.status !== 0 || !fs.existsSync(outPath)) {
      throw new Error(ffmpegError(r))
    }

    return fs.readFileSync(outPath)

  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Static WebP → PNG via ffmpeg
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

    if (r.status !== 0 || !fs.existsSync(out)) {
      throw new Error(ffmpegError(r))
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
        const mp4Buf = await animatedWebpToMp4(webpBuf)

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
        text: `❌ Conversion failed:\n${e.message}`,
      }, { quoted: msg })
    }
  }
}
