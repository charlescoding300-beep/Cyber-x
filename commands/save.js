/**
 * .save — Reply to an image, video, or audio (or sticker/document) with
 * .save and the bot re-downloads that media at full quality and resends
 * it to you. WhatsApp then lets you long-press → Save/Download it to your
 * own device gallery, exactly like any other media you receive.
 *
 * NOTE ON WHAT THIS CAN AND CAN'T DO:
 * A bot has no permission to reach into your phone's storage and write a
 * file there directly — no WhatsApp bot can do that, on any platform.
 * What it CAN do (and what this does) is guarantee you get a fresh,
 * undamaged copy of the media sent straight to you, which you then save
 * yourself with WhatsApp's normal save button. This is how every
 * "save status" / "save media" bot feature actually works under the hood.
 */

/**
 * .save — Reply to a status, voice note, image, video, sticker, document,
 * or view-once media with .save. The bot re-downloads it at full quality
 * and sends it PRIVATELY to the session's own number (the "Message
 * Yourself" chat) — not back into the group/chat everyone can see — then
 * confirms in the original chat (quoting your command) that it's been
 * saved to your DM. From there, use WhatsApp's own Save/Download button
 * to put it on your device.
 *
 * NOTE ON WHAT THIS CAN AND CAN'T DO:
 * A bot has no permission to reach into your phone's storage and write a
 * file there directly — no WhatsApp bot can do that, on any platform.
 * What it CAN do (and what this does) is guarantee a fresh, undamaged
 * copy lands in your own DM, which you then save yourself with
 * WhatsApp's normal save button. This is how every "save status" bot
 * feature actually works under the hood.
 */

const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const Pino = require("pino")

function getQuotedInfo(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    msg.message?.stickerMessage?.contextInfo

  if (!ctx?.quotedMessage) return null
  return {
    quotedMessage: ctx.quotedMessage,
    participant:   ctx.participant,
    stanzaId:      ctx.stanzaId,
  }
}

// View-once / ephemeral photos & videos wrap the real content one layer
// deeper — unwrap so .save can grab those too (this is the #1 thing
// people actually want saved before it disappears).
function unwrap(message) {
  return (
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.viewOnceMessageV2Extension?.message ||
    message
  )
}

function detectMedia(message) {
  const m = unwrap(message)
  if (m.imageMessage)    return { type: "image",    node: m.imageMessage }
  if (m.videoMessage)    return { type: "video",    node: m.videoMessage }
  if (m.audioMessage)    return { type: "audio",    node: m.audioMessage }
  if (m.stickerMessage)  return { type: "sticker",  node: m.stickerMessage }
  if (m.documentMessage) return { type: "document", node: m.documentMessage }
  return null
}

// The bot's own number, cleaned of the ":device" suffix — this is the
// "Message Yourself" chat every WhatsApp account has.
function getOwnJid(sock) {
  const raw = sock.user?.id || ""
  const user = raw.split("@")[0].split(":")[0]
  return `${user}@s.whatsapp.net`
}

module.exports = {
  name:     "save",
  aliases:  ["s", "sv"],
  desc:     "Reply to a status/VN/image/video/sticker/document/view-once with .save — it's re-sent privately to your own DM in full quality.",
  usage:    "Reply to media (or a status), then send: .save",
  category: "owner",

  async run({ sock, from, msg, isOwner, helper }) {
    if (!isOwner) return helper.reply(sock, msg, "❌ Owner only.")

    const quoted = getQuotedInfo(msg)
    if (!quoted) {
      return helper.reply(sock, msg,
        "❌ Reply to a status, voice note, image, video, sticker, or document with *.save*.")
    }

    const media = detectMedia(quoted.quotedMessage)
    if (!media) {
      return helper.reply(sock, msg, "❌ That message doesn't contain saveable media.")
    }

    // Reconstruct a minimal message object Baileys can download from —
    // works the same whether the quoted content came from a group, a
    // DM, or a status reply, since the media node carries its own
    // mediaKey/url regardless of where it originated.
    const fakeMsg = {
      key: {
        remoteJid:   from,
        id:          quoted.stanzaId,
        participant: quoted.participant,
        fromMe:      false,
      },
      message: unwrap(quoted.quotedMessage),
    }

    let buffer
    try {
      buffer = await downloadMediaMessage(fakeMsg, "buffer", {}, {
        logger: Pino({ level: "silent" }),
      })
    } catch (e) {
      return helper.reply(sock, msg, `❌ Couldn't download that media — it may have expired: ${e.message}`)
    }
    if (!buffer || buffer.length < 10) {
      return helper.reply(sock, msg, "❌ Download came back empty — the media may have expired.")
    }

    const ownJid  = getOwnJid(sock)
    const caption = "✅ *Saved via .save*\n\nUse WhatsApp's Save/Download button to put this on your device.\n\n© 𝕮𝖄𝕭𝙴𝚁 𝖃 ™"

    try {
      if (media.type === "image") {
        await sock.sendMessage(ownJid, { image: buffer, caption })
      } else if (media.type === "video") {
        await sock.sendMessage(ownJid, { video: buffer, caption, gifPlayback: !!media.node.gifPlayback })
      } else if (media.type === "audio") {
        await sock.sendMessage(ownJid, {
          audio: buffer,
          mimetype: media.node.mimetype || "audio/mp4",
          ptt: !!media.node.ptt,
        })
      } else if (media.type === "sticker") {
        await sock.sendMessage(ownJid, { sticker: buffer })
      } else if (media.type === "document") {
        await sock.sendMessage(ownJid, {
          document: buffer,
          mimetype: media.node.mimetype || "application/octet-stream",
          fileName: media.node.fileName || "file",
          caption,
        })
      }
    } catch (e) {
      return helper.reply(sock, msg, `❌ Failed to send to your DM: ${e.message}`)
    }

    // Confirm back in the original chat, quoting the .save command itself.
    return helper.reply(sock, msg, `✅ Saved — sent privately to your DM (${media.type}).`)
  },
}

