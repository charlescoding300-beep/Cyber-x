// ════════════════════════════════════════════════════════════════════
//  commands/forfeit.js  —  CYBER X  |  🏳️ Forfeit Battle
//  .forfeit   → forfeit your active battle (opponent wins prize)
// ════════════════════════════════════════════════════════════════════

const { DB, saveData, getUser, addCoins } = require('../lib/pokemonEngine')

module.exports = {
  pattern:  "forfeit",
  desc:     "🏳️ Forfeit your current Pokémon battle",
  usage:    ".forfeit",
  category: "game",

  run: async ({ sock, from, msg, sender }) => {
    const uid      = sender.replace(/@.+/, "")
    const pushName = msg.pushName || uid

    // Find active battle
    const entry = Object.entries(DB.activeBattles).find(
      ([, b]) => b.uid1 === uid || b.uid2 === uid
    )

    if (!entry) {
      // Check pending battles too
      const pending = Object.entries(DB.pendingBattles).find(
        ([, b]) => b.uid1 === uid || b.uid2 === uid
      )
      if (pending) {
        delete DB.pendingBattles[pending[0]]
        saveData()
        return sock.sendMessage(from, {
          text: `🏳️ *${pushName}* cancelled the battle challenge.`,
        }, { quoted: msg })
      }

      return sock.sendMessage(from, {
        text: `😶 You're not in any active battle right now!`,
      }, { quoted: msg })
    }

    const [battleKey, battle] = entry
    const isChallenger = battle.uid1 === uid
    const winnerUid    = isChallenger ? battle.uid2 : battle.uid1
    const winnerName   = isChallenger ? battle.name2 : battle.name1

    // Award prize to opponent
    addCoins(winnerUid, battle.prize)
    getUser(winnerUid).battleWins++
    getUser(uid).battleLosses++

    delete DB.activeBattles[battleKey]
    saveData()

    return sock.sendMessage(from, {
      text:
        `🏳️ *${pushName}* forfeited the battle!\n\n` +
        `🏆 *${winnerName}* wins by forfeit!\n` +
        `💰 *+${battle.prize} coins* awarded to ${winnerName}.`,
    }, { quoted: msg })
  },
}
