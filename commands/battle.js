// ══════════════════════════════════════════════════════════════════════
//  commands/battle.js  —  CYBER X  |  ⚔️  Hero Card Battle
//
//  .battle @user   → challenge someone to a card battle
//                    auto-picks each player's strongest card
//                    50/50 winner — shows REASON why winner won
//                    winner earns 50 coins from loser
// ══════════════════════════════════════════════════════════════════════

// ── Wait for buy.js to set up global.heroSystem ────────────────────────
if (!global.heroSystem) {
  global.heroSystem = {
    apiCache:   new Map(),
    collection: new Map(),
    battles:    new Map(),
  }
}
const HS = global.heroSystem

// ── Coin helpers ───────────────────────────────────────────────────────
function getCoins(uid) {
  if (!global.slotData) return 0
  return global.slotData.coins.get(uid) ?? 200
}
function transferCoins(fromUid, toUid, amount) {
  if (!global.slotData) return
  const from = Math.max(0, getCoins(fromUid) - amount)
  const to   = getCoins(toUid) + amount
  global.slotData.coins.set(fromUid, from)
  global.slotData.coins.set(toUid,   to)
}

// ── User ID helper ─────────────────────────────────────────────────────
function uid(sender, from) {
  return sender.replace(/@.*/, "") + "|" + from
}

// ── Resolve helpers from buy.js (loaded lazily in case buy.js is first) ──
function getHelper(name, fallback) {
  return (HS[name] instanceof Function) ? HS[name] : fallback
}

function overall(ps) {
  if (HS.overall) return HS.overall(ps)
  if (!ps) return 0
  return Math.round([ps.intelligence,ps.strength,ps.speed,ps.durability,ps.power,ps.combat]
    .map(n=>n||0).reduce((a,b)=>a+b,0)/6)
}

// ── Get best card from a player's collection ──────────────────────────
async function getBestCard(userKey) {
  const catalog    = HS.CATALOG || []
  const collection = HS.collection.get(userKey)
  if (!collection || collection.size === 0) return null

  let best = null, bestScore = -1

  for (const heroName of collection) {
    const entry = catalog.find(h => h.name === heroName)
    if (!entry) continue
    try {
      const heroData = await HS.getHeroData(entry)
      const score    = overall(heroData.powerstats)
      if (score > bestScore) {
        bestScore = score
        best = { entry, heroData, score }
      }
    } catch { /* skip failed fetches */ }
  }
  return best
}

// ── Battle reason engine ───────────────────────────────────────────────
// Finds the stat where winner has biggest advantage over loser
// Returns a dramatic 2-line reason string
function getBattleReason(wEntry, wStats, lEntry, lStats) {
  const keys  = ["strength", "speed", "intelligence", "durability", "power", "combat"]
  const emoji = { strength:"💪", speed:"⚡", intelligence:"🧠", durability:"🛡️", power:"✨", combat:"⚔️" }
  const label = { strength:"Strength", speed:"Speed", intelligence:"Intelligence", durability:"Durability", power:"Power", combat:"Combat" }

  const narratives = {
    strength:     [
      `${wEntry.name}'s overwhelming physical strength crushed ${lEntry.name}'s defenses!`,
      `Raw muscle power — ${wEntry.name} hit harder than anything ${lEntry.name} could handle!`,
    ],
    speed:        [
      `${wEntry.name}'s blazing speed left ${lEntry.name} unable to even land a hit!`,
      `Too fast to touch — ${lEntry.name} was outmanoeuvred at every turn!`,
    ],
    intelligence: [
      `${wEntry.name}'s tactical genius found every weakness in ${lEntry.name}'s strategy!`,
      `Outsmarted at every step — brains beat brawn today!`,
    ],
    durability:   [
      `${wEntry.name} just would not go down — every blow ${lEntry.name} landed was absorbed!`,
      `Unbreakable — ${lEntry.name} exhausted every attack and ${wEntry.name} kept standing.`,
    ],
    power:        [
      `${wEntry.name} unleashed abilities far beyond anything ${lEntry.name} could counter!`,
      `Pure power overload — ${lEntry.name} had no answer for ${wEntry.name}'s raw force!`,
    ],
    combat:       [
      `${wEntry.name}'s superior combat skill dismantled ${lEntry.name}'s fighting style!`,
      `Precise, disciplined, and relentless — ${wEntry.name} made every strike count!`,
    ],
  }

  let bestKey  = null
  let bestDiff = -Infinity

  for (const key of keys) {
    const diff = (wStats[key] || 0) - (lStats[key] || 0)
    if (diff > bestDiff) { bestDiff = diff; bestKey = key }
  }

  const key      = bestKey || "power"
  const wVal     = wStats[key] || 0
  const lVal     = lStats[key] || 0
  const story    = narratives[key][Math.floor(Math.random() * 2)]
  const diffStr  = bestDiff > 0 ? ` (+${bestDiff} advantage)` : ""

  return (
    `💥 *${emoji[key]} ${label[key].toUpperCase()} ADVANTAGE${diffStr}*\n` +
    `${story}\n\n` +
    `${emoji[key]} ${wEntry.name}: *${wVal}*  vs  ${lEntry.name}: *${lVal}*`
  )
}

