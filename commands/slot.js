// ════════════════════════════════════════════════════════════════════
//  commands/slot.js  —  CYBER X  |  🎰 Slot Machine
//
//  .slot              → spin for default bet (10 coins)
//  .slot 50           → spin betting 50 coins
//  .slot bal          → check your coin balance
//  .slot top          → leaderboard (top 5)
//  .slot daily        → claim 100 free coins (once per 24h)
//
//  • Edits the SAME message — no double messages ever
//  • Win = bet × symbol multiplier (e.g. bet 50, hit 3x🍒 → +1000)
//  • 5-second cooldown per user
// ════════════════════════════════════════════════════════════════════

// ── Persistent state (survives hot-reloads) ──────────────────────────
if (!global.slotData) {
  global.slotData = {
    coins:         new Map(),
    cooldowns:     new Map(),
    daily:         new Map(),
    totalSpins:    0,
    totalJackpots: 0,
  }
}
const SD = global.slotData

// ── Constants ────────────────────────────────────────────────────────
const STARTING_COINS = 200
const MIN_BET        = 10
const DEFAULT_BET    = 10
const COOLDOWN_MS    = 5_000        // 5 seconds
const DAILY_COINS    = 100
const DAILY_MS       = 86_400_000  // 24 hours
const SPIN_DELAY_MS  = 1800        // animation pause

// ── Symbol table  [ emoji, weight, payout3x, payout2x ] ─────────────
// payout values are MULTIPLIERS of your bet
// e.g. bet 50, hit 3x🍒 (p3: 20) → win 50 × 20 = 1000 coins
const SYMBOLS = [
  { e: "🍒", weight: 30, p3: 20,   p2: 3,  name: "CHERRIES" },
  { e: "🍋", weight: 22, p3: 30,   p2: 4,  name: "LEMONS"   },
  { e: "🍊", weight: 18, p3: 40,   p2: 5,  name: "ORANGES"  },
  { e: "🍇", weight: 13, p3: 60,   p2: 8,  name: "GRAPES"   },
  { e: "🔔", weight:  9, p3: 100,  p2: 12, name: "BELLS"    },
  { e: "⭐", weight:  5, p3: 200,  p2: 20, name: "STARS"    },
  { e: "💎", weight:  2, p3: 500,  p2: 40, name: "DIAMONDS" },
  { e: "7️⃣", weight:  1, p3: 1000, p2: 0,  name: "SEVENS"   },
]
const POOL = SYMBOLS.flatMap(s => Array(s.weight).fill(s))

// ── Helpers ──────────────────────────────────────────────────────────

function spin() {
  return [
    POOL[Math.floor(Math.random() * POOL.length)],
    POOL[Math.floor(Math.random() * POOL.length)],
    POOL[Math.floor(Math.random() * POOL.length)],
  ]
}

function getCoins(uid) {
  if (!SD.coins.has(uid)) SD.coins.set(uid, STARTING_COINS)
  return SD.coins.get(uid)
}

function addCoins(uid, amount) {
  SD.coins.set(uid, Math.max(0, getCoins(uid) + amount))
  return SD.coins.get(uid)
}

function onCooldown(uid) {
  return Date.now() - (SD.cooldowns.get(uid) || 0) < COOLDOWN_MS
}

function getCooldownLeft(uid) {
  return Math.ceil((COOLDOWN_MS - (Date.now() - (SD.cooldowns.get(uid) || 0))) / 1000)
}

function setCooldown(uid) {
  SD.cooldowns.set(uid, Date.now())
}

