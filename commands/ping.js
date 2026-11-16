// commands/ping.js — ZEN X responsive ping
'use strict'

module.exports = {
  name: 'ping',
  pattern: 'ping',
  // Keep ping out of the general session queue so slow media/API work cannot
  // hold its progress reply behind unrelated commands from this same session.
  independent: true,

  run: async ({ sock, from, msg }) => {
    const startedAt = process.hrtime.bigint()
    const progress = await sock.sendMessage(
      from,
      { text: '⏳ *PINGING ZEN X…*' },
      { quoted: msg }
    )
    if (!progress?.key) throw new Error('WhatsApp did not return the ping message key')

    // This is the time until WhatsApp acknowledges the initial reply, not a
    // fabricated server/network round-trip measurement.
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9
    const finalText = `> 🏓 *PINGED • ${elapsedSeconds.toFixed(3)} seconds*`
    await sock.sendMessage(from, { text: finalText, edit: progress.key })
  },
}
