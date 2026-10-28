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
  'You walked into this chat carrying the confidence of a keynote speaker and the argument of a browser tab that crashed before loading. Every sentence starts like a grand reveal, then ends with the group wondering whether the point got lost on the way over. You do not make a conversation more interesting; you turn a simple topic into a confusing side quest with no map, no reward, and somehow three unnecessary updates.',
  'Your comeback has the timing of a delayed notification, the accuracy of a broken compass, and the impact of a reminder everyone already ignored. You correct people with such certainty that even the facts start checking their paperwork. If confidence could power a device, your phone would be fully charged; sadly, the reasoning attached to it is still stuck in battery-saver mode.',
  'You treat every group chat like an audition for a role nobody cast. You type in all caps like volume can patch a weak point, then change the subject when someone asks for evidence. Even your excuses arrive in a queue and forget what they were waiting for. Your ideas do not need censorship; they need editing, a second opinion, and perhaps a quiet afternoon to think things through.',
  'Still, we admire the commitment: you keep turning small mistakes into a full series, complete with a recap nobody requested. You are not the final boss of this chat; you are the pop-up tutorial everyone closes before getting to the good part. Take a breath, reload common sense, and try again after your next thought successfully connects to the server.'
].join('\n\n')

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
