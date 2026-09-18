'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — .getpp
// Gets the profile picture of the person whose message was replied to.

module.exports = {
  pattern: "getpp",
  alias: ["pp", "profilepic", "profile"],
  category: "utility",
  desc: "Get the profile picture of a replied user",
  usage: ".getpp (reply to a message)",

  run: async ({ sock, from, msg }) => {

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
      const message = msg.message || {}

      // Get the command's reply context
      const context =
        message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        message.documentMessage?.contextInfo ||
        message.audioMessage?.contextInfo ||
        message.stickerMessage?.contextInfo ||
        {}

      /*
       * WhatsApp puts the person who owns the
       * replied-to message in contextInfo.participant.
       *
       * We take that JID silently in the background.
       */
      let targetJid = context.participant || null

      // LID participant, if present
      if (!targetJid) {
        targetJid =
          context.participantAlt ||
          context.quotedParticipant ||
          null
      }

      // Nothing was replied to
      if (!targetJid) {
        await react('❌')
        return
      }

      console.log(`[GETPP] Target JID: ${targetJid}`)

      /*
       * Fetch the profile picture directly from WhatsApp
       * using the quoted person's JID.
       */
      let ppUrl = null

      try {
        ppUrl = await sock.profilePictureUrl(targetJid, 'image')
      } catch (e) {
        console.log(
          `[GETPP] profilePictureUrl failed for ${targetJid}:`,
          e?.message || e
        )
      }

      if (!ppUrl) {
        await react('❌')
        return
      }

      /*
       * Send the actual profile picture to WhatsApp.
       * The JID is never shown to the user.
       */
      await sock.sendMessage(
        from,
        {
          image: { url: ppUrl }
        },
        {
          quoted: msg
        }
      )

      await react('🖼️')

    } catch (error) {
      console.error('[GETPP ERROR]', error?.message || error)
      await react('❌')
    }
  }
}
