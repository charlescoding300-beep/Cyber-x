'use strict'

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
const WHATSAPP_USER_SUFFIX = '@s.whatsapp.net'
const NIGERIA_CALLING_CODE = '234'

function normalizePhoneNumber(input) {
  let digits = String(input || '').replace(/\D/g, '')
  if (!digits) {
    return {
      error: 'Send a phone number with its international country calling code.',
    }
  }

  // 00 is the international dialing prefix used in many countries.
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
  } else if (digits.startsWith('0')) {
    // The examples include Nigerian local numbers, so 0-prefixed local
    // numbers are interpreted as Nigeria. Other countries must include a code.
    digits = NIGERIA_CALLING_CODE + digits.slice(1)
  }

  // Accept common Nigerian input with the country code plus its local trunk 0.
  if (digits.startsWith('2340')) {
    digits = NIGERIA_CALLING_CODE + digits.slice(4)
  }

  // E.164 allows at most 15 digits. WhatsApp performs the final account check.
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return {
      error:
        'That number does not look valid. Send 8–15 digits with the country code, ' +
        'for example *.add 234 812 345 6789*. Nigerian local numbers may start with 0.',
    }
  }

  return { phone: digits }
}

function getContextInfo(msg) {
  const queue = [{ value: msg && msg.message, depth: 0 }]
  const seen = new Set()

  while (queue.length) {
    const current = queue.shift()
    const value = current && current.value
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)

    if (value.contextInfo) return value.contextInfo
    if (current.depth >= 5) continue

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') {
        queue.push({ value: child, depth: current.depth + 1 })
      }
    }
  }

  return null
}

function normalizeQuotedJid(value) {
  if (typeof value !== 'string' || !value.includes('@')) return null

  const [localPart, server] = value.split('@')
  if (server === 'lid') {
    return { jid: localPart + '@lid', phone: null }
  }

  if (server !== 's.whatsapp.net') return null
  const phone = localPart.split(':')[0].replace(/\D/g, '')
  if (!/^[1-9]\d{7,14}$/.test(phone)) return null
  return { jid: phone + WHATSAPP_USER_SUFFIX, phone }
}

function getTarget(args, msg) {
  const context = getContextInfo(msg)
  const mentioned = context && Array.isArray(context.mentionedJid)
    ? normalizeQuotedJid(context.mentionedJid[0])
    : null
  if (mentioned) return { ...mentioned, fromReply: false }

  if (Array.isArray(args) && args.length) {
    const parsed = normalizePhoneNumber(args.join(' '))
    return parsed.error
      ? { error: parsed.error }
      : { phone: parsed.phone, fromReply: false }
  }

  if (!context) return null

  const quoted =
    context.participantAlt ||
    context.participant ||
    (context.quotedMessage &&
      context.quotedMessage.key &&
      (context.quotedMessage.key.participantAlt ||
        context.quotedMessage.key.participant))

  const identity = normalizeQuotedJid(mentioned || quoted)
  return identity ? { ...identity, fromReply: !mentioned } : null
}

async function reply(sock, from, msg, text) {
  const body = text + '\n\n' + CREDIT
  return sock.sendMessage(from, { text: body }, { quoted: msg })
}

async function react(sock, from, msg, emoji) {
  if (!msg || !msg.key) return
  try {
    await sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
  } catch {}
}

function getStatus(value) {
  const raw =
    value &&
    (value.status ??
      (value.output && value.output.statusCode) ??
      value.statusCode)
  const status = Number(raw)
  return Number.isFinite(status) ? status : null
}

function labelForJid(jid) {
  if (typeof jid !== 'string' || !jid.includes('@')) {
    return 'the person you replied to'
  }
  const localPart = jid.split('@')[0].split(':')[0]
  const phone = localPart.replace(/\D/g, '')
  return /^[1-9]\d{7,14}$/.test(phone)
    ? '+' + phone
    : 'the person you replied to'
}

function explainAddFailure(status) {
  if (status === 401) {
    return 'I could not add them because the bot needs admin rights in this group.'
  }
  if (status === 403) {
    return (
      'WhatsApp did not allow the direct addition. The person’s group privacy ' +
      'settings may require them to join through an invitation link.'
    )
  }
  if (status === 404) {
    return 'This number is not registered on WhatsApp. Check the number and country code.'
  }
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    return 'WhatsApp could not complete the request just now. Please try again shortly.'
  }
  if (status === 409) {
    return 'That person is already in this group.'
  }
  return (
    'WhatsApp could not add this person. Check the number and make sure the bot ' +
    'has admin rights in the group, then try again.'
  )
}

