// ════════════════════════════════════════════════════════════════════
//  commands/accept.js  —  CYBER X  |  ✅ Accept Battle
//  .accept   → accept the most recent battle challenge sent to you
// ════════════════════════════════════════════════════════════════════

const {
  DB, saveData, POKEMON, gifUrl,
  typeEmoji, tierEmoji, sleep, editMsg,
  getUser, runBattle,
} = require('../lib/pokemonEngine')

module.exports = {
  pattern:  "accept",
  desc:     "✅ Accept a Pokémon battle challenge",
  usage:    ".accept",
  category: "game",

  run: async ({ sock, from, msg, sender }) => {
    const uid2 = sender.replace(/@.+/, "")

    // Find a pending battle where this user is the opponent
    const entry = Object.entries(DB.pendingBattles).find(([, b]) => b.uid2 === uid2)

    if (!entry) {
      return sock.sendMessage(from, {
        text: `😶 You have no pending battle challenges!\nSomeone needs to *.battle* you first.`,
      }, { quoted: msg })
    }

    const [battleKey, battle] = entry
    delete DB.pendingBattles[battleKey]

    const { uid1, uid2: _uid2, name1, card1, card2, prize } = battle
    const name2 = msg.pushName || uid2

    // Update name2 with real pushName
    battle.name2 = name2

    const pkm1 = POKEMON[card1.pokemonId]
    const pkm2 = POKEMON[card2.pokemonId]

    // ── Battle START message (will be edited each round) ──
    const startText =
      `╔════════════════════════════╗\n` +
      `║   ⚔️  *BATTLE STARTING!*  ⚔️  ║\n` +
      `╚════════════════════════════╝\n\n` +
      `🔴 *${name1}* (${pkm1.name} ${typeEmoji(pkm1.type)})\n` +
      `🔵 *${name2}* (${pkm2.name} ${typeEmoji(pkm2.type)})\n\n` +
      `💰 Prize: *${prize} coins*\n\n` +
      `⏳ Battle begins in 3...`

    let sentMsg
    try {
      sentMsg = await sock.sendMessage(from, {
        video:       { url: gifUrl(card2.pokemonId) },
        gifPlayback: true,
        caption:     startText,
      })
    } catch {
      sentMsg = await sock.sendMessage(from, { text: startText })
    }

    await sleep(3000)

    // Register as active battle
    DB.activeBattles[battleKey] = { ...battle, name2 }
    saveData()

    // ── Run the battle (edits sentMsg each round) ──
    await runBattle(sock, from, battleKey, sentMsg.key)
  },
}

