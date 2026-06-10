// ════════════════════════════════════════════════════════════════════
//  commands/battle.js  —  CYBER X  |  ⚔️ Pokémon Battle
//
//  .battle @user          → challenge a mentioned user
//  .battle (reply to msg) → challenge the person you replied to
//
//  • Challenger must own a Pokémon (.buy one first)
//  • Opponent has 2 minutes to .accept
//  • Battle auto-simulates, editing ONE message per round
//  • Winner gets coins = 50% of loser's active Pokémon price
// ════════════════════════════════════════════════════════════════════

const {
  DB, saveData, POKEMON, gifUrl,
  typeEmoji, tierEmoji, hpBar,
  getUser, getActiveCard, sleep,
} = require('../lib/pokemonEngine')

const BATTLE_TIMEOUT_MS = 120_000  // 2 min to accept

module.exports = {
  pattern:  "battle",
  desc:     "⚔️ Challenge another user to a Pokémon battle",
  usage:    ".battle @user  |  reply to a message + .battle",
  category: "game",

  run: async ({ sock, from, msg, sender, args }) => {
    const uid1     = sender.replace(/@.+/, "")
    const name1    = msg.pushName || uid1
    const card1    = getActiveCard(uid1)

    // ── Check challenger has a Pokémon ──
    if (!card1) {
      return sock.sendMessage(from, {
        text:
          `😔 You don't have a Pokémon to battle with!\n\n` +
          `📖 *.pokedex* — browse Pokémon\n` +
          `🛒 *.buy <name>* — buy one\n` +
          `🎰 *.slot* — earn coins`,
      }, { quoted: msg })
    }

    // ── Find opponent UID from mention or quoted message ──
    let uid2 = null
    let name2 = null

    // Mentioned user?
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
                      msg.message?.groupMentionedMessage?.mentionedJids || []
    if (mentioned.length) {
      uid2  = (Array.isArray(mentioned) ? mentioned[0] : mentioned).replace(/@.+/, "")
      name2 = uid2
    }

    // Quoted message?
    if (!uid2) {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant ||
                     msg.message?.extendedTextMessage?.contextInfo?.remoteJid
      if (quoted) uid2 = quoted.replace(/@.+/, "")
      name2 = uid2
    }

    if (!uid2 || uid2 === uid1) {
      return sock.sendMessage(from, {
        text:
          `⚔️ *How to battle:*\n\n` +
          `1. Tag someone: *.battle @user*\n` +
          `2. Reply to their message: *.battle*\n\n` +
          `Make sure BOTH players own a Pokémon!`,
      }, { quoted: msg })
    }

    // ── Check opponent has a Pokémon ──
    const card2 = getActiveCard(uid2)
    if (!card2) {
      return sock.sendMessage(from, {
        text:
          `😅 *${uid2}* doesn't have a Pokémon yet!\n` +
          `They need to *.buy* one first.`,
      }, { quoted: msg })
    }

    // ── No active battle already? ──
    const battleKey = [uid1, uid2].sort().join("|")
    if (DB.activeBattles[battleKey] || DB.pendingBattles[battleKey]) {
      return sock.sendMessage(from, {
        text: `⚔️ A battle between you two is already in progress!`,
      }, { quoted: msg })
    }

    // ── Prize = 50% of opponent's active Pokémon price ──
    const pkm1  = POKEMON[card1.pokemonId]
    const pkm2  = POKEMON[card2.pokemonId]
    const prize = Math.max(50, Math.floor(POKEMON[card2.pokemonId].price * 0.5))

    // Store pending battle
    DB.pendingBattles[battleKey] = {
      uid1, uid2, name1, name2, card1, card2, prize,
      from, initiatedAt: Date.now(),
    }
    saveData()

    // ── Auto-expire after 2 minutes ──
    setTimeout(() => {
      if (DB.pendingBattles[battleKey]) {
        delete DB.pendingBattles[battleKey]
        saveData()
        sock.sendMessage(from, {
          text: `⏰ Battle challenge from *${name1}* to *@${uid2}* expired!`,
          mentions: [`${uid2}@s.whatsapp.net`],
        }).catch(() => {})
      }
    }, BATTLE_TIMEOUT_MS)

    // ── Challenge message ──
    const pkm1Name = pkm1.name
    const pkm2Name = pkm2.name

    const challengeText =
      `╔══════════════════════════════╗\n` +
      `║   ⚔️  *BATTLE CHALLENGE!*  ⚔️  ║\n` +
      `╚══════════════════════════════╝\n\n` +
      `🔴 *${name1}* challenges @${uid2}!\n\n` +
      `🔴 ${name1}'s Pokémon:\n` +
      `   ${tierEmoji(pkm1.tier)} *${pkm1Name}* ${typeEmoji(pkm1.type)}\n` +
      `   ❤️${pkm1.hp}  ⚔️${pkm1.atk}  🛡️${pkm1.def}  💨${pkm1.spd}\n\n` +
      `🔵 ${uid2}'s Pokémon:\n` +
      `   ${tierEmoji(pkm2.tier)} *${pkm2Name}* ${typeEmoji(pkm2.type)}\n` +
      `   ❤️${pkm2.hp}  ⚔️${pkm2.atk}  🛡️${pkm2.def}  💨${pkm2.spd}\n\n` +
      `💰 Winner gets: *${prize} coins*\n\n` +
      `⏳ @${uid2}, type *.accept* within 2 minutes!`

    try {
      await sock.sendMessage(from, {
        video:    { url: gifUrl(card1.pokemonId) },
        gifPlayback: true,
        caption:  challengeText,
        mentions: [`${uid2}@s.whatsapp.net`],
      }, { quoted: msg })
    } catch {
      await sock.sendMessage(from, {
        text:     challengeText,
        mentions: [`${uid2}@s.whatsapp.net`],
      }, { quoted: msg })
    }
  },
}
