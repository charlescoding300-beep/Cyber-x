// ══════════════════════════════════════════════════════════════════════
//  commands/buy.js  —  CYBER X  |  🦸 Hero Card Shop
//
//  .buy                  → browse all heroes (grouped by universe)
//  .buy marvel           → Marvel heroes only
//  .buy dc               → DC heroes only
//  .buy xmen             → X-Men heroes only
//  .buy incredibles      → Incredibles heroes only
//  .buy [hero name]      → buy that specific card (costs coins from .slots)
//
//  Cards live-fetch stats + image from akabab/superhero-api CDN.
//  Coin balance is shared with the .slots economy (global.slotData).
// ══════════════════════════════════════════════════════════════════════

const https = require("https")

// ── Shared hero system (survives hot-reloads) ──────────────────────────
if (!global.heroSystem) {
  global.heroSystem = {
    apiCache:   new Map(),   // heroId  → full akabab API JSON
    collection: new Map(),   // userId  → Set<heroId>
    battles:    new Map(),   // battleId → battle data
  }
}
const HS = global.heroSystem

// ── Coin helpers (ties into slots.js economy) ─────────────────────────
function getCoins(uid) {
  if (!global.slotData) return 0
  return global.slotData.coins.get(uid) ?? 200
}
function spendCoins(uid, amount) {
  if (!global.slotData) return false
  const bal = getCoins(uid)
  if (bal < amount) return false
  global.slotData.coins.set(uid, bal - amount)
  return true
}

// ── Hero catalog ───────────────────────────────────────────────────────
// Each entry: { id, name, universe, rarity, rarityStars, price }
// 'id' maps to akabab/superhero-api@0.3.0 hero JSON (jsDelivr CDN)
// Hardcoded heroes (Incredibles) have apiId:null and local stats
const IMG = (id, slug) =>
  `https://cdn.jsdelivr.net/gh/akabab/superhero-api@0.3.0/api/images/md/${id}-${slug}.jpg`

