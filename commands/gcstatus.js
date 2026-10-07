// commands/gcstatus.js
// ─────────────────────────────────────────────────────────────────────────────
// .gcstatus — publish a replied message to a WhatsApp GROUP STATUS.
//
//   Reply to a text / image / video / voice-note with:
//     .gcstatus <group name | GID | invite link>     (from anywhere)
//     .gcstatus                                      (inside the target group)
//     .gcstatus ... --flat                           (fallback engine, see below)
//     .gcstatus check                                (library patch diagnostics)
//
// WHY MEDIA USED TO FAIL (text worked):
//   Group Status is a normal message wrapped in `groupStatusMessageV2`.
//   Baileys' relayMessage() decides the stanza's `mediatype` attribute by
//   looking only at the TOP level of the message. Wrapped media → mediatype
//   never gets set → WhatsApp receives something that looks like plain text
//   → image/video/audio silently vanish while text posts fine.
//   (Same bug fixed upstream for view-once in WhiskeySockets/Baileys PR #2847.)
//
//   FIX (two parts):
//     1) node patch-gcstatus-lib.js   → makes relayMessage unwrap before
//        picking mediatype. Run once, restart the bot. (Re-run after any
//        `npm install` that reinstalls the baileys package.)
//     2) This file no longer depends on lib/gcStatusMedia.js. It builds the
//        media status the same way the (working) text path does, and also
//        fixes the old forced `ptt: true` on every media type.
//
//   --flat : fallback engine that skips the wrapper entirely and sends normal
//            media with the group-status contextInfo flags. Use it only if the
//            wrapped engine still doesn't show up after patching.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const Pino = require("pino")

const {
  downloadMediaMessage,
  generateWAMessageFromContent,
  generateWAMessageContent,
} = require("@systemzero/baileys")

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

const STATUS_SOURCE = {
  image: 0,
  video: 1,
  gif: 2,
  audio: 3,
  text: 4,
}

const STATUS_SOURCE_NAME = {
  image: "IMAGE",
  video: "VIDEO",
  gif: "GIF",
  audio: "AUDIO",
  text: "TEXT",
}

const SUPPORTED_MEDIA = new Set(["image", "video", "audio"])

// ── quoted message helpers ───────────────────────────────────────────────────

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
    participant: ctx.participant,
    stanzaId: ctx.stanzaId,
  }
}

function unwrap(message) {
  let current = message

  for (let i = 0; i < 8 && current; i++) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message

    if (!next) break
    current = next
  }

  return current
}

function getContent(message) {
  const m = unwrap(message)

  if (m?.conversation) return { type: "text", node: { text: m.conversation } }
  if (m?.extendedTextMessage) return { type: "text", node: m.extendedTextMessage }
  if (m?.imageMessage) return { type: "image", node: m.imageMessage }
  if (m?.videoMessage) return { type: "video", node: m.videoMessage }
  if (m?.audioMessage) return { type: "audio", node: m.audioMessage }
  if (m?.stickerMessage) return { type: "sticker", node: m.stickerMessage }
  if (m?.documentMessage) return { type: "document", node: m.documentMessage }

  return null
}

async function downloadMedia(sock, node, type, quoted, from) {
  if (!node) throw new Error("Media node is missing")

  const fakeMsg = {
    key: {
      remoteJid: from,
      id: quoted.stanzaId,
      participant: quoted.participant,
      fromMe: false,
    },
    message: unwrap(quoted.quotedMessage),
  }

  console.log("[GCSTATUS] Downloading quoted media", {
    type,
    hasMediaKey: !!node.mediaKey,
    hasUrl: !!node.url,
    hasDirectPath: !!node.directPath,
  })

  const buffer = await downloadMediaMessage(
    fakeMsg,
    "buffer",
    {},
    {
      logger: Pino({ level: "silent" }),
      // lets WhatsApp re-serve media whose CDN link has expired
      reuploadRequest: sock.updateMediaMessage,
    }
  )

  if (!buffer || buffer.length < 10) throw new Error("Downloaded media is empty")

  console.log("[GCSTATUS] Downloaded", { type, bytes: buffer.length })
  return buffer
}

// ── group lookup (unchanged) ─────────────────────────────────────────────────

