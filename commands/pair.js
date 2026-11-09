'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — WhatsApp Pairing
//
// Uses the SAME pairing engine as the Telegram pairing system:
// VPS /pair?phone=NUMBER
//
// No second Baileys socket is created here.

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

// VPS pairing server
const PAIR_PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000
const PAIR_SERVER = `http://127.0.0.1:${PAIR_PORT}`

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
  const input = String(raw || '').trim()
  if (!input || !/^[+()\d\s.-]+$/.test(input)) return ''
  let number = input.replace(/\D/g, '')
  if (number.startsWith('00')) number = number.slice(2)
  return number
}

function validNumber(number) {
  return /^\d{7,15}$/.test(number) && !number.startsWith('0')
}

function privateJidForMessage(msg, sender, senderAlt) {
  const candidates = [
    senderAlt,
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    sender,
    msg?.key?.participant,
  ].filter(value => typeof value === 'string' && value.includes('@'))
  return candidates.find(jid => /@(s\.whatsapp\.net|lid)$/i.test(jid)) || null
}

function pairingInstructions(number, slot) {
  return `> 🔗 *ZEN X PAIRING CODE*
>
> 📱 Number: *${number}*
> 🧩 Slot: *${slot ?? 'auto'}*
>
> Watch the phone for WhatsApp’s “Enter code to link new device” notification.
>
> If it does not appear, open:
> *Settings → Linked Devices → Link a Device → Link with phone number instead*
>
> Enter the code from the next message. The code expires quickly.
>
${CREDIT}`
}

module.exports = {
  pattern: 'pair',
  desc: 'Generate a WhatsApp pairing code',
  usage: '.pair <number>',
  category: 'owner',

  run: async ({ sock, from, msg, args, sender, senderAlt }) => {

    const isGroup = String(from || '').endsWith('@g.us')

    const raw = (args || []).join(' ').trim()
    const number = normalizeNumber(raw)

    if (!raw) {
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
> Use a full international number with country code.
> A leading +, spaces, hyphens, or parentheses are okay.
>
> Example: *.pair +234 801 234 5678*
>
${CREDIT}`,
          contextInfo: buildChannelContext(),
        },
        { quoted: msg }
      )
    }

    const privateJid = isGroup
      ? privateJidForMessage(msg, sender, senderAlt)
      : from

    if (!privateJid) {
      return sock.sendMessage(from, {
        text: `> ❌ *PRIVATE DELIVERY UNAVAILABLE*\n>\n> Open the bot’s DM and run *.pair <number>* there.\n\n${CREDIT}`,
        contextInfo: buildChannelContext(),
      }, { quoted: msg })
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

      console.log(`[PAIR] Requesting VPS pairing for +…${number.slice(-4)}`)

      const response = await fetch(url, { signal: AbortSignal.timeout(35_000) })

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

      console.log(`[PAIR] Real pairing code generated for +…${number.slice(-4)}`)

      if (isGroup) {
        await sock.sendMessage(privateJid, {
          text: pairingInstructions(number, result.slot) +
            `\n\n> 🔐 *Pairing code: ${code}*`,
          contextInfo: buildChannelContext(),
        })

        await sock.sendMessage(
          from,
          {
            text: '> ✅ *PAIRING CODE SENT PRIVATELY*\n> Check your private chat with the bot to continue.',
            mentions: [privateJid],
          },
          { quoted: msg }
        ).catch(error => {
          console.error('[PAIR] Group confirmation failed:', error?.message || error)
        })
      } else {
        await sock.sendMessage(
          from,
          {
            text: pairingInstructions(number, result.slot),
            contextInfo: buildChannelContext(),
          },
          { quoted: msg }
        )
        await sock.sendMessage(from, { text: code }, { quoted: msg })
      }

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

      const failureReason = isGroup
        ? 'Could not generate or privately deliver the code. Open the bot’s DM and try again.'
        : error?.message || 'Could not contact the pairing server.'
      await sock.sendMessage(
        from,
        {
          text:
`> ❌ *PAIRING FAILED*
>
> ${failureReason}
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
