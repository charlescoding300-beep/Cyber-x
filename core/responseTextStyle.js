'use strict'

// Compact oversized message frames and apply the bot's display font at the
// shared WhatsApp send boundary, including replies from future commands.
const MONOSPACE_CAPITAL_A = 0x1D670
const PROTECTED_TEXT = /```[\s\S]*?```|`[^`\r\n]*`|(?:https?:\/\/|www\.)[^\s<>{}]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?:\/[^\s<>{}]*)?|@[A-Z0-9._+-]+|[.!/#?][A-Z][A-Z0-9_-]*/giu
const RESPONSE_STYLE_BYPASS = '__responseTextStyleBypass'

function compactLayout(text) {
  return text
    // Replace oversized title frames with one compact, consistent heading.
    .replace(/[┏╭]([━─]{3,})「\s*([^」]+?)\s*」([━─]{3,})[┓╮]/gu,
      (_match, _left, title) => `╭─「 ${title.trim()} 」─╮`)
    // Convert legacy three-line boxes into a clean heading without changing
    // the words inside the box.
    .replace(/╔═{20,}╗[ \t]*\r?\n║[ \t]*(.*?)[ \t]*║[ \t]*\r?\n╚═{20,}╝/gu,
      (_match, title) => `「 ${title.trim()} 」`)
    // Keep dividers readable on WhatsApp without very wide runs of glyphs.
    .replace(/[━═─]{22,}/gu, run => run[0].repeat(18))
}

function stylizeSegment(text) {
  return Array.from(text, character => {
    const upper = character.toUpperCase()
    if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
      return String.fromCodePoint(MONOSPACE_CAPITAL_A + upper.charCodeAt(0) - 65)
    }
    return character
  }).join('')
}

function stylizeText(text) {
  if (typeof text !== 'string' || !text) return text

  text = compactLayout(text)

  let output = ''
  let cursor = 0
  for (const match of text.matchAll(PROTECTED_TEXT)) {
    output += stylizeSegment(text.slice(cursor, match.index))
    output += match[0]
    cursor = match.index + match[0].length
  }
  return output + stylizeSegment(text.slice(cursor))
}

function stylizeContent(content) {
  if (!content || typeof content !== 'object' || Buffer.isBuffer(content)) return content

  let result = content
  for (const key of ['text', 'caption']) {
    if (typeof content[key] === 'string') {
      if (result === content) result = { ...content }
      result[key] = stylizeText(content[key])
    }
  }

  if (content.poll && typeof content.poll === 'object') {
    const poll = { ...content.poll }
    let changed = false
    if (typeof poll.name === 'string') {
      poll.name = stylizeText(poll.name)
      changed = true
    }
    if (Array.isArray(poll.values)) {
      poll.values = poll.values.map(value => stylizeText(value))
      changed = true
    }
    if (changed) {
      if (result === content) result = { ...content }
      result.poll = poll
    }
  }

  return result
}

function attachResponseTextStyle(sock) {
  if (!sock || typeof sock.sendMessage !== 'function' || sock.__responseTextStyleAttached) return sock

  const sendMessage = sock.sendMessage.bind(sock)
  sock.sendMessage = (jid, content, ...args) => {
    const options = args[0]
    if (options && typeof options === 'object' && options[RESPONSE_STYLE_BYPASS]) {
      const forwardedOptions = { ...options }
      delete forwardedOptions[RESPONSE_STYLE_BYPASS]
      args[0] = forwardedOptions
      return sendMessage(jid, content, ...args)
    }
    return sendMessage(jid, stylizeContent(content), ...args)
  }
  Object.defineProperty(sock, '__responseTextStyleAttached', { value: true })
  return sock
}

function sendMessageUnstyled(sock, jid, content, ...args) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new TypeError('sendMessageUnstyled requires a socket with sendMessage')
  }
  if (!sock.__responseTextStyleAttached) return sock.sendMessage(jid, content, ...args)

  const options = args[0] && typeof args[0] === 'object' ? { ...args[0] } : {}
  options[RESPONSE_STYLE_BYPASS] = true
  return sock.sendMessage(jid, content, options, ...args.slice(1))
}

module.exports = { attachResponseTextStyle, sendMessageUnstyled, stylizeText, stylizeContent }