async function findGroup(sock, destination) {
  const groups = await sock.groupFetchAllParticipating()
  const list = Object.values(groups || {})

  if (!destination) return null

  const raw = destination.trim()

  if (raw.endsWith("@g.us")) {
    return list.find(g => g.id === raw) || { id: raw, subject: raw }
  }

  const match = raw.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i)

  if (match) {
    try {
      const metadata = await sock.groupGetInviteInfo(match[1])
      if (metadata?.id) return metadata
    } catch (e) {
      throw new Error(`Invite link could not be resolved: ${e.message}`)
    }
  }

  const exact = list.find(
    g => String(g.subject || "").trim().toLowerCase() === raw.toLowerCase()
  )
  if (exact) return exact

  const partial = list.filter(g =>
    String(g.subject || "").toLowerCase().includes(raw.toLowerCase())
  )

  if (partial.length === 1) return partial[0]

  if (partial.length > 1) {
    throw new Error(`More than one group matches "${raw}". Use the GID from .gcjid.`)
  }

  return null
}

// ── status building blocks ───────────────────────────────────────────────────

function buildStatusContext(statusSourceType) {
  return {
    isGroupStatus: true,
    statusSourceType,
    forwardingScore: 0,
    featureEligibilities: {
      canBeReshared: true,
      canReceiveMultiReact: true,
    },
  }
}

// gif-playback videos are their own status source type
function statusKind(content) {
  if (content.type === "video" && content.node?.gifPlayback) return "gif"
  return content.type
}

// ── TEXT status (unchanged — this path already worked) ───────────────────────

async function buildTextStatus(groupJid, text, userJid) {
  const secret = crypto.randomBytes(32)

  return generateWAMessageFromContent(
    groupJid,
    {
      messageContextInfo: { messageSecret: secret },

      groupStatusMessageV2: {
        message: {
          extendedTextMessage: {
            text,
            contextInfo: buildStatusContext(STATUS_SOURCE.text),
          },
          messageContextInfo: { messageSecret: secret },
        },
      },
    },
    { userJid }
  )
}

async function relayStatus(sock, group, status, type) {
  console.log("[GCSTATUS] Relaying Group Status", {
    group: group.id,
    messageId: status.key.id,
    type,
  })

  await sock.relayMessage(group.id, status.message, { messageId: status.key.id })

  console.log("[GCSTATUS] relayMessage completed", status.key.id)
  return status
}

// ── MEDIA status ─────────────────────────────────────────────────────────────

function runFfmpeg(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "ignore" })
    const timer = setTimeout(() => { try { p.kill("SIGKILL") } catch {} ; reject(new Error("ffmpeg timeout")) }, timeoutMs)
    p.on("error", e => { clearTimeout(timer); reject(e) })
    p.on("close", code => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    })
  })
}

// Group status audio is a voice note → WhatsApp wants ogg/opus.
// Converts anything else when ffmpeg exists; otherwise sends it as-is.
async function prepareAudio(buffer, mimetype) {
  const mt = String(mimetype || "")
  if (/ogg/i.test(mt) && /opus/i.test(mt)) {
    return { buffer, mimetype: "audio/ogg; codecs=opus" }
  }

  const id = crypto.randomBytes(6).toString("hex")
  const inPath = path.join(os.tmpdir(), `gcs-${id}.in`)
  const outPath = path.join(os.tmpdir(), `gcs-${id}.ogg`)

  try {
    fs.writeFileSync(inPath, buffer)
    await runFfmpeg([
      "-y", "-i", inPath, "-vn",
      "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1",
      "-f", "ogg", outPath,
    ])
    const out = fs.readFileSync(outPath)
    if (out.length < 100) throw new Error("ffmpeg produced an empty file")
    console.log("[GCSTATUS] Audio converted to ogg/opus", { from: mt || "unknown", bytes: out.length })
    return { buffer: out, mimetype: "audio/ogg; codecs=opus" }
  } catch (e) {
    console.warn(`[GCSTATUS] Audio conversion skipped (${e.message}) — sending original`)
    return { buffer, mimetype: mt || "audio/mpeg" }
  } finally {
    try { fs.unlinkSync(inPath) } catch {}
    try { fs.unlinkSync(outPath) } catch {}
  }
}

async function buildMediaInput(content) {
  const { type, node, buffer } = content
  const input = {}

  if (type === "audio") {
    const audio = await prepareAudio(buffer, node.mimetype)
    input.audio = audio.buffer
    input.mimetype = audio.mimetype
    input.ptt = true
    return input
  }

  input[type] = buffer
  input.mimetype = node.mimetype || (type === "image" ? "image/jpeg" : "video/mp4")
  if (node.caption) input.caption = node.caption
  if (type === "video" && node.gifPlayback) input.gifPlayback = true
  return input
}

