// ════════════════════════════════════════════════════════════════════
//  commands/mycard.js  —  CYBER X  |  🃏 My Pokémon Cards
//  .mycard            → view all your Pokémon (animated!)
//  .mycard pikachu    → view a specific card + animated GIF
//  .mycard active     → see which Pokémon is active for battle
//  .active pikachu    → set active Pokémon for battle
// ════════════════════════════════════════════════════════════════════

const {
  DB, saveData, POKEMON, gifUrl,
  tierEmoji, typeEmoji, hpBar,
  getUser, getActiveCard, getCoins, sleep,
} = require('../lib/pokemonEngine')

// ── Sparkle border for animated card display ──────────────────────────
function cardFrame(pkm, card, isActive) {
  const xpNext = 100
  const xpBar  = (n => "⬜".repeat(n) + "⬛".repeat(10 - n))(Math.min(10, Math.floor((card.xp % xpNext) / xpNext * 10)))
  return (
    (isActive ? `╔✨═══════════════════════✨╗\n` : `╔══════════════════════════╗\n`) +
    `║  ${tierEmoji(pkm.tier)} *${pkm.name.toUpperCase()}*${isActive ? " 🎯 ACTIVE" : ""}` +
    `\n║  ${typeEmoji(pkm.type)} *${pkm.type.toUpperCase()}*` +
    `\n╠══════════════════════════╣` +
    `\n║  ❤️  HP:  *${pkm.hp}*` +
    `\n║  ⚔️  ATK: *${pkm.atk}*` +
    `\n║  🛡️  DEF: *${pkm.def}*` +
    `\n║  💨  SPD: *${pkm.spd}*` +
    `\n╠══════════════════════════╣` +
    `\n║  🎮 *Moves:*` +
    pkm.moves.map(m => `\n║   ◈ ${m}`).join("") +
    `\n╠══════════════════════════╣` +
    `\n║  ⭐ XP: ${xpBar}  ${card.xp || 0}` +
    `\n║  🏆 Wins: *${card.wins || 0}*  │  💔 Losses: *${card.losses || 0}*` +
    (isActive ? `\n╚✨═══════════════════════✨╝` : `\n╚══════════════════════════╝`)
  )
}

