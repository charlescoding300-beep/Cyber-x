'use strict'

function unwrapMessage(message) {
  let current = message?.message || {}
  for (let i = 0; i < 6; i++) {
    const inner = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.documentWithCaptionMessage?.message
    if (!inner) break
    current = inner
  }
  return current
}

function getContextInfo(message) {
  const content = unwrapMessage(message)
  for (const value of Object.values(content)) {
    if (value?.contextInfo) return value.contextInfo
  }
  return {}
}

function cleanJid(value) {
  return String(value || '').trim().replace(/:\d+(?=@)/, '')
}

function phoneDigits(jid) {
  const value = cleanJid(jid)
  const at = value.lastIndexOf('@')
  return (at >= 0 ? value.slice(0, at) : value).replace(/\D/g, '')
}

function resolveTarget(msg, args, sender) {
  const context = getContextInfo(msg)
  if (context.participant) return cleanJid(context.participant)
  if (context.mentionedJid?.[0]) return cleanJid(context.mentionedJid[0])

  const typedNumber = (Array.isArray(args) ? args : [])
    .join(' ')
    .replace(/\D/g, '')
  if (/^[1-9]\d{6,14}$/.test(typedNumber)) return typedNumber + '@s.whatsapp.net'

  return cleanJid(sender || msg?.key?.participant || msg?.participant || '')
}

const ROAST = [
  'You bring a whole press conference to make one point, then forget the point halfway through. Your confidence has a five-star review; the evidence is still waiting for approval. You are proof that a loud entrance and a strong argument are two very different things.'
].join(' ')

async function roastCommand(ctx = {}) {
  const { sock, from, msg, args, sender } = ctx
  if (!sock?.sendMessage || !from || !msg) return

  const targetJid = resolveTarget(msg, args, sender)
  const digits = phoneDigits(targetJid)
  const mentionJid = targetJid?.includes('@') ? targetJid : null
  const targetLine = mentionJid && digits ? `🎯 *Target:* @${digits}\n\n` : ''
  const text = `🔥 *ROAST MODE*\n\n${targetLine}${ROAST}`

  return sock.sendMessage(from, {
    text,
    mentions: mentionJid ? [mentionJid] : [],
  }, { quoted: msg })
}

module.exports = {
  name: 'roast',
  aliases: ['burn', 'clap', 'deadass'],
  description: 'Send a long, savage comedy roast',
  usage: '.roast (reply, mention, or number)',
  category: 'fun',
  execute: roastCommand,
  run: roastCommand,
}
