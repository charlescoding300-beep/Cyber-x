"use strict"

const crypto = require("crypto")

const {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
} = require("@systemzero/baileys")

const STATUS_SOURCE = {
  image: 0,
  video: 1,
  gif: 2,
  audio: 3,
  text: 4,
}

function makeSecret() {
  return crypto.randomBytes(32)
}

function makeContext(type) {
  return {
    isGroupStatus: true,
    statusSourceType: STATUS_SOURCE[type] ?? 4,
    forwardingScore: 0,
    featureEligibilities: {
      canBeReshared: true,
      canReceiveMultiReact: true,
    },
  }
}

async function sendMedia(sock, groupJid, type, buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error(`Empty ${type} Group Status media buffer`)
  }

  const authorJid = sock.user?.id || ""
  const messageSecret = makeSecret()

  let input

  if (type === "image") {
    input = {
      image: buffer,
      mimetype: options.mimetype || "image/jpeg",
      ...(options.caption ? { caption: options.caption } : {}),
    }
  } else if (type === "video" || type === "gif") {
    input = {
      video: buffer,
      mimetype: options.mimetype || "video/mp4",
      ...(options.caption ? { caption: options.caption } : {}),
      ...(type === "gif" || options.gifPlayback
        ? { gifPlayback: true }
        : {}),
    }
  } else if (type === "audio") {
    input = {
      audio: buffer,
      mimetype: options.mimetype || "audio/mp4",
      ptt: true,
    }
  } else {
    throw new Error(`Unsupported Group Status media type: ${type}`)
  }

  console.log("[GCSTATUS-LIB] Preparing media", {
    type,
    bytes: buffer.length,
    mimetype: input.mimetype,
  })

  const prepared = await prepareWAMessageMedia(input, {
    upload: sock.waUploadToServer,
  })

  if (!prepared) {
    throw new Error("prepareWAMessageMedia returned nothing")
  }

  const messageKey =
    type === "image"
      ? "imageMessage"
      : type === "video" || type === "gif"
        ? "videoMessage"
        : "audioMessage"

  const mediaMessage = prepared[messageKey]

  if (!mediaMessage) {
    throw new Error(`Prepared media missing ${messageKey}`)
  }

  mediaMessage.contextInfo = {
    ...(mediaMessage.contextInfo || {}),
    ...makeContext(type),
  }

  if (type === "audio") {
    mediaMessage.ptt = true
  }

  const content = {
    messageContextInfo: {
      messageSecret,
    },

    groupStatusMessageV2: {
      message: {
        [messageKey]: mediaMessage,

        messageContextInfo: {
          messageSecret,
        },
      },
    },
  }

  const msg = generateWAMessageFromContent(
    groupJid,
    content,
    {
      userJid: authorJid,
    }
  )

  console.log("[GCSTATUS-LIB] MEDIA READY", {
    group: groupJid,
    type,
    messageKey,
    bytes: buffer.length,
    id: msg.key.id,
    hasUrl: !!mediaMessage.url,
    hasDirectPath: !!mediaMessage.directPath,
    hasMediaKey: !!mediaMessage.mediaKey,
  })

  await sock.relayMessage(
    groupJid,
    msg.message,
    {
      messageId: msg.key.id,
    }
  )

  console.log("[GCSTATUS-LIB] MEDIA RELAY COMPLETE", {
    group: groupJid,
    type,
    id: msg.key.id,
  })

  return msg
}

async function sendText(sock, groupJid, text) {
  const authorJid = sock.user?.id || ""
  const messageSecret = makeSecret()

  const content = {
    messageContextInfo: {
      messageSecret,
    },

    groupStatusMessageV2: {
      message: {
        extendedTextMessage: {
          text: String(text || ""),
          contextInfo: makeContext("text"),
        },

        messageContextInfo: {
          messageSecret,
        },
      },
    },
  }

  const msg = generateWAMessageFromContent(
    groupJid,
    content,
    {
      userJid: authorJid,
    }
  )

  console.log("[GCSTATUS-LIB] TEXT READY", {
    group: groupJid,
    id: msg.key.id,
  })

  await sock.relayMessage(
    groupJid,
    msg.message,
    {
      messageId: msg.key.id,
    }
  )

  console.log("[GCSTATUS-LIB] TEXT RELAY COMPLETE", {
    group: groupJid,
    id: msg.key.id,
  })

  return msg
}

async function sendGroupStatus(sock, groupJid, payload = {}) {
  if (!sock) {
    throw new Error("WhatsApp socket is missing")
  }

  if (!groupJid || !groupJid.endsWith("@g.us")) {
    throw new Error(`Invalid Group Status destination: ${groupJid}`)
  }

  if (Buffer.isBuffer(payload.image)) {
    return sendMedia(
      sock,
      groupJid,
      "image",
      payload.image,
      payload
    )
  }

  if (Buffer.isBuffer(payload.video)) {
    return sendMedia(
      sock,
      groupJid,
      payload.gifPlayback ? "gif" : "video",
      payload.video,
      payload
    )
  }

  if (Buffer.isBuffer(payload.audio)) {
    return sendMedia(
      sock,
      groupJid,
      "audio",
      payload.audio,
      payload
    )
  }

  if (payload.text !== undefined) {
    return sendText(
      sock,
      groupJid,
      payload.text
    )
  }

  throw new Error(
    "Group Status requires text, image, video, or audio"
  )
}

module.exports = {
  sendGroupStatus,
  sendText,
  sendMedia,
}
