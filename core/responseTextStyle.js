'use strict'

// Compact oversized message frames and apply the bot's display font at the
// shared WhatsApp send boundary, including replies from future commands.
const MONOSPACE_CAPITAL_A = 0x1D670
const PROTECTED_TEXT = /```[\s\S]*?```|`[^`\r\n]*`|(?:https?:\/\/|www\.)[^\s<>{}]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?:\/[^\s<>{}]*)?|@[A-Z0-9._+-]+|[.!/#?][A-Z][A-Z0-9_-]*/giu
const BOLD_PROTECTED_TEXT = new RegExp(
  String.raw`(?:\*[^*]+\*|_[^_\r\n]+_|~[^~\r\n]+~|${PROTECTED_TEXT.source})`,
  'giu',
)
const RESPONSE_STYLE_BYPASS = '__responseTextStyleBypass'
const CODE_SPAN = /```[\s\S]*?```|`[^`\r\n]*`/g

// LLM replies and a few commands arrive as Markdown (**bold**, # headings,
// "* " bullets). WhatsApp only understands single-asterisk bold, so a raw
// "**word**" shows literal stars. Normalize to one marker per style run while
// leaving fenced/inline code untouched.
function normalizeMarkdown(text) {
  if (
    !text.includes('**') &&
    !text.includes('__') &&
    !text.includes('#') &&
    !text.includes('\n* ') &&
    !text.startsWith('* ')
  ) return text

  const code = []
  let output = text.replace(CODE_SPAN, match => {
    code.push(match)
    return `\u0000RESPONSE_CODE_${code.length - 1}\u0000`
  })

  output = output
    // "# Heading" / "### Heading" -> bold heading
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_match, title) => `*${title.trim()}*`)
    // "* bullet" -> "• bullet" so the bullet star is not read as bold
    .replace(/^[ \t]*\*[ \t]+/gm, '• ')
    // Markdown bold, including multi-line spans -> WhatsApp bold
    .replace(/\*\*([\s\S]+?)\*\*/g, '*$1*')
    // Markdown underline bold -> WhatsApp italic
    .replace(/__([^_\r\n]+)__/g, '_$1_')
    // Collapse any leftover runs (***text*** and stray markers)
    .replace(/\*{2,}/g, '*')

  for (let index = 0; index < code.length; index++) {
    output = output.replace(`\u0000RESPONSE_CODE_${index}\u0000`, code[index])
  }
  return output
}

function compactLayout(text) {
  // Keep complete box panels intact. Compacting only their top and bottom
  // borders made the Anti-Link and other framed replies look split or uneven.
  const panels = []
  let compactable = text.replace(
    /^[┏╭][━─]{3,}「[^\r\n」]+」[━─]{3,}[┓╮]\r?\n[\s\S]*?^[┗╰][━─]{3,}[┛╯]$/gmu,
    panel => {
      const token = `\u0000RESPONSE_PANEL_${panels.length}\u0000`
      panels.push([token, panel])
      return token
    },
  )

  compactable = compactable
    // Replace oversized title frames with one compact, consistent heading.
    .replace(/[┏╭]([━─]{3,})「\s*([^」]+?)\s*」([━─]{3,})[┓╮]/gu,
      (_match, _left, title) => `╭─「 ${title.trim()} 」─╮`)
    // Convert legacy three-line boxes into a clean heading without changing
    // the words inside the box.
    .replace(/╔═{20,}╗[ \t]*\r?\n║[ \t]*(.*?)[ \t]*║[ \t]*\r?\n╚═{20,}╝/gu,
      (_match, title) => `「 ${title.trim()} 」`)
    // Keep dividers readable on WhatsApp without very wide runs of glyphs.
    .replace(/[━═─]{22,}/gu, run => run[0].repeat(18))

  for (const [token, panel] of panels) compactable = compactable.replace(token, panel)
  return compactable
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

const MARKERS = '*_~'

function wrapWords(text, before, after) {
  const padBefore = before && MARKERS.includes(before)
  const padAfter = after && MARKERS.includes(after)
  const input = (padBefore ? '*' : '') + text + (padAfter ? '*' : '')
  const styled = input.replace(
    /(?<![*_~\p{L}\p{N}])[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?![*_~\p{L}\p{N}])/gu,
    word => `*${word}*`,
  )
  return styled.slice(padBefore ? 1 : 0, styled.length - (padAfter ? 1 : 0))
}

function boldText(text) {
  let output = ''
  let cursor = 0
  for (const match of text.matchAll(BOLD_PROTECTED_TEXT)) {
    output += wrapWords(text.slice(cursor, match.index), text[match.index - 1], match[0][0]) + match[0]
    cursor = match.index + match[0].length
  }
  return output + wrapWords(text.slice(cursor), text[cursor - 1], '')
}

function stylizeText(text) {
  if (typeof text !== 'string' || !text) return text

  text = boldText(normalizeMarkdown(compactLayout(text)))

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
