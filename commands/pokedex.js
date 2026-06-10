// ════════════════════════════════════════════════════════════════════
//  commands/pokedex.js  —  CYBER X  |  📖 Pokédex
//  .pokedex           → show all Pokémon (paginated by tier)
//  .pokedex common    → show common tier only
//  .pokedex rare      → show rare tier only
//  .pokedex legendary → show legendary tier only
// ════════════════════════════════════════════════════════════════════

const { POKEMON, tierEmoji, typeEmoji, getCoins } = require('../lib/pokemonEngine')

module.exports = {
  pattern: "pokedex",
  desc:    "📖 Browse all Pokémon available to buy",
  usage:   ".pokedex [common|uncommon|rare|legendary]",
  category:"game",

  run: async ({ sock, from, msg, sender, args }) => {
    const uid    = sender.replace(/@.+/, "")
    const filter = (args[0] || "all").toLowerCase().trim()
    const coins  = getCoins(uid)

    const tiers   = ["common","uncommon","rare","legendary"]
    const targets = tiers.includes(filter) ? [filter] : tiers

    function buildSection(tier) {
      const entries = Object.entries(POKEMON).filter(([,p]) => p.tier === tier)
      if (!entries.length) return ""

      const tierLabel = { common:"COMMON", uncommon:"UNCOMMON", rare:"RARE", legendary:"LEGENDARY" }[tier]
      const header    =
        `╠══〔 ${tierEmoji(tier)} *${tierLabel}* 〕══╣\n`

      const rows = entries.map(([id, p]) => {
        const canAfford = coins >= p.price ? "✅" : "❌"
        return `║  ${canAfford} *#${id} ${p.name}*\n` +
               `║     ${typeEmoji(p.type)} ${p.type.toUpperCase()}  │  ❤️${p.hp}  ⚔️${p.atk}  🛡️${p.def}  💨${p.spd}\n` +
               `║     💰 *${p.price} coins*  │  *.buy ${p.name.toLowerCase()}*`
      }).join("\n║\n")

      return header + rows
    }

    const sections = targets.map(buildSection).filter(Boolean).join("\n")

    const text =
      `╔══════════════════════════════╗\n` +
      `║   📖  *CYBER X POKÉDEX*  📖   ║\n` +
      `╚══════════════════════════════╝\n\n` +
      `👤 Your coins: *${coins}* 💰\n` +
      `✅ = can afford  │  ❌ = not enough\n\n` +
      sections + `\n\n` +
      `╠══════════════════════════════╣\n` +
      `║  Use *.buy <name>* to purchase ║\n` +
      `║  Use *.mycard* to see your deck║\n` +
      `╚══════════════════════════════╝`

    return sock.sendMessage(from, { text }, { quoted: msg })
  },
}
