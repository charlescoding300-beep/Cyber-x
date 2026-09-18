'use strict'

module.exports = {
  pattern: "del",
  aliases: ["delete"],
  category: "utility",
  description: "Delete a replied message",

  run: async ({ sock, from, msg, isAdmin, isOwner, isGroup }) => {

    // React to the .del command itself
    const react = async (emoji) => {
      try {
        await sock.sendMessage(from, {
          react: {
            text: emoji,
            key: msg.key
          }
        })
      } catch {}
    }

    try {
      // ── Get the replied message ────────────────────────────
      const message =
        msg.message?.extendedTextMessage ||
        msg.message?.imageMessage ||
        msg.message?.videoMessage ||
        msg.message?.documentMessage ||
        msg.message?.conversation

      const contextInfo = message?.contextInfo

      if (!contextInfo?.quotedMessage || !contextInfo?.stanzaId) {
        return await react("❌")
      }

      const quotedMessage = contextInfo.quotedMessage
      const quotedStanzaId = contextInfo.stanzaId
      const quotedParticipant = contextInfo.participant

      // ── Detect whether the quoted message is from the bot ──
      const botJid = sock.user?.id || ""
      const botNumber = botJid.split(":")[0].split("@")[0]

      const quotedNumber =
        (quotedParticipant || "").split(":")[0].split("@")[0]

      const isOwnMessage =
        quotedMessage?.key?.fromMe === true ||
        quotedParticipant === botJid ||
        (quotedNumber && botNumber && quotedNumber === botNumber)

      // ── PRIVATE CHAT ───────────────────────────────────────
      // In a DM, deletion follows WhatsApp's normal permissions.
      if (!isGroup) {
        await sock.sendMessage(from, {
          delete: {
            remoteJid: from,
            fromMe: isOwnMessage,
            id: quotedStanzaId,
            ...(quotedParticipant
              ? { participant: quotedParticipant }
              : {})
          }
        })

        return await react("🗑️")
      }

      // ── GROUP ──────────────────────────────────────────────
      //
      // Own message:
      // Allowed even when the bot is NOT a group admin.
      //
      // Somebody else's message:
      // Bot MUST be a group admin.
      //

      if (isOwnMessage) {
        await sock.sendMessage(from, {
          delete: {
            remoteJid: from,
            fromMe: true,
            id: quotedStanzaId
          }
        })

        return await react("🗑️")
      }

      // Someone else's message requires bot admin.
      if (!isAdmin) {
        return await react("❌")
      }

      // Bot is admin — delete the other person's message.
      await sock.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: false,
          id: quotedStanzaId,
          participant: quotedParticipant
        }
      })

      return await react("🗑️")

    } catch (error) {
      console.error("[DEL ERROR]", error.message)

      // No text — only ❌ on the .del command.
      await react("❌")
    }
  }
}