module.exports = [
  // ─── .mycard ─────────────────────────────────────────────────────
  {
    pattern:  "mycard",
    desc:     "🃏 View your Pokémon collection with animated cards",
    usage:    ".mycard  |  .mycard <name>",
    category: "game",

    run: async ({ sock, from, msg, sender, args }) => {
      const uid      = sender.replace(/@.+/, "")
      const pushName = msg.pushName || uid
      const user     = getUser(uid)
      const query    = args.join(" ").toLowerCase().trim()

      if (!user.cards.length) {
        return sock.sendMessage(from, {
          text:
            `😔 *${pushName}* has no Pokémon yet!\n\n` +
            `📖 Browse Pokémon: *.pokedex*\n` +
            `🛒 Buy one: *.buy pikachu*\n` +
            `🎰 Earn coins: *.slot*`,
        }, { quoted: msg })
      }

      // ── Show specific card ────────────────────────────────────────
      if (query && query !== "active") {
        const entry = Object.entries(POKEMON).find(([, p]) =>
          p.name.toLowerCase() === query || p.name.toLowerCase().startsWith(query)
        )
        const found = entry && user.cards.find(c => c.pokemonId === parseInt(entry[0]))

        if (!found) {
          return sock.sendMessage(from, {
            text: `❓ You don't own that Pokémon!\nUse *.mycard* to see all your cards.`,
          }, { quoted: msg })
        }

        const [id, pkm] = entry
        const isActive  = user.cards.indexOf(found) === user.activeCard

        const caption = cardFrame(pkm, found, isActive)

        try {
          await sock.sendMessage(from, {
            video: { url: gifUrl(parseInt(id)) }, gifPlayback: true, caption,
          }, { quoted: msg })
        } catch {
          try {
            await sock.sendMessage(from, {
              image: { url: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png` }, caption,
            }, { quoted: msg })
          } catch {
            await sock.sendMessage(from, { text: caption }, { quoted: msg })
          }
        }
        return
      }

      // ── Show ALL cards overview ───────────────────────────────────
      const totalCards = user.cards.length
      const headerMsg  =
        `╔══════════════════════════════╗\n` +
        `║   🃏  *${pushName}'s DECK*  🃏\n` +
        `╚══════════════════════════════╝\n` +
        `📦 Cards: *${totalCards}*  │  🏆 Wins: *${user.battleWins || 0}*  │  💔 Losses: *${user.battleLosses || 0}*\n\n` +
        user.cards.map((c, i) => {
          const pkm      = POKEMON[c.pokemonId]
          if (!pkm) return ""
          const isActive = i === user.activeCard
          return `${isActive ? "🎯" : "▫️"} *${pkm.name}* ${typeEmoji(pkm.type)} ${tierEmoji(pkm.tier)}  XP:${c.xp||0}  W:${c.wins||0}`
        }).filter(Boolean).join("\n") +
        `\n\n📌 Active: *${POKEMON[user.cards[user.activeCard]?.pokemonId]?.name || "none"}* 🎯\n` +
        `💡 *.mycard <name>* to view animated card\n` +
        `💡 *.active <name>* to set battle Pokémon`

      await sock.sendMessage(from, { text: headerMsg }, { quoted: msg })
      await sleep(400)

      // Send animated GIF of active card
      const activeCard = user.cards[user.activeCard]
      if (activeCard) {
        const pkm     = POKEMON[activeCard.pokemonId]
        const caption = `✨ *${pkm.name}* — Your Active Pokémon! ✨\n${typeEmoji(pkm.type)} ${pkm.type.toUpperCase()}`
        try {
          await sock.sendMessage(from, {
            video: { url: gifUrl(activeCard.pokemonId) }, gifPlayback: true, caption,
          })
        } catch {
          try {
            await sock.sendMessage(from, {
              image: { url: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${activeCard.pokemonId}.png` },
              caption,
            })
          } catch { /* silent */ }
        }
      }
    },
  },

  // ─── .active <name> ──────────────────────────────────────────────
  {
    pattern:  "active",
    desc:     "🎯 Set your active Pokémon for battle",
    usage:    ".active <pokemon name>",
    category: "game",

    run: async ({ sock, from, msg, sender, args }) => {
      const uid      = sender.replace(/@.+/, "")
      const pushName = msg.pushName || uid
      const query    = args.join(" ").toLowerCase().trim()
      const user     = getUser(uid)

      if (!query) {
        const active = user.cards[user.activeCard]
        const pkmName = active ? POKEMON[active.pokemonId]?.name : "none"
        return sock.sendMessage(from, {
          text: `🎯 Your active Pokémon: *${pkmName}*\nUse *.active <name>* to change it.`,
        }, { quoted: msg })
      }

      const idx = user.cards.findIndex(c => {
        const pkm = POKEMON[c.pokemonId]
        return pkm && (pkm.name.toLowerCase() === query || pkm.name.toLowerCase().startsWith(query))
      })

      if (idx === -1) {
        return sock.sendMessage(from, {
          text: `❓ You don't own that Pokémon!\nUse *.mycard* to see your cards.`,
        }, { quoted: msg })
      }

      user.activeCard = idx
      const pkm = POKEMON[user.cards[idx].pokemonId]
      const { saveData } = require('../lib/pokemonEngine')
      saveData()

      return sock.sendMessage(from, {
        text:
          `✅ *${pushName}* set *${pkm.name}* as active!\n` +
          `${typeEmoji(pkm.type)} ${pkm.type.toUpperCase()}  │  ❤️${pkm.hp}  ⚔️${pkm.atk}  🛡️${pkm.def}  💨${pkm.spd}\n\n` +
          `Ready to battle! Use *.battle @user*`,
      }, { quoted: msg })
    },
  },
]
