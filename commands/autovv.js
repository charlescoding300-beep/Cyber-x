'use strict'

const {
  downloadMediaMessage,
  getContentType,
} = require('@whiskeysockets/baileys')

const { createStore } = require('../lib/store')

const autoVVStore = createStore('autovv', {
  globalEnabled: false,
})

function loadGlobalEnabled() {
  return autoVVStore.get('globalEnabled') === true
}

function saveGlobalEnabled(enabled) {
  autoVVStore.set('globalEnabled', enabled === true)
}

let globalEnabled = loadGlobalEnabled()

function enableGlobal() {
  globalEnabled = true
  saveGlobalEnabled(true)
  return true
}

function disableGlobal() {
  globalEnabled = false
  saveGlobalEnabled(false)
  return true
}

function isEnabled() {
  return globalEnabled === true
}

const BLACK_REACTION = '🖤'

function normalizeJid(jid = '') {
  return String(jid)
    .trim()
    .replace(/:\d+(?=@)/, '')
}


function unwrap(message) {
  let current = message

  for (let i = 0; i < 10 && current; i++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }

    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message
      continue
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message
      continue
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message
      continue
    }

    break
  }

  return current || null
}

function detect(message) {
  if (!message) return null

  const inner = unwrap(message)
  if (!inner) return null

  const type = getContentType(inner)
  if (!type) return null

  const node = inner[type]

  const isWrapper =
    !!message.viewOnceMessage ||
    !!message.viewOnceMessageV2 ||
    !!message.viewOnceMessageV2Extension

  const isViewOnce =
    isWrapper ||
    node?.viewOnce === true

  if (!isViewOnce) return null

  let label = 'Unknown'

  if (type === 'imageMessage') label = '📷 Image'
  else if (type === 'videoMessage') label = '🎥 Video'
  else if (type === 'audioMessage') label = '🎤 Voice Note'
  else if (type === 'documentMessage') label = '📄 Document'
  else if (type === 'stickerMessage') label = '🏷️ Sticker'
  else if (type === 'conversation' || type === 'extendedTextMessage') {
    label = '📝 Text'
  }

  return {
    inner,
    type,
    node,
    label,
  }
}

function numberFromJid(jid = '') {
  return normalizeJid(jid)
    .replace(/@s\.whatsapp\.net$/, '')
    .replace(/@g\.us$/, '')
}

function ownerJid() {
  const raw = String(process.env.OWNER_NUMBER || '')
    .replace(/\D/g, '')

  if (!raw) return null

  return `${raw}@s.whatsapp.net`
}

function senderJid(msg, from) {
  return normalizeJid(
    msg?.key?.participant ||
    msg?.participant ||
    from
  )
}

function formatTime() {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}

async function react(sock, msg, text = BLACK_REACTION) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: {
        text,
        key: msg.key,
      },
    })
  } catch {}
}

async function download(sock, msg, info) {
  const key = {
    ...msg.key,
    fromMe: false,
  }

  const wrapped = {
    key,
    message: msg.message,
  }

  try {
    return await downloadMediaMessage(
      wrapped,
      'buffer',
      {},
      {
        reuploadRequest: sock.updateMediaMessage,
      }
    )
  } catch {
    return await downloadMediaMessage(
      {
        key,
        message: info.inner,
      },
      'buffer',
      {},
      {
        reuploadRequest: sock.updateMediaMessage,
      }
    )
  }
}

function buildInfo(from, msg, info) {
  const sender = senderJid(msg, from)
  const senderNumber = numberFromJid(sender)

  const group = from.endsWith('@g.us')
  const chatLabel = group
    ? 'WhatsApp Group'
    : 'Private Chat'

  return [
    '👁️ *AUTO-VV*',
    '',
    `👤 *Sender:* ${msg.pushName || senderNumber || 'Unknown'}`,
    `💬 *Chat:* ${chatLabel}`,
    `📦 *Content:* ${info.label}`,
    `🕐 *Time:* ${formatTime()}`,
    '',
    '🖤 *View Once detected*',
    '🐺 *ZEN X*',
  ].join('\n')
}