function canClaimDaily(uid) {
  return Date.now() - (SD.daily.get(uid) || 0) >= DAILY_MS
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Result evaluator ─────────────────────────────────────────────────
function evaluate(reels, bet) {
  const [a, b, c] = reels

  if (a.e === b.e && b.e === c.e) {
    const prize = bet * a.p3
    let tier, prefix
    if (a.e === "7️⃣") {
      tier   = "MEGA_JACKPOT"
      prefix = `🚨🚨🚨 *MEGA JACKPOT!!!* 🚨🚨🚨\n💥 THREE ${a.name}! 💥\n`
      SD.totalJackpots++
    } else if (a.e === "💎") {
      tier   = "JACKPOT"
      prefix = `🎊🎊 *JACKPOT!!* 🎊🎊\n💎 THREE ${a.name}! 💎\n`
    } else if (a.e === "⭐") {
      tier   = "BIG_WIN"
      prefix = `🌟 *BIG WIN!* 🌟\nTHREE ${a.name}!\n`
    } else {
      tier   = "WIN"
      prefix = `🎉 *THREE ${a.name}!*\n`
    }
    return { win: true, coins: prize, tier, msg: `${prefix}💰 +${prize} coins` }
  }

  let pairSym = null
  if (a.e === b.e)      pairSym = a
  else if (a.e === c.e) pairSym = a
  else if (b.e === c.e) pairSym = b

  if (pairSym && pairSym.p2 > 0) {
    const prize = bet * pairSym.p2
    return {
      win: true, coins: prize, tier: "SMALL_WIN",
      msg: `✨ *PAIR of ${pairSym.name}!*\n💰 +${prize} coins`,
    }
  }

  if (pairSym && pairSym.p2 === 0) {
    return {
      win: false, coins: 0, tier: "NEAR_MISS",
      msg: `😬 *SO CLOSE!* Two ${pairSym.name}… no payout.\n❌ -${bet} coins`,
    }
  }

  return {
    win: false, coins: 0, tier: "LOSE",
    msg: `❌ No match. Better luck!\n-${bet} coins`,
  }
}

// ── Display helpers ──────────────────────────────────────────────────

function reelRow(reels) {
  return (
    `┌──────┬──────┬──────┐\n` +
    `│  ${reels[0].e}  │  ${reels[1].e}  │  ${reels[2].e}  │\n` +
    `└──────┴──────┴──────┘`
  )
}

const SPIN_REEL =
  `┌──────┬──────┬──────┐\n` +
  `│  🌀  │  🌀  │  🌀  │\n` +
  `└──────┴──────┴──────┘`

function header() {
  return (
    `╔═══════════════════════════╗\n` +
    `║   🎰  CYBER X  SLOTS  🎰  ║\n` +
    `╚═══════════════════════════╝\n\n`
  )
}

function buildLeaderboard() {
  const sorted = [...SD.coins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (!sorted.length) return "No players yet."
  const medals = ["🥇", "🥈", "🥉", "4️⃣ ", "5️⃣ "]
  return sorted.map(([uid, coins], i) => {
    const name = uid.replace(/[@|].*/, "")
    return `${medals[i]} *${name}* — ${coins} coins`
  }).join("\n")
}

// ── Safe edit helper ─────────────────────────────────────────────────
// Edits a sent message; falls back to a new message if edit fails.
async function editMsg(sock, from, key, text) {
  try {
    await sock.sendMessage(from, { text, edit: key })
  } catch {
    await sock.sendMessage(from, { text })
  }
}

// ════════════════════════════════════════════════════════════════════
//  COMMAND EXPORT
// ════════════════════════════════════════════════════════════════════
module.exports = {
  pattern: "slot",
  desc:    "🎰 Slot machine — bet any amount and win big!",
  usage:   ".slot [amount] | .slot bal | .slot top | .slot daily",

  run: async ({ sock, from, msg, sender, args }) => {

    const uid      = sender.replace(/@.*/, "") + "|" + (from.endsWith("@g.us") ? from : "dm")
    const pushName = msg.pushName || sender.replace(/@.*/, "")
    const sub      = (args[0] || "").toLowerCase().trim()

    // ──────────────────────────────────────────────
    //  .slot bal
    // ──────────────────────────────────────────────
    if (sub === "bal" || sub === "balance") {
      return sock.sendMessage(from, {
        text:
          header() +
          `👤 *${pushName}*\n` +
          `💼 Balance: *${getCoins(uid)} coins*\n\n` +
          `Min bet: ${MIN_BET} coins\n` +
          `Use *.slot daily* for 100 free coins!`,
      }, { quoted: msg })
    }

    // ──────────────────────────────────────────────
    //  .slot top
    // ──────────────────────────────────────────────
    if (sub === "top" || sub === "lb") {
      return sock.sendMessage(from, {
        text:
          `╔═══════════════════════════╗\n` +
          `║   🏆  SLOTS LEADERBOARD   ║\n` +
          `╚═══════════════════════════╝\n\n` +
          buildLeaderboard() + `\n\n` +
          `🎰 Total spins: *${SD.totalSpins}*\n` +
          `🚨 Total jackpots: *${SD.totalJackpots}*`,
      }, { quoted: msg })
    }

    // ──────────────────────────────────────────────
    //  .slot daily
    // ──────────────────────────────────────────────
    if (sub === "daily") {
      if (!canClaimDaily(uid)) {
        const msLeft = DAILY_MS - (Date.now() - (SD.daily.get(uid) || 0))
        const h = Math.floor(msLeft / 3_600_000)
        const m = Math.floor((msLeft % 3_600_000) / 60_000)
        return sock.sendMessage(from, {
          text:
            header() +
            `⏰ Come back in *${h}h ${m}m*.\n` +
            `💼 Balance: *${getCoins(uid)} coins*`,
        }, { quoted: msg })
      }
      SD.daily.set(uid, Date.now())
      const bal = addCoins(uid, DAILY_COINS)
      return sock.sendMessage(from, {
        text:
          header() +
          `🎁 *DAILY BONUS!*\n\n` +
          `👤 *${pushName}*\n` +
          `+${DAILY_COINS} coins claimed!\n` +
          `💼 New balance: *${bal} coins*\n\n` +
          `See you tomorrow 🌅`,
      }, { quoted: msg })
    }

    // ──────────────────────────────────────────────
    //  .slot [amount]  —  SPIN
    // ──────────────────────────────────────────────

    // Parse bet amount
    let bet = DEFAULT_BET
    if (sub && !isNaN(sub)) {
      bet = parseInt(sub, 10)
    }

    if (isNaN(bet) || bet < MIN_BET) {
      return sock.sendMessage(from, {
        text: `❌ Minimum bet is *${MIN_BET} coins*.\nUsage: *.slot 50*`,
      }, { quoted: msg })
    }

    // Cooldown guard
    if (onCooldown(uid)) {
      return sock.sendMessage(from, {
        text: `⏳ *Cooldown!* Try again in *${getCooldownLeft(uid)}s*.`,
      }, { quoted: msg })
    }

    const balBefore = getCoins(uid)

    // Balance guard
    if (balBefore < bet) {
      return sock.sendMessage(from, {
        text:
          header() +
          `💸 *NOT ENOUGH COINS!*\n\n` +
          `You have *${balBefore} coins*, bet was *${bet}*.\n` +
          `Use *.slot daily* for 100 free coins! 🎁`,
      }, { quoted: msg })
    }

    // Set cooldown immediately
    setCooldown(uid)
    SD.totalSpins++
    addCoins(uid, -bet)

    // ── Step 1: Send spinning animation ─────────────────────────────
    const sentMsg = await sock.sendMessage(from, {
      text:
        header() +
        SPIN_REEL + `\n\n` +
        `🎲 *Spinning...* (bet: ${bet} coins)`,
    }, { quoted: msg })

    // ── Step 2: Evaluate result while "spinning" ─────────────────────
    await sleep(SPIN_DELAY_MS)
    const reels  = spin()
    const result = evaluate(reels, bet)

    // Apply winnings
    let balAfter = getCoins(uid)
    if (result.win) {
      balAfter = addCoins(uid, result.coins)
    }

    // ── Step 3: Edit the spinning message with result ────────────────
    const isJackpot = result.tier === "MEGA_JACKPOT" || result.tier === "JACKPOT"
    const low = balAfter < MIN_BET

    const resultText =
      (isJackpot
        ? `╔🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟╗\n` +
          `║   🎰  CYBER X  SLOTS  🎰  ║\n` +
          `╚🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟╝`
        : `╔═══════════════════════════╗\n` +
          `║   🎰  CYBER X  SLOTS  🎰  ║\n` +
          `╚═══════════════════════════╝`) +
      `\n\n` +
      reelRow(reels) + `\n\n` +
      result.msg + `\n\n` +
      `────────────────────────────\n` +
      `👤 *${pushName}*\n` +
      `🎲 Bet: *${bet} coins*\n` +
      `💼 Balance: *${balAfter} coins*` +
      (low ? `\n\n⚠️ Running low! Use *.slot daily* for free coins.` : "")

    await editMsg(sock, from, sentMsg.key, resultText)
  },
}
