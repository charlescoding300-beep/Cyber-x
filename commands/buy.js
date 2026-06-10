// ════════════════════════════════════════════════════════════════════
//  commands/buy.js  —  CYBER X  |  🛒 Buy Pokémon
//  .buy pikachu    → buy Pikachu with slot coins
//  .buy charizard  → buy Charizard
// ════════════════════════════════════════════════════════════════════

const {
  DB, saveData, POKEMON, gifUrl,
  tierEmoji, typeEmoji,
  getUser, hasCard, getCoins, addCoins,
} = require('../lib/pokemonEngine')

module.exports = {
  pattern:  "buy",
  desc:     "🛒 Buy a Pokémon using your slot coins",
  usage:    ".buy <pokemon name>",
  category: "game",

  run: async ({ sock, from, msg, sender, args }) => {
    const uid      = sender.replace(/@.+/, "")
    const pushName = msg.pushName || uid
    const query    = args.join(" ").toLowerCase().trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
          `❌ Tell me which Pokémon you want!\n` +
          `Usage: *.buy pikachu*\n` +
          `See all Pokémon: *.pokedex*`,
      }, { quoted: msg })
    }

    // Find Pokémon by name (fuzzy)
    const entry = Object.entries(POKEMON).find(
      ([, p]) => p.name.toLowerCase() === query ||
                 p.name.toLowerCase().startsWith(query)
    )

    if (!entry) {
      return sock.sendMessage(from, {
        text: `❓ Pokémon *"${query}"* not found.\nUse *.pokedex* to see the full list!`,
      }, { quoted: msg })
    }

    const [id, pkm] = entry
    const numId     = parseInt(id)
    const coins     = getCoins(uid)

    // Already owns it?
    if (hasCard(uid, numId)) {
      return sock.sendMessage(from, {
        text:
          `😅 You already own *${pkm.name}*!\n` +
          `Use *.mycard* to view your deck.\n` +
          `Use *.battle @user* to fight!`,
      }, { quoted: msg })
    }

    // Can afford?
    if (coins < pkm.price) {
      return sock.sendMessage(from, {
        text:
          `💸 *NOT ENOUGH COINS!*\n\n` +
          `*${pkm.name}* costs *${pkm.price} coins*\n` +
          `Your balance: *${coins} coins*\n\n` +
          `Earn more with *.slot* or *.slot daily*! 🎰`,
      }, { quoted: msg })
    }

    // Purchase!
    const newBal = addCoins(uid, -pkm.price)

    const card = {
      pokemonId: numId,
      name:      pkm.name,
      boughtAt:  Date.now(),
      xp:        0,
      wins:      0,
      losses:    0,
    }

    const user = getUser(uid)
    user.cards.push(card)

    // Auto-set as active if first card
    if (user.cards.length === 1) user.activeCard = 0

    saveData()

    // Send buy confirmation with animated GIF
    const caption =
      `╔══════════════════════════════╗\n` +
      `║   ✨  *POKÉMON OBTAINED!*  ✨  ║\n` +
      `╚══════════════════════════════╝\n\n` +
      `🎉 *${pushName}* got *${pkm.name}*!\n\n` +
      `${tierEmoji(pkm.tier)} Tier: *${pkm.tier.toUpperCase()}*\n` +
      `${typeEmoji(pkm.type)} Type: *${pkm.type.toUpperCase()}*\n\n` +
      `❤️  HP:  *${pkm.hp}*\n` +
      `⚔️  ATK: *${pkm.atk}*\n` +
      `🛡️  DEF: *${pkm.def}*\n` +
      `💨  SPD: *${pkm.spd}*\n\n` +
      `🎮 Moves: ${pkm.moves.join(" • ")}\n\n` +
      `💰 Spent: *${pkm.price} coins*\n` +
      `💼 Balance: *${newBal} coins*\n\n` +
      `Use *.battle @user* to fight! ⚔️`

    try {
      await sock.sendMessage(from, {
        video:       { url: gifUrl(numId) },
        gifPlayback: true,
        caption,
      }, { quoted: msg })
    } catch {
      // Fallback to image if GIF fails
      try {
        await sock.sendMessage(from, {
          image:   { url: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${numId}.png` },
          caption,
        }, { quoted: msg })
      } catch {
        await sock.sendMessage(from, { text: caption }, { quoted: msg })
      }
    }
  },
}