// ── Stat comparison table ──────────────────────────────────────────────
function statTable(wEntry, wStats, lEntry, lStats) {
  const keys   = ["intelligence", "strength", "speed", "durability", "power", "combat"]
  const emojis = ["🧠","💪","⚡","🛡️","✨","⚔️"]
  const short  = ["INT","STR","SPD","DUR","PWR","CMB"]

  return keys.map((k, i) => {
    const wv = wStats[k] || 0
    const lv = lStats[k] || 0
    const arrow = wv > lv ? "▲" : wv < lv ? "▼" : "="
    return `${emojis[i]} ${short[i]}  ${String(wv).padStart(3)}  ${arrow}  ${String(lv).padStart(3)}`
  }).join("\n")
}

const BATTLE_WAGER = 50  // coins transferred on win

// ══════════════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ══════════════════════════════════════════════════════════════════════
module.exports = {
  pattern: "battle",
  desc:    "⚔️ Challenge another player to a superhero card battle!",
  usage:   ".battle @user",

  run: async ({ sock, from, msg, sender, args, text, isGroup }) => {

    const userKey = uid(sender, from)

    // ── Extract @mentioned user ────────────────────────────────────────
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
      || msg.message?.imageMessage?.contextInfo?.mentionedJid
      || []

    const opponentJid = mentioned[0] || null

    if (!opponentJid) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   ⚔️   HERO CARD BATTLE       ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `*Usage:* .battle @username\n\n` +
              `You must tag someone to battle.\n` +
              `Both players need at least 1 card.\n` +
              `Buy cards with *.buy* 🛒`,
      }, { quoted: msg })
    }

    const opponentKey = uid(opponentJid, from)

    // ── Can't battle yourself ──────────────────────────────────────────
    if (opponentKey === userKey) {
      return sock.sendMessage(from, {
        text: `❌ You can't battle yourself! Challenge someone else.`,
      }, { quoted: msg })
    }

    // ── Both need collections ──────────────────────────────────────────
    if (!HS.collection) {
      return sock.sendMessage(from, {
        text: `❌ Card system not ready yet. Use *.buy* first to initialise the shop!`,
      }, { quoted: msg })
    }

    const myCollection  = HS.collection.get(userKey)
    const oppCollection = HS.collection.get(opponentKey)

    if (!myCollection || myCollection.size === 0) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   📭  NO CARDS               ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `You don't have any hero cards!\n` +
              `Use *.buy* to get your first card. 🛒`,
      }, { quoted: msg })
    }

    if (!oppCollection || oppCollection.size === 0) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗\n` +
              `║   📭  OPPONENT HAS NO CARDS  ║\n` +
              `╚══════════════════════════════╝\n\n` +
              `@${opponentJid.split("@")[0]} has no cards yet!\n` +
              `They need to use *.buy* first. 🛒`,
        mentions: [opponentJid],
      }, { quoted: msg })
    }

    // ── Announce battle starting ───────────────────────────────────────
    const challengerTag = `@${sender.split("@")[0]}`
    const opponentTag   = `@${opponentJid.split("@")[0]}`

    await sock.sendMessage(from, {
      text: `╔══════════════════════════════╗\n` +
            `║   ⚔️   HERO CARD BATTLE  ⚔️   ║\n` +
            `╚══════════════════════════════╝\n\n` +
            `🔵 ${challengerTag}  🆚  🔴 ${opponentTag}\n\n` +
            `⚡ *Selecting best cards...*\n` +
            `🎲 *Battle commencing...*`,
      mentions: [sender, opponentJid],
    }, { quoted: msg })

    // ── Get best cards ─────────────────────────────────────────────────
    let challengerCard, opponentCard
    try {
      [challengerCard, opponentCard] = await Promise.all([
        getBestCard(userKey),
        getBestCard(opponentKey),
      ])
    } catch (e) {
      return sock.sendMessage(from, {
        text: `❌ Battle failed loading card data: ${e.message}`,
      }, { quoted: msg })
    }

    if (!challengerCard) {
      return sock.sendMessage(from, { text: `❌ Could not load ${challengerTag}'s card.`, mentions: [sender] }, { quoted: msg })
    }
    if (!opponentCard) {
      return sock.sendMessage(from, { text: `❌ Could not load ${opponentTag}'s card.`, mentions: [opponentJid] }, { quoted: msg })
    }

    // ── 50/50 winner ───────────────────────────────────────────────────
    const challengerWins = Math.random() < 0.5
    const winner = challengerWins ? challengerCard : opponentCard
    const loser  = challengerWins ? opponentCard   : challengerCard
    const winnerJid   = challengerWins ? sender      : opponentJid
    const loserJid    = challengerWins ? opponentJid : sender
    const winnerKey   = challengerWins ? userKey     : opponentKey
    const loserKey    = challengerWins ? opponentKey : userKey
    const winnerTag   = `@${winnerJid.split("@")[0]}`
    const loserTag    = `@${loserJid.split("@")[0]}`

    const wStats = winner.heroData.powerstats || {}
    const lStats = loser.heroData.powerstats  || {}

    // ── Transfer coins ─────────────────────────────────────────────────
    const wager = Math.min(BATTLE_WAGER, getCoins(loserKey))
    if (wager > 0) transferCoins(loserKey, winnerKey, wager)

    // ── Build result message ───────────────────────────────────────────
    const reason = getBattleReason(winner.entry, wStats, loser.entry, lStats)
    const table  = statTable(winner.entry, wStats, loser.entry, lStats)

    await new Promise(r => setTimeout(r, 2000))  // dramatic pause

    const resultText =
      `╔══════════════════════════════╗\n` +
      `║   🏆  BATTLE RESULT  🏆      ║\n` +
      `╚══════════════════════════════╝\n\n` +
      `🔵 ${challengerTag}'s *${challengerCard.entry.name}* (${challengerCard.score}/100)\n` +
      `        🆚\n` +
      `🔴 ${opponentTag}'s *${opponentCard.entry.name}* (${opponentCard.score}/100)\n\n` +
      `━━━━━  WINNER  ━━━━━\n` +
      `🏆 *${winner.entry.name}* — ${winnerTag}\n\n` +
      `━━━━━  WHY THEY WON  ━━━━━\n` +
      reason + `\n\n` +
      `━━━━━  FULL STATS  ━━━━━\n` +
      `         ${winner.entry.name.slice(0,10).padEnd(10)}  ${loser.entry.name.slice(0,10).padEnd(10)}\n` +
      table + `\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎉 ${winnerTag} wins *+${wager} coins*!\n` +
      `💸 ${loserTag} loses *${wager} coins*\n\n` +
      `💼 ${winnerTag}: *${getCoins(winnerKey)} coins*\n` +
      `💼 ${loserTag}: *${getCoins(loserKey)} coins*`

    const winnerImage = winner.heroData.images?.md || winner.entry.localImage

    try {
      await sock.sendMessage(from, {
        image:    { url: winnerImage },
        caption:  resultText,
        mentions: [sender, opponentJid],
      }, { quoted: msg })
    } catch {
      await sock.sendMessage(from, {
        text:     resultText,
        mentions: [sender, opponentJid],
      }, { quoted: msg })
    }
  },
}