async function verifyPhoneNumber(sock, phone) {
  if (typeof sock.onWhatsApp !== 'function') {
    return { error: 'This bot cannot verify WhatsApp numbers right now.' }
  }

  const results = await sock.onWhatsApp(phone + WHATSAPP_USER_SUFFIX)
  if (!Array.isArray(results)) {
    return { error: 'WhatsApp could not verify that number right now. Please try again.' }
  }

  const account = results.find((item) => item && item.exists === true)
  if (!account) return { registered: false }

  return {
    registered: true,
    jid:
      typeof account.jid === 'string' && account.jid.includes('@')
        ? account.jid
        : phone + WHATSAPP_USER_SUFFIX,
  }
}

async function resolveQuotedLid(sock, jid) {
  const mapping = sock.signalRepository && sock.signalRepository.lidMapping
  if (!mapping || typeof mapping.getPNForLID !== 'function') return jid

  try {
    const phoneJid = await mapping.getPNForLID(jid)
    if (typeof phoneJid === 'string' && phoneJid.includes('@')) return phoneJid
    if (typeof phoneJid === 'string') {
      const parsed = normalizePhoneNumber(phoneJid)
      if (!parsed.error) return parsed.phone + WHATSAPP_USER_SUFFIX
    }
    if (phoneJid && typeof phoneJid.phoneNumber === 'string') {
      const parsed = normalizePhoneNumber(phoneJid.phoneNumber)
      if (!parsed.error) return parsed.phone + WHATSAPP_USER_SUFFIX
    }
  } catch {}

  // A quoted LID identifies a real sender from an earlier group message.
  return jid
}

module.exports = {
  pattern: 'add',
  alias: [],
  desc: 'Add a WhatsApp user to this group by number or replied message',
  usage:
    '.add +234 812 345 6789 | .add 0812 345 6789 | reply to their message with .add',
  category: 'group',
  adminOnly: true,
  botAdmin: true,

  async run({ sock, from, msg, args, isAdmin, isOwner, isBotAdmin, isGroup }) {
    if (!isGroup || !from.endsWith('@g.us')) {
      return reply(sock, from, msg, 'This command works in groups only.')
    }

    if (!isAdmin && !isOwner) {
      return reply(
        sock,
        from,
        msg,
        'Only a group admin or the bot owner can add people.',
      )
    }

    if (!isBotAdmin) return sendBotNotAdmin(sock, from, msg)

    const target = getTarget(args, msg)
    if (target && target.error) {
      return reply(sock, from, msg, target.error)
    }
    if (!target) {
      return reply(
        sock,
        from,
        msg,
        [
          'To add someone, send a number with its country code:',
          '• *.add +234 812 345 6789*',
          '• *.add 234 812 345 6789*',
          '• *.add 0812 345 6789* (Nigerian local format)',
          '',
          'Or reply to a message from the person who left and send *.add*.',
        ].join('\n'),
      )
    }

    let targetJid
    let targetLabel
    if (target.phone) {
      const checked = await verifyPhoneNumber(sock, target.phone).catch(() => ({
        error: 'WhatsApp could not verify that number right now. Please try again.',
      }))
      if (checked.error) return reply(sock, from, msg, checked.error)
      if (!checked.registered) {
        await react(sock, from, msg, '❌')
        return reply(
          sock,
          from,
          msg,
          'That number is not registered on WhatsApp. Check it and include the correct country code.',
        )
      }
      targetJid = checked.jid
      targetLabel = '+' + target.phone
    } else if (target.jid.endsWith('@lid')) {
      targetJid = await resolveQuotedLid(sock, target.jid)
      targetLabel = labelForJid(targetJid)
    } else {
      targetJid = target.jid
      targetLabel = '+' + target.phone
    }

    let results
    try {
      results = await sock.groupParticipantsUpdate(from, [targetJid], 'add')
    } catch (error) {
      const status = getStatus(error)
      if (status === 401) return sendBotNotAdmin(sock, from, msg)
      const message = /connection (?:was )?closed|connection terminated/i.test(
        String(error && error.message),
      )
        ? 'The bot’s WhatsApp connection is temporarily unavailable. Please try again shortly.'
        : explainAddFailure(status)
      await react(sock, from, msg, '❌')
      return reply(sock, from, msg, message)
    }

    const result = Array.isArray(results) ? results[0] : null
    const status = getStatus(result)
    if (status === 200) {
      await react(sock, from, msg, '✅')
      return reply(sock, from, msg, 'Added ' + targetLabel + ' to this group.')
    }
    if (status === 401) return sendBotNotAdmin(sock, from, msg)

    await react(sock, from, msg, status === 403 ? '❗' : '❌')
    return reply(sock, from, msg, explainAddFailure(status))
  },
}