const CATALOG = [
  // ── MARVEL ──────────────────────────────────────────────────────────
  { id:620, slug:"spider-man",       name:"Spider-Man",       alias:"Peter Parker",        universe:"Marvel",      rarity:"Rare",      stars:"⭐⭐⭐",   price:500  },
  { id:346, slug:"iron-man",         name:"Iron Man",         alias:"Tony Stark",          universe:"Marvel",      rarity:"Rare",      stars:"⭐⭐⭐",   price:600  },
  { id:659, slug:"thor",             name:"Thor",             alias:"Thor Odinson",        universe:"Marvel",      rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:800  },
  { id:332, slug:"hulk",             name:"Hulk",             alias:"Bruce Banner",        universe:"Marvel",      rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:750  },
  { id:149, slug:"captain-america",  name:"Captain America",  alias:"Steve Rogers",        universe:"Marvel",      rarity:"Uncommon",  stars:"⭐⭐",     price:350  },
  { id:202, slug:"deadpool",         name:"Deadpool",         alias:"Wade Wilson",         universe:"Marvel",      rarity:"Uncommon",  stars:"⭐⭐",     price:400  },
  { id: 87, slug:"black-panther",    name:"Black Panther",    alias:"T'Challa",            universe:"Marvel",      rarity:"Uncommon",  stars:"⭐⭐",     price:380  },
  { id:107, slug:"black-widow",      name:"Black Widow",      alias:"Natasha Romanoff",    universe:"Marvel",      rarity:"Common",    stars:"⭐",       price:200  },
  { id:214, slug:"doctor-strange",   name:"Doctor Strange",   alias:"Stephen Strange",     universe:"Marvel",      rarity:"Rare",      stars:"⭐⭐⭐",   price:620  },
  { id:562, slug:"scarlet-witch",    name:"Scarlet Witch",    alias:"Wanda Maximoff",      universe:"Marvel",      rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:900  },
  { id:648, slug:"thanos",           name:"Thanos",           alias:"The Mad Titan",       universe:"Marvel",      rarity:"Ultimate",  stars:"⭐⭐⭐⭐⭐", price:1500 },
  // ── X-MEN ───────────────────────────────────────────────────────────
  { id:717, slug:"wolverine",        name:"Wolverine",        alias:"Logan",               universe:"X-Men",       rarity:"Rare",      stars:"⭐⭐⭐",   price:550  },
  { id:155, slug:"cyclops",          name:"Cyclops",          alias:"Scott Summers",       universe:"X-Men",       rarity:"Uncommon",  stars:"⭐⭐",     price:320  },
  { id:597, slug:"storm",            name:"Storm",            alias:"Ororo Munroe",        universe:"X-Men",       rarity:"Rare",      stars:"⭐⭐⭐",   price:520  },
  { id:349, slug:"jean-grey",        name:"Jean Grey",        alias:"Jean Elaine Grey",    universe:"X-Men",       rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:900  },
  { id:462, slug:"magneto",          name:"Magneto",          alias:"Max Eisenhardt",      universe:"X-Men",       rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:850  },
  { id:257, slug:"gambit",           name:"Gambit",           alias:"Remy LeBeau",         universe:"X-Men",       rarity:"Uncommon",  stars:"⭐⭐",     price:300  },
  // ── DC ──────────────────────────────────────────────────────────────
  { id:644, slug:"superman",         name:"Superman",         alias:"Clark Kent",          universe:"DC",          rarity:"Ultimate",  stars:"⭐⭐⭐⭐⭐", price:1400 },
  { id: 70, slug:"batman",           name:"Batman",           alias:"Bruce Wayne",         universe:"DC",          rarity:"Rare",      stars:"⭐⭐⭐",   price:650  },
  { id:720, slug:"wonder-woman",     name:"Wonder Woman",     alias:"Diana Prince",        universe:"DC",          rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:870  },
  { id:263, slug:"flash",            name:"The Flash",        alias:"Barry Allen",         universe:"DC",          rarity:"Legendary", stars:"⭐⭐⭐⭐",  price:800  },
  { id: 40, slug:"aquaman",          name:"Aquaman",          alias:"Arthur Curry",        universe:"DC",          rarity:"Uncommon",  stars:"⭐⭐",     price:360  },
  { id:296, slug:"green-lantern",    name:"Green Lantern",    alias:"Hal Jordan",          universe:"DC",          rarity:"Rare",      stars:"⭐⭐⭐",   price:530  },
  { id:642, slug:"supergirl",        name:"Supergirl",        alias:"Kara Zor-El",         universe:"DC",          rarity:"Rare",      stars:"⭐⭐⭐",   price:490  },
  { id:358, slug:"joker",            name:"Joker",            alias:"Unknown",             universe:"DC",          rarity:"Common",    stars:"⭐",       price:250  },
  // ── THE INCREDIBLES ─────────────────────────────────────────────────
  // No akabab ID — hardcoded stats below
  { id:null, slug:null, name:"Mr. Incredible",  alias:"Bob Parr",    universe:"Incredibles", rarity:"Uncommon", stars:"⭐⭐",  price:310,
    localImage:"https://static.wikia.nocookie.net/pixar/images/d/d2/Mr_Incredible.png",
    localStats:{ intelligence:55, strength:95, speed:35, durability:90, power:60, combat:70 },
    ability:"Superhuman strength & near-invulnerability" },
  { id:null, slug:null, name:"Elastigirl",       alias:"Helen Parr",  universe:"Incredibles", rarity:"Common",   stars:"⭐",   price:230,
    localImage:"https://static.wikia.nocookie.net/pixar/images/e/e8/Helen_Parr.png",
    localStats:{ intelligence:85, strength:40, speed:55, durability:55, power:70, combat:75 },
    ability:"Infinite elasticity & shape-shifting" },
  { id:null, slug:null, name:"Dash",             alias:"Dash Parr",   universe:"Incredibles", rarity:"Common",   stars:"⭐",   price:180,
    localImage:"https://static.wikia.nocookie.net/pixar/images/b/b6/Dash_Parr.png",
    localStats:{ intelligence:55, strength:30, speed:97, durability:35, power:50, combat:50 },
    ability:"Superhuman speed — fastest kid alive" },
  { id:null, slug:null, name:"Violet",           alias:"Violet Parr", universe:"Incredibles", rarity:"Common",   stars:"⭐",   price:200,
    localImage:"https://static.wikia.nocookie.net/pixar/images/7/7a/Violet_Parr.png",
    localStats:{ intelligence:75, strength:35, speed:45, durability:90, power:75, combat:55 },
    ability:"Invisibility & force-field generation" },
]

// ── Fetch hero data from akabab CDN (with cache) ───────────────────────
function fetchHero(id) {
  if (HS.apiCache.has(id)) return Promise.resolve(HS.apiCache.get(id))
  const url = `https://cdn.jsdelivr.net/gh/akabab/superhero-api@0.3.0/api/id/${id}.json`
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = ""
      res.on("data", c => raw += c)
      res.on("end", () => {
        try {
          const data = JSON.parse(raw)
          HS.apiCache.set(id, data)
          resolve(data)
        } catch(e) { reject(e) }
      })
    }).on("error", reject)
  })
}

