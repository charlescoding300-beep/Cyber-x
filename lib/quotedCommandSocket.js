'use strict'

/**
 * Apply WhatsApp reply quoting to command output sent back into the same chat.
 * Reactions, deletes, edits, and messages sent to other chats keep their
 * existing behavior. The wrapper reads sendMessage dynamically so other
 * socket middleware (for example autotag) remains in the call chain.
 */
function createQuotedCommandSocket(sock, sourceMessage, sourceChat, resolveGroupMetadata) {
  if (!sock || (!sourceMessage?.key?.id && typeof resolveGroupMetadata !== 'function')) return sock

  const chat = sourceChat || sourceMessage.key.remoteJid
  const boundMethods = new Map()
  let cachedSendMessage
  let cachedSendWrapper

  return new Proxy(sock, {
    get(target, property) {
      if (property === 'groupMetadata' && typeof resolveGroupMetadata === 'function') {
        return resolveGroupMetadata
      }
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value

      if (property === 'sendMessage') {
        if (value === cachedSendMessage && cachedSendWrapper) return cachedSendWrapper
        cachedSendMessage = value
        cachedSendWrapper = function (jid, content, options, ...rest) {
          if (
            jid !== chat ||
            !content || typeof content !== 'object' || Buffer.isBuffer(content) ||
            content.react || content.delete || content.protocolMessage || content.edit ||
            options?.edit
          ) {
            return Reflect.apply(value, target, [jid, content, options, ...rest])
          }

          let outgoingContent = content
          let outgoingOptions = options
          const hasEmbeddedQuote = Object.prototype.hasOwnProperty.call(content, 'quoted')
          const embeddedQuote = hasEmbeddedQuote ? content.quoted : undefined

          if (hasEmbeddedQuote) {
            outgoingContent = { ...content }
            delete outgoingContent.quoted
          }

          if (!options?.quoted && !embeddedQuote) {
            outgoingOptions = { ...(options || {}), quoted: sourceMessage }
          } else if (embeddedQuote && !options?.quoted) {
            outgoingOptions = { ...(options || {}), quoted: embeddedQuote }
          }

          return Reflect.apply(value, target, [jid, outgoingContent, outgoingOptions, ...rest])
        }
        return cachedSendWrapper
      }

      const cached = boundMethods.get(property)
      if (cached?.original === value) return cached.bound
      const bound = value.bind(target)
      boundMethods.set(property, { original: value, bound })
      return bound
    },

    set(target, property, value) {
      if (property !== 'sendMessage') boundMethods.delete(property)
      return Reflect.set(target, property, value, target)
    },
  })
}

module.exports = { createQuotedCommandSocket }
