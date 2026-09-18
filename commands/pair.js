'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — WhatsApp Pairing
//
// Uses the SAME pairing engine as the Telegram pairing system:
// VPS /pair?phone=NUMBER
//
// No second Baileys socket is created here.

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

// VPS pairing server
const PAIR_SERVER = 'http://3.235.9.247:3000'

const ZEN_X_CHANNEL_JID  = '120363431058647261@newsletter'
const ZEN_X_CHANNEL_NAME = 'ZEN X'

function buildChannelContext() {
  return {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: ZEN_X_CHANNEL_JID,
      newsletterName: ZEN_X_CHANNEL_NAME,
      serverMessageId: -1,
    },
  }
}

function normalizeNumber(raw) {
  return String(raw || '').replace(/\D/g, '')
}

function validNumber(number) {
  return number.length >= 10 && number.length <= 15
}

module.exports = {
  pattern: 'pair',
  desc: 'Generate a WhatsApp pairing code',
  usage: '.pair <number>',
  category: 'owner',

  run: async ({ sock, from, msg, args }) => {

    const raw = (args || []).join(' ').trim()
    const number = normalizeNumber(raw)

    if (!number) {
      return sock.sendMessage(
        from,
        {
          text:
`> 🔗 *ZEN X PAIRING*
>
> Usage: *.pair <number>*
>
> Example:
> *.pair 2348012345678*
>
${CREDIT}`,
          contextInfo: buildChannelContext(),
        },
        { quoted: msg }
      )
    }

    if (!validNumber(number)) {
      return sock.sendMessage(
        from,
        {
          text:
`> ❌ *INVALID NUMBER*
>
> Include the full international country code.
>
> Example:
> *.pair 2348012345678*
>
${CREDIT}`,
          contextInfo: buildChannelContext(),
        },
        { quoted: msg }
      )
    }

    await sock.sendMessage(from, {
      react: {
        text: '🔗',
        key: msg.key,
      },
    }).catch(() => {})

    try {

      /*
       * Call the SAME endpoint used by telegram.js.
       */
      const url =
        `${PAIR_SERVER}/pair?phone=${encodeURIComponent(number)}`

      console.log(`[PAIR] Requesting VPS pairing for ${number}`)

      const response = await fetch(url)

      let result

      try {
        result = await response.json()
      } catch {
        throw new Error(
          `Pairing server returned invalid data (${response.status})`
        )
      }

      if (
        !response.ok ||
        !result?.status ||
        !result?.code
      ) {
        throw new Error(
          result?.error ||
          `Pairing server returned HTTP ${response.status}`
        )
      }

      const code = String(result.code)

      console.log(
        `[PAIR] VPS generated code for ${number}: ${code}`
      )

      /*
       * Information message.
       */
      await sock.sendMessage(
        from,
        {
          text:
`> 🔗 *ZEN X PAIRING CODE*
>
> 📱 Number: *${number}*
> 🧩 Slot: *${result.slot ?? 'auto'}*
>
> Your pairing code is in the next message.
>
> On the WhatsApp phone:
>
> *Settings → Linked Devices → Link a Device → Link with phone number instead*
>
> Enter the code from the next message.
>
> The code expires quickly.
>
${CREDIT}`,
          contextInfo: buildChannelContext(),
        },
        { quoted: msg }
      )

      /*
       * RAW CODE ONLY.
       */
      await sock.sendMessage(from, {
        text: code,
      })

      await sock.sendMessage(from, {
        react: {
          text: '✅',
          key: msg.key,
        },
      }).catch(() => {})

    } catch (error) {

      console.error(
        '[PAIR ERROR]',
        error?.message || error
      )

      await sock.sendMessage(from, {
        react: {
          text: '❌',
          key: msg.key,
        },
      }).catch(() => {})

      await sock.sendMessage(
        from,
        {
          text:
`> ❌ *PAIRING FAILED*
>
> ${error?.message || 'Could not contact the pairing server.'}
>
> Check the number and try again.
>
${CREDIT}`,
          contextInfo: buildChannelContext(),
        },
        { quoted: msg }
      ).catch(() => {})
    }
  },
}
