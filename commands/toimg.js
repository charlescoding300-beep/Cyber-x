const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const sharp = require("sharp")

const TMP = path.join(os.tmpdir(), "cyberx_toimg")
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

function ffmpegError(r) {
  const out = (r.stderr?.toString() || r.error?.message || "").trim()
  if (!out) return "unknown ffmpeg error"
  console.error("[TOIMG] ffmpeg failed:\n" + out)
  return out.slice(-400)
}

async function mediaToImage(inputBuf) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const inp = path.join(TMP, `inp_${id}`)
  const out = path.join(TMP, `out_${id}.png`)

  fs.writeFileSync(inp, inputBuf)

  try {
    const r = spawnSync("ffmpeg", [
      "-y",
      "-i", inp,
      "-frames:v", "1",
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
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

async function stickerToImage(inputBuf) {
  return sharp(inputBuf, { animated: true })
    .png()
    .toBuffer()
}

module.exports = {
  pattern: "toimg",
  desc: "Convert a WhatsApp video or sticker to a static image",
  usage: "Reply to a video or sticker → .toimg",
  category: "utility",

  async run({ sock, from, msg }) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo
    const quoted = ctx?.quotedMessage

    if (!quoted) {
      return sock.sendMessage(from, {
        text: "↩️ Reply to a *video or sticker* and type *.toimg*",
      }, { quoted: msg })
    }

    const isSticker = !!quoted.stickerMessage
    const isVideo = !!quoted.videoMessage

    if (!isSticker && !isVideo) {
      return sock.sendMessage(from, {
        text: "❌ Only *videos or stickers* can be converted.\nReply to a video or sticker → *.toimg*",
      }, { quoted: msg })
    }

    try {
      await sock.sendMessage(from, {
        react: { text: "🖼️", key: msg.key }
      })
    } catch {}

    const fakeMsg = {
      key: {
        remoteJid: from,
        fromMe: false,
        id: ctx.stanzaId,
        participant: ctx.participant,
      },
      message: quoted,
    }

    let mediaBuf

    try {
      mediaBuf = await downloadMediaMessage(fakeMsg, "buffer", {}, {
        logger: {
          level: "silent",
          info: () => {},
          warn: () => {},
          error: () => {},
          child: () => ({
            info: () => {},
            warn: () => {},
            error: () => {}
          }),
        },
        reuploadRequest: sock.updateMediaMessage,
      })
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Failed to download media: ${e.message}`,
      }, { quoted: msg })
    }

    if (!mediaBuf?.length) {
      return sock.sendMessage(from, {
        text: "❌ Could not read the media. Try again.",
      }, { quoted: msg })
    }

    try {
      const imageBuf = isSticker
        ? await stickerToImage(mediaBuf)
        : await mediaToImage(mediaBuf)

      await sock.sendMessage(from, {
        image: imageBuf,
        caption: "🖼️ *ZENX* | Media → Image",
      }, { quoted: msg })

    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Conversion failed:\n${e.message}`,
      }, { quoted: msg })
    }
  }
}
