'use strict'
const { sendOwnerRestricted } = require('../lib/groupAdminNotice')

// ════════════════════════════════════════════════════════════════════
//  commands/characterai.js — ZEN X | .characterai   (bot owner only)
//
//  .characterai on                turn it on (the last character, or the default rage-bait troll)
//  .characterai set <character>   turn it on as that character (e.g. spiderman)
//  .characterai off               turn it off
//  .characterai status            show the current state and how many keys are loaded
//  .characterai reset             forget every chat's memory
//
//  Run it from your own DM with the bot, or from any chat.
// ════════════════════════════════════════════════════════════════════

const engine = require('../core/characterai')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'
const USAGE =
  '*Character AI*\n\n' +
  '• *.characterai on* — turn it on (default: rage-bait troll)\n' +
  '• *.characterai set <character>* — e.g. _.characterai set spiderman_\n' +
  '• *.characterai off* — turn it off\n' +
  '• *.characterai status* — show the state\n' +
  '• *.characterai reset* — forget all chat memory'

module.exports = {
  name: 'characterai',
  aliases: ['charai'],
  desc: 'Make the bot reply as a character (set / off / status / reset)',
  usage: '.characterai on | set <character> | off | status | reset',
  category: 'ai',

  run: async ({ sock, from, msg, args, text, isOwner }) => {
    const reply = t => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}` }, { quoted: msg })

    if (!isOwner) return sendOwnerRestricted(sock, msg?.key?.remoteJid, msg)

    const phone = engine.phoneOf(sock)
    const words = (Array.isArray(args) ? args : String(text || '').split(/\s+/)).filter(Boolean)
    const sub = (words[0] || '').toLowerCase()
    const character = words.slice(1).join(' ').trim()

    if (sub === 'on') {
      const cfg = engine.getConfig(phone)
      const chosen = cfg.character || engine.DEFAULT_CHARACTER
      engine.saveConfig(phone, { enabled: true, character: chosen, updatedAt: Date.now() })
      return reply(
        `🟢 *Character AI is ON*\n` +
        `🎭 Character: *${chosen}*${chosen === engine.DEFAULT_CHARACTER ? ' (default)' : ''}\n` +
        `⌨️ Typing before each reply: ${engine.TYPING_MS / 1000}s\n` +
        `🔑 Gemini keys loaded: ${engine.loadKeys().length}\n` +
        `🎙️ Voice replies: ${Math.round(engine.VOICE_CHANCE * 100)}% when configured (${engine.voiceKeyCount()} ElevenLabs keys)`
      )
    }

    if (sub === 'set') {
      if (character.length < 2 || character.length > 60) {
        return reply('❌ Give a character name, 2 to 60 characters.\nExample: *.characterai set spiderman*')
      }
      engine.saveConfig(phone, { enabled: true, character, updatedAt: Date.now() })
      const seconds = engine.TYPING_MS / 1000
      return reply(
        `🟢 *Character AI is ON*\n` +
        `🎭 Character: *${character}*\n` +
        `⌨️ Typing before each reply: ${seconds}s\n` +
        `🔑 Gemini keys loaded: ${engine.loadKeys().length}\n` +
        `🎙️ Voice replies: ${Math.round(engine.VOICE_CHANCE * 100)}% when configured (${engine.voiceKeyCount()} ElevenLabs keys)\n\n` +
        `Direct messages always get a reply. In groups, the bot answers only when someone mentions it or replies to it.`
      )
    }

    if (sub === 'off') {
      const cfg = engine.getConfig(phone)
      engine.saveConfig(phone, { ...cfg, enabled: false, updatedAt: Date.now() })
      return reply('🔴 *Character AI is OFF*. The bot will stop replying as a character.')
    }

    if (sub === 'reset') {
      engine.clearMemory(phone)
      return reply('🧹 Character AI memory cleared for every chat.')
    }

    if (sub === 'status') {
      const cfg = engine.getConfig(phone)
      if (!cfg.enabled || !cfg.character) return reply('📊 *Character AI:* 🔴 OFF')
      return reply(
        `📊 *Character AI:* 🟢 ON\n` +
        `🎭 Character: *${cfg.character}*\n` +
        `🧠 Model: ${engine.MODEL}\n` +
        `🔑 Gemini keys loaded: ${engine.loadKeys().length}\n` +
        `🎙️ Voice replies: ${Math.round(engine.VOICE_CHANCE * 100)}% when configured (${engine.voiceKeyCount()} ElevenLabs keys)`
      )
    }

    return reply(USAGE)
  },
}
