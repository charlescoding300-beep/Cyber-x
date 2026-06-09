// ══════════════════════════════════════════════════════════════════════
//  commands/mycards.js  —  CYBER X  |  📦 My Hero Collection
//
//  .mycards              → list all your owned cards with overall rating
//  .mycards [hero name]  → view the full stat card for a specific hero
// ══════════════════════════════════════════════════════════════════════

if (!global.heroSystem) {
  global.heroSystem = {
    apiCache:   new Map(),
    collection: new Map(),
    battles:    new Map(),
  }
}
const HS = global.heroSystem

function uid(sender, from) {
  return sender.replace(/@.*/, "") + "|" + from
}

function overall(ps) {
  if (HS.overall) return HS.overall(ps)
  if (!ps) return 0
  return Math.round(
    [ps.intelligence, ps.strength, ps.speed, ps.durability, ps.power, ps.combat]
      .map(n => n || 0).reduce((a, b) => a + b, 0) / 6
  )
}

const rarityOrder = { Ultimate: 0, Legendary: 1, Rare: 2, Uncommon: 3, Common: 4 }
const rarityColor = { Ultimate:"🔴", Legendary:"🟠", Rare:"🔵", Uncommon:"🟢", Common:"⚪" }
const rarityMedal = { Ultimate:"👑", Legendary:"💎", Rare:"🔷", Uncommon:"🟩", Common:"▪️" }

// ══════════════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ══════════════════════════════════════════════════════════════════════
module.exports = {
  pattern: "mycards",
  desc:    "📦 View your hero card collection.",
  usage:   ".mycards | .mycards [hero name]",

  run: async ({ sock, from, msg, sender, args, text }) => {

    const userKey   = uid(sender, from)
    const nameArg   = text.trim().toLowerCase()
    const collection = HS.collection.get(userKey)

    // ── No cards ────────────────────────────────────────────────────────
    if (!collection || collection.size === 0) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   📭  NO CARDS YET           ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `You haven't bought any hero cards yet!\n\n` +
              `🛒 Use *.buy* to browse the shop\n` +
              `🎰 Use *.slots* to earn coins\n` +
              `🎁 Use *.slots daily* for free coins`,
      }, { quoted: msg })
    }

    const catalog = HS.CATALOG || []

    // ════════════════════════════════════
    //  .mycards [hero name]  → full card
    // ════════════════════════════════════
    if (nameArg) {
      const entry = catalog.find(h =>
        collection.has(h.name) && (
          h.name.toLowerCase() === nameArg ||
          h.name.toLowerCase().includes(nameArg) ||
          nameArg.includes(h.name.toLowerCase())
        )
      )

      if (!entry) {
        return sock.sendMessage(from, {
          text: `╔══════════════════════════════╗\n` +
                `║   ❌  NOT IN COLLECTION      ║\n` +
                `╚══════════════════════════════╝\n\n` +
                `You don't own *"${text}"*.\n` +
                `Use *.mycards* to see what you have.\n` +
                `Use *.buy ${text}* to purchase it.`,
        }, { quoted: msg })
      }

      // Fetch + display full card
      let heroData
      try {
        heroData = await HS.getHeroData(entry)
      } catch {
        return sock.sendMessage(from, {
          text: `❌ Failed to load card data for *${entry.name}*. Try again.`,
        }, { quoted: msg })
      }

      const caption = (HS.buildCard ? HS.buildCard(entry, heroData) :
        `🦸 *${entry.name}*\n${entry.universe} — ${entry.rarity}`) +
        `\n\n💡 Use *.battle @user* to fight with this card!`

      const imageUrl = heroData.images?.md || entry.localImage

      try {
        await sock.sendMessage(from, {
          image:   { url: imageUrl },
          caption,
        }, { quoted: msg })
      } catch {
        await sock.sendMessage(from, { text: caption }, { quoted: msg })
      }
      return
    }

    // ════════════════════════════════════
    //  .mycards  → full collection list
    // ════════════════════════════════════
    const owned = catalog
      .filter(h => collection.has(h.name))
      .sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity])

    // Group by universe
    const groups = {}
    for (const h of owned) {
      if (!groups[h.universe]) groups[h.universe] = []
      groups[h.universe].push(h)
    }

    // Fetch overall scores for all owned heroes (from cache if available)
    const scoreMap = {}
    for (const h of owned) {
      try {
        const data = HS.apiCache.has(h.id)
          ? HS.apiCache.get(h.id)
          : (h.id ? null : { powerstats: h.localStats })
        if (data) scoreMap[h.name] = overall(data.powerstats)
      } catch {}
    }

    let lines = []
    for (const [universe, heroes] of Object.entries(groups)) {
      lines.push(`\n🌌 *${universe.toUpperCase()}*`)
      for (const h of heroes) {
        const score = scoreMap[h.name] ? ` — ${scoreMap[h.name]}/100` : ""
        lines.push(`  ${rarityMedal[h.rarity]} *${h.name}*${score}  ${h.stars}`)
      }
    }

    const total   = owned.length
    const shopLen = catalog.length
    const pct     = Math.round((total / shopLen) * 100)

    // Rarity breakdown
    const counts = { Ultimate:0, Legendary:0, Rare:0, Uncommon:0, Common:0 }
    for (const h of owned) counts[h.rarity]++
    const rarityLine = Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${rarityColor[k]} ${k}: ${v}`)
      .join("  ")

    await sock.sendMessage(from, {
      text: `╔══════════════════════════════╗\n` +
            `║   📦  MY HERO COLLECTION     ║\n` +
            `╚══════════════════════════════╝\n` +
            lines.join("\n") + `\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🃏 Cards: *${total}/${shopLen}* collected (${pct}%)\n` +
            rarityLine + `\n\n` +
            `🔍 *.mycards [hero name]* → full card\n` +
            `⚔️  *.battle @user* → use your best card`,
    }, { quoted: msg })
  },
}