// ENGINE 1 (default): wrapped in groupStatusMessageV2 — same shape as the text
// path that already works, relayed with relayMessage().
async function sendWrappedMedia(sock, groupJid, content) {
  const kind = statusKind(content)
  const input = await buildMediaInput(content)
  const mediaKey = `${content.type}Message`

  console.log("[GCSTATUS] Uploading media for Group Status", {
    type: content.type,
    kind,
    bytes: content.buffer.length,
    mimetype: input.mimetype,
  })

  const prepared = await generateWAMessageContent(
    { ...input, groupStatus: true },
    {
      upload: sock.waUploadToServer,
      logger: Pino({ level: "silent" }),
    }
  )

  if (!prepared) throw new Error("Media pipeline returned nothing")

  const wrapperKey =
    prepared.groupStatusMessageV2 ? "groupStatusMessageV2" :
    prepared.groupStatusMessage   ? "groupStatusMessage"   : null

  let inner
  if (wrapperKey) inner = prepared[wrapperKey]?.message
  else if (prepared[mediaKey]) inner = prepared
  else if (prepared.message?.[mediaKey]) inner = prepared.message

  const mediaMessage = inner?.[mediaKey]
  if (!mediaMessage) {
    throw new Error(
      `Upload produced no ${mediaKey} (got: ${Object.keys(prepared).join(", ") || "nothing"})`
    )
  }

  mediaMessage.contextInfo = {
    ...(mediaMessage.contextInfo || {}),
    ...buildStatusContext(STATUS_SOURCE[kind]),
  }

  const secret = crypto.randomBytes(32)
  inner.messageContextInfo = { ...(inner.messageContextInfo || {}), messageSecret: secret }

  console.log("[GCSTATUS] Media uploaded", {
    wrapper: wrapperKey || "(added manually)",
    hasUrl: !!mediaMessage.url,
    hasDirectPath: !!mediaMessage.directPath,
    hasMediaKey: !!mediaMessage.mediaKey,
    fileLength: mediaMessage.fileLength ? String(mediaMessage.fileLength) : null,
  })

  const status = await generateWAMessageFromContent(
    groupJid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: { message: inner },
    },
    { userJid: sock.user?.id }
  )

  await relayStatus(sock, { id: groupJid }, status, content.type)
  return status
}

// ENGINE 2 (--flat): ordinary media message carrying the group-status
// contextInfo. No wrapper → no mediatype problem. Fallback only.
async function sendFlatMedia(sock, groupJid, content) {
  const kind = statusKind(content)
  const input = await buildMediaInput(content)

  input.contextInfo = {
    isGroupStatus: true,
    statusSourceType: STATUS_SOURCE_NAME[kind],
    statusAttributions: [{ type: 10 }],
    statusAudienceMetadata: { audienceType: "CLOSE_FRIENDS" },
  }

  console.log("[GCSTATUS] Sending FLAT media (--flat engine)", { type: content.type, kind })

  const sent = await sock.sendMessage(groupJid, input)
  console.log("[GCSTATUS] flat send completed", sent?.key?.id)
  return sent
}

// ── library patch diagnostics ────────────────────────────────────────────────

const LIB_PACKAGES = ["@systemzero/baileys", "@whiskeysockets/baileys"]

function pkgRoot(name) {
  try {
    let dir = path.dirname(require.resolve(name))
    for (let i = 0; i < 6; i++) {
      const pj = path.join(dir, "package.json")
      if (fs.existsSync(pj)) {
        try {
          if (JSON.parse(fs.readFileSync(pj, "utf8")).name === name) return dir
        } catch {}
      }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  } catch {}
  return null
}

function findSendFiles(dir, depth = 0, out = []) {
  if (depth > 5) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) findSendFiles(full, depth + 1, out)
    else if (/^messages-send\.(c|m)?js$/.test(e.name)) out.push(full)
  }
  return out
}

