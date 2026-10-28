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
  'You have the confidence of someone who has never once let a fact interrupt a good speech. You enter a conversation like the headline act, then deliver a point so shaky it needs its own support group. People do not lose track of what you mean; they are simply waiting for the meaning to show up. You can turn a one-line question into a lecture, a detour, and a dramatic return to the original point without ever actually answering it.',
  'Your comebacks arrive with all the force of a wet napkin and somehow still manage to miss the target. You correct people before understanding them, explain things nobody asked about, and announce obvious details like you have just uncovered a government secret. When someone asks for proof, you switch to “you know what I mean,” which is convenient because apparently nobody does. You are not hard to follow because you are mysterious; you are hard to follow because your thoughts keep taking unscheduled exits.',
  'In this group chat, your messages have the same effect as a fire alarm during a movie: everyone stops, looks around, and hopes it is over quickly. You type like every thought deserves a press conference, even when the thought itself could have fit in a notification. Your confidence is impressive, especially considering how often your conclusion arrives before your reasoning. If changing the subject were a sport, you would still somehow argue with the scoreboard.',
  'The best part is how you make a small mistake, defend it like a national monument, then act surprised when people remember it. You do not need a dramatic entrance; your first sentence already brings enough noise. Take a moment, reread what you wrote, and give your point a chance to catch up with your confidence. Until then, keep the speeches coming: the chat could use another example of a lot of words working overtime to say very little.'
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