async function sendToOwner(sock, from, msg, info) {
  const owner = ownerJid()

  if (!owner) {
    throw new Error(
      'OWNER_NUMBER is not configured'
    )
  }

  const caption = buildInfo(from, msg, info)

  /*
   * Text-only View Once content.
   * We don't fabricate media where none exists.
   */
  if (
    info.type === 'conversation' ||
    info.type === 'extendedTextMessage'
  ) {
    const text =
      info.node?.text ||
      info.node?.caption ||
      info.inner?.conversation ||
      ''

    return sock.sendMessage(owner, {
      text: `${caption}\n\n📝 *Text:*\n${text}`,
    })
  }

  const buffer = await download(
    sock,
    msg,
    info
  )

  if (!buffer || !buffer.length) {
    throw new Error(
      'The View Once media could not be downloaded'
    )
  }

  if (info.type === 'imageMessage') {
    return sock.sendMessage(owner, {
      image: buffer,
      caption,
      mimetype:
        info.node?.mimetype || 'image/jpeg',
    })
  }

  if (info.type === 'videoMessage') {
    return sock.sendMessage(owner, {
      video: buffer,
      caption,
      mimetype:
        info.node?.mimetype || 'video/mp4',
    })
  }

  if (info.type === 'audioMessage') {
    return sock.sendMessage(owner, {
      audio: buffer,
      mimetype:
        info.node?.mimetype ||
        'audio/ogg; codecs=opus',
      ptt: info.node?.ptt === true,
    })
  }

  if (info.type === 'documentMessage') {
    return sock.sendMessage(owner, {
      document: buffer,
      fileName:
        info.node?.fileName ||
        'view-once-document',
      mimetype:
        info.node?.mimetype ||
        'application/octet-stream',
      caption,
    })
  }

  if (info.type === 'stickerMessage') {
    await sock.sendMessage(owner, {
      text: caption,
    })

    return sock.sendMessage(owner, {
      sticker: buffer,
    })
  }

  throw new Error(
    `Unsupported View Once type: ${info.type}`
  )
}

async function handleAutoVV({
  sock,
  msg,
  from,
}) {
  if (!msg?.message) return false
  if (!from || from === 'status@broadcast') return false

  if (!isEnabled()) return false

  const info = detect(msg.message)
  if (!info) return false

  await react(sock, msg)

  try {
    await sendToOwner(
      sock,
      from,
      msg,
      info
    )

    console.log(
      `[AUTO-VV] ${info.label} forwarded from ${from}`
    )
  } catch (error) {
    console.error(
      `[AUTO-VV] ${error.message}`
    )
  }

  return true
}

module.exports = {
  pattern: 'autovv',
  name: 'autovv',
  category: 'owner',
  desc: 'Enable or disable authorized-chat AutoVV forwarding',
  usage: '.autovv on | .autovv off | .autovv status',

  run: async ({ sock, from, args, isOwner }) => {
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: '❌ *Owner Only*\\nAutoVV authorization can only be changed by the bot owner.',
      })
    }

    const action = String(args?.[0] || 'status').toLowerCase()

    if (action === 'on' || action === 'enable') {
      enableGlobal()

      return sock.sendMessage(from, {
        text: [
          '👁️ *AUTO-VV ENABLED*',
          '',
          'Global AutoVV is now ON.',
          'View Once content received in DMs and groups will be processed automatically.',
          'Detected content will be sent to the bot owner DM.',
          '',
          'Use *.autovv off* to disable global AutoVV.',
        ].join('\\n'),
      })
    }

    if (action === 'off' || action === 'disable') {
      disableGlobal()

      return sock.sendMessage(from, {
        text: [
          '👁️ *AUTO-VV DISABLED*',
          '',
          'Global AutoVV is now OFF.',
          'Automatic View Once processing has been disabled.',
        ].join('\\n'),
      })
    }

    if (action === 'status') {
      const enabled = isEnabled()

      return sock.sendMessage(from, {
        text: [
          '👁️ *AUTO-VV STATUS*',
          '',
          `Global Status: ${enabled ? '✅ ENABLED' : '❌ DISABLED'}`,
          '',
          enabled
            ? 'View Once detection is active globally.'
            : 'Use *.autovv on* to enable global AutoVV.',
        ].join('\\n'),
      })
    }

    return sock.sendMessage(from, {
      text: [
        '👁️ *AUTO-VV*',
        '',
        'Usage:',
        '• *.autovv on* — enable global AutoVV',
        '• *.autovv off* — disable global AutoVV',
        '• *.autovv status* — check global status',
      ].join('\\n'),
    })
  },

  enableGlobal,
  disableGlobal,
  isEnabled,
  detect,
  handleAutoVV,
}