function isMediaTypeFixed(src) {
  return (
    src.includes("__gsInner(") ||
    /getMediaType\)?\(\s*(?:\(0,\s*[\w$.]+\.normalizeMessageContent\)|normalizeMessageContent)\(/.test(src)
  )
}

function inspectLib() {
  const report = []
  for (const name of LIB_PACKAGES) {
    const root = pkgRoot(name)
    if (!root) continue
    for (const file of findSendFiles(root)) {
      let src = ""
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      report.push({ name, file, fixed: isMediaTypeFixed(src) })
    }
  }
  return report
}

// ── the command ──────────────────────────────────────────────────────────────

module.exports = {
  name: "gcstatus",
  aliases: ["groupstatus"],

  desc: "Publish replied content (text, image, video, audio) to a WhatsApp Group Status.",

  usage: ".gcstatus <group name|GID|invite link> or .gcstatus inside a group  (add --flat for the fallback engine, .gcstatus check for diagnostics)",

  category: "owner",

  async run({ sock, from, msg, text, isOwner, isGroup, helper }) {
    if (!isOwner) {
      return helper.reply(sock, msg, "> ❌ *Owner only.*")
    }

    let destination = String(text || "").trim()

    // diagnostics
    if (destination.toLowerCase() === "check") {
      const report = inspectLib()
      if (!report.length) {
        return helper.reply(sock, msg, "> ⚠️ *Couldn't locate the baileys library files to inspect.*")
      }
      const lines = report.map(r => `> ${r.fixed ? "✅" : "❌"} ${r.name}\n>    ${r.file.split("node_modules/")[1] || r.file}`)
      const allFixed = report.every(r => r.fixed)
      return helper.reply(
        sock,
        msg,
        `> 🔎 *Group Status library check*\n>\n${lines.join("\n")}\n>\n> ${allFixed ? "All good — media group status should work." : "Run: *node patch-gcstatus-lib.js* then restart the bot."}`
      )
    }

    const flat = /(^|\s)--flat(\s|$)/i.test(destination)
    if (flat) destination = destination.replace(/(^|\s)--flat(\s|$)/gi, " ").trim()

    const quoted = getQuotedInfo(msg)

    if (!quoted) {
      return helper.reply(
        sock,
        msg,
        "> ❌ *Reply to the content you want to publish with .gcstatus.*"
      )
    }

    let group

    try {
      if (isGroup && !destination) {
        group = await sock.groupMetadata(from)
      } else {
        if (!destination) {
          return helper.reply(
            sock,
            msg,
            "> ❌ *Give me a group name, GID, or WhatsApp group invite link.*"
          )
        }
        group = await findGroup(sock, destination)
      }
    } catch (e) {
      return helper.reply(sock, msg, `> ❌ *${e.message}*`)
    }

    if (!group?.id) {
      return helper.reply(
        sock,
        msg,
        "> ❌ *Group not found.*\n> Use *.gcjid* to see the available groups."
      )
    }

    const content = getContent(quoted.quotedMessage)

    if (!content) {
      return helper.reply(sock, msg, "> ❌ *Unsupported quoted message.*")
    }

    console.log("[GCSTATUS] Content detected", {
      type: content.type,
      group: group.id,
      subject: group.subject || group.id,
      engine: content.type === "text" ? "text" : flat ? "flat" : "wrapped",
    })

    try {
      let status

      // ── TEXT ──────────────────────────────────────────────────────────────
      if (content.type === "text") {
        const textValue = content.node?.text || content.node?.caption || ""

        if (!textValue.trim()) throw new Error("The quoted text message is empty.")

        status = await buildTextStatus(group.id, textValue, sock.user?.id)
        await relayStatus(sock, group, status, "text")
      }

      // ── IMAGE / VIDEO / AUDIO ─────────────────────────────────────────────
      else {
        if (!SUPPORTED_MEDIA.has(content.type)) {
          return helper.reply(
            sock,
            msg,
            `> ❌ *${content.type} is not currently a supported WhatsApp Group Status media type.*\n>\n> Supported: *image, video, audio, text*`
          )
        }

        content.buffer = await downloadMedia(sock, content.node, content.type, quoted, from)

        status = flat
          ? await sendFlatMedia(sock, group.id, content)
          : await sendWrappedMedia(sock, group.id, content)

        console.log("[GCSTATUS] MEDIA SEND COMPLETE", {
          group: group.id,
          type: content.type,
          messageId: status?.key?.id || null,
        })
      }

      // warn if the library still has the mediatype bug (wrapped media only)
      let warn = ""
      if (content.type !== "text" && !flat) {
        const unfixed = inspectLib().filter(r => !r.fixed)
        if (unfixed.length) {
          warn = `\n>\n> ⚠️ *Library not patched yet* — media may not show.\n> Run *node patch-gcstatus-lib.js* and restart.`
        }
      }

      return helper.reply(
        sock,
        msg,
        `> ✅ *Group Status send completed.*\n>\n> Group: *${group.subject || group.id}*\n> GID: ${group.id}\n> Type: *${content.type}*${flat ? " (flat)" : ""}\n> Message ID: ${status?.key?.id || "unknown"}${warn}\n>\n${CREDIT}`
      )
    } catch (e) {
      console.error("[GCSTATUS FAILED]", e)
      return helper.reply(sock, msg, `> ❌ *Group Status failed.*\n> ${e.message}`)
    }
  },
}