// ── Get a catalog hero's full data ─────────────────────────────────────
async function getHeroData(entry) {
  if (!entry.id) {
    // Locally-defined hero (Incredibles)
    return {
      name:      entry.name,
      biography: { fullName: entry.alias, publisher: "Pixar / Disney" },
      powerstats: entry.localStats,
      images:    { md: entry.localImage },
      _ability:  entry.ability,
    }
  }
  const data = await fetchHero(entry.id)
  data._ability = entry.name === "Deadpool" ? "Regenerative healing & 4th-wall breaking" :
                  entry.name === "Doctor Strange" ? "Master of the Mystic Arts" :
                  entry.name === "Scarlet Witch" ? "Chaos magic & reality manipulation" :
                  entry.name === "Magneto" ? "Magnetic field manipulation" :
                  entry.name === "Storm" ? "Weather control & lightning mastery" :
                  entry.name === "Gambit" ? "Kinetic energy charging & card throws" :
                  (data.work?.occupation || "Superhero")
  return data
}

// ── Overall power score (0–100 average of 6 stats) ────────────────────
function overall(ps) {
  if (!ps) return 0
  const v = [ps.intelligence, ps.strength, ps.speed, ps.durability, ps.power, ps.combat]
    .map(n => n || 0)
  return Math.round(v.reduce((a, b) => a + b, 0) / 6)
}

// ── Stat progress bar (10 blocks) ─────────────────────────────────────
function bar(val) {
  const v = Math.min(100, Math.max(0, val || 0))
  const f = Math.round(v / 10)
  return "█".repeat(f) + "░".repeat(10 - f)
}

// ── Build the card caption ─────────────────────────────────────────────
function buildCard(entry, heroData) {
  const ps  = heroData.powerstats || {}
  const ovr = overall(ps)
  const rarityColor =
    entry.rarity === "Ultimate"  ? "🔴" :
    entry.rarity === "Legendary" ? "🟠" :
    entry.rarity === "Rare"      ? "🔵" :
    entry.rarity === "Uncommon"  ? "🟢" : "⚪"

  return (
    `╔══════════════════════════════╗\n` +
    `║   🦸  HERO CARD  🦸          ║\n` +
    `╚══════════════════════════════╝\n\n` +
    `🏷️  *${heroData.name || entry.name}*\n` +
    `👤  ${heroData.biography?.fullName || entry.alias}\n` +
    `🌌  ${entry.universe} Universe\n` +
    `${rarityColor}  ${entry.rarity}  ${entry.stars}\n` +
    `💰  *${entry.price} coins*\n\n` +
    `━━━━━  POWER STATS  ━━━━━\n` +
    `🧠 INT  ${bar(ps.intelligence)}  ${ps.intelligence ?? "?"}\n` +
    `💪 STR  ${bar(ps.strength)}  ${ps.strength ?? "?"}\n` +
    `⚡ SPD  ${bar(ps.speed)}  ${ps.speed ?? "?"}\n` +
    `🛡️ DUR  ${bar(ps.durability)}  ${ps.durability ?? "?"}\n` +
    `✨ PWR  ${bar(ps.power)}  ${ps.power ?? "?"}\n` +
    `⚔️  CMB  ${bar(ps.combat)}  ${ps.combat ?? "?"}\n\n` +
    `📊  *OVERALL: ${ovr}/100*\n` +
    `🎯  ${heroData._ability || "Superhero"}`
  )
}

// Expose helpers globally so battle.js + mycards.js can use them
HS.CATALOG    = CATALOG
HS.getHeroData = getHeroData
HS.buildCard   = buildCard
HS.overall     = overall
HS.bar         = bar

// ── User ID helper ─────────────────────────────────────────────────────
function uid(sender, from) {
  return sender.replace(/@.*/, "") + "|" + from
}

// ══════════════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ══════════════════════════════════════════════════════════════════════
module.exports = {
  pattern: "buy",
  desc:    "🦸 Hero card shop. Buy cards with slots coins, then use them to battle!",
  usage:   ".buy | .buy marvel | .buy dc | .buy xmen | .buy incredibles | .buy [hero name]",

  run: async ({ sock, from, msg, sender, args, text }) => {

    const userKey = uid(sender, from)
    const sub     = (args[0] || "").toLowerCase().trim()
    const nameArg = text.trim().toLowerCase()

    // ── Ensure collection slot exists ──
    if (!HS.collection.has(userKey)) HS.collection.set(userKey, new Set())

    // ════════════════════════════════════
    //  .buy  OR  .buy marvel/dc/xmen/incredibles
    //  → Show card list
    // ════════════════════════════════════
    const FILTERS = ["", "marvel", "dc", "xmen", "x-men", "incredibles"]
    if (FILTERS.includes(sub)) {
      const filterMap = { xmen: "X-Men", "x-men": "X-Men", marvel: "Marvel", dc: "DC", incredibles: "Incredibles" }
      const universeFilter = filterMap[sub] || null

      const universes = universeFilter
        ? [universeFilter]
        : ["Marvel", "X-Men", "DC", "Incredibles"]

      const rarityOrder = { Ultimate: 0, Legendary: 1, Rare: 2, Uncommon: 3, Common: 4 }
      const rarityColor = { Ultimate:"🔴", Legendary:"🟠", Rare:"🔵", Uncommon:"🟢", Common:"⚪" }

      let lines = []
      for (const u of universes) {
        const heroes = CATALOG.filter(h => h.universe === u)
          .sort((a, b) => rarityOrder[a.rarity] - rarityOrder[b.rarity])
        lines.push(`\n🌌 *${u.toUpperCase()}*`)
        for (const h of heroes) {
          const owned = HS.collection.get(userKey)?.has(h.name) ? " ✅" : ""
          lines.push(`  ${rarityColor[h.rarity]} *${h.name}* — ${h.price} coins${owned}`)
        }
      }

      const bal = getCoins(userKey)

      await sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   🦸  HERO CARD SHOP  🦸      ║\n` +
              `╚══════════════════════════════╝\n` +
              lines.join("\n") + `\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `💼 Your balance: *${bal} coins*\n` +
              `✅ = already owned\n\n` +
              `To buy: *.buy [hero name]*\n` +
              `e.g.  *.buy Spider-Man*\n\n` +
              `Filters: *.buy marvel* | *.buy dc*\n` +
              `         *.buy xmen*   | *.buy incredibles*`,
      }, { quoted: msg })
      return
    }

    // ════════════════════════════════════
    //  .buy [hero name]  → buy a card
    // ════════════════════════════════════
    const entry = CATALOG.find(h =>
      h.name.toLowerCase() === nameArg ||
      h.name.toLowerCase().includes(nameArg) ||
      nameArg.includes(h.name.toLowerCase())
    )

    if (!entry) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   ❌  HERO NOT FOUND         ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `*"${text}"* isn't in the shop.\n` +
              `Use *.buy* to see all available heroes.`,
      }, { quoted: msg })
    }

    // Already owned?
    if (HS.collection.get(userKey).has(entry.name)) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   ✅  ALREADY OWNED          ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `You already own *${entry.name}*!\n` +
              `Use *.battle @user* to fight with it.\n` +
              `Use *.mycards* to see your collection.`,
      }, { quoted: msg })
    }

    // Can afford?
    const bal = getCoins(userKey)
    if (bal < entry.price) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   💸  NOT ENOUGH COINS       ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `*${entry.name}* costs *${entry.price} coins*.\n` +
              `Your balance: *${bal} coins*\n\n` +
              `You need *${entry.price - bal} more coins*.\n` +
              `Earn coins with *.slots* or *.slots daily*! 🎰`,
      }, { quoted: msg })
    }

    // ── Fetch hero data ──
    let heroData
    try {
      heroData = await getHeroData(entry)
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Failed to load *${entry.name}* card data. Try again in a moment.`,
      }, { quoted: msg })
    }

    // ── Deduct coins + add to collection ──
    spendCoins(userKey, entry.price)
    HS.collection.get(userKey).add(entry.name)

    const newBal  = getCoins(userKey)
    const caption = buildCard(entry, heroData) +
                    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🎉 *Card added to your collection!*\n` +
                    `💼 Balance: *${newBal} coins*\n\n` +
                    `Use *.battle @user* to fight!\n` +
                    `Use *.mycards* to view collection.`

    const imageUrl = heroData.images?.md || entry.localImage

    // ── Send card with image ──
    try {
      await sock.sendMessage(from, {
        image:   { url: imageUrl },
        caption,
      }, { quoted: msg })
    } catch {
      // Image failed — send text-only card
      await sock.sendMessage(from, { text: caption }, { quoted: msg })
    }
  },
}
