// ════════════════════════════════════════════════════════════════════
//  lib/pokemonEngine.js  —  CYBER X  |  🎮 Pokémon Engine
//  Shared logic for all Pokemon commands.
//  Data persists to ./data/pokemon_data.json on EVERY write.
//  global.pokemonDB survives hot-reloads and crashes.
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

// ── Persistent Store ──────────────────────────────────────────────────
const DATA_DIR  = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'pokemon_data.json')

function loadData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8')
      return JSON.parse(raw)
    }
  } catch (e) { console.error('[PokéEngine] Load error:', e.message) }
  return { users: {}, pendingBattles: {}, activeBattles: {} }
}

function saveData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(DATA_FILE, JSON.stringify(global.pokemonDB, null, 2), 'utf8')
  } catch (e) { console.error('[PokéEngine] Save error:', e.message) }
}

// Boot: prefer global (hot-reload), else load file
if (!global.pokemonDB) global.pokemonDB = loadData()
const DB = global.pokemonDB

// ── Pokémon Registry ─────────────────────────────────────────────────
// [ name, type, hp, atk, def, spd, price, tier, moves[] ]
const POKEMON = {
  // ── COMMON ──────────────────────────────────────────────────────
  1:   { name:"Bulbasaur",  type:"grass",    hp:45,  atk:49,  def:49,  spd:45,  price:350,  tier:"common",    moves:["Tackle","Vine Whip","Razor Leaf","Solar Beam"] },
  4:   { name:"Charmander", type:"fire",     hp:39,  atk:52,  def:43,  spd:65,  price:350,  tier:"common",    moves:["Scratch","Ember","Flamethrower","Fire Blast"] },
  7:   { name:"Squirtle",   type:"water",    hp:44,  atk:48,  def:65,  spd:43,  price:350,  tier:"common",    moves:["Tackle","Water Gun","Bubble","Hydro Pump"] },
  25:  { name:"Pikachu",    type:"electric", hp:35,  atk:55,  def:30,  spd:90,  price:500,  tier:"common",    moves:["Quick Attack","Thundershock","Thunderbolt","Thunder"] },
  133: { name:"Eevee",      type:"normal",   hp:55,  atk:55,  def:50,  spd:55,  price:400,  tier:"common",    moves:["Tackle","Quick Attack","Bite","Last Resort"] },
  39:  { name:"Jigglypuff", type:"fairy",    hp:115, atk:45,  def:20,  spd:20,  price:300,  tier:"common",    moves:["Pound","Body Slam","Hyper Voice","Sing"] },
  52:  { name:"Meowth",     type:"normal",   hp:40,  atk:45,  def:35,  spd:90,  price:300,  tier:"common",    moves:["Scratch","Bite","Slash","Pay Day"] },
  54:  { name:"Psyduck",    type:"water",    hp:50,  atk:52,  def:48,  spd:55,  price:350,  tier:"common",    moves:["Scratch","Water Gun","Confusion","Hydro Pump"] },
  74:  { name:"Geodude",    type:"rock",     hp:40,  atk:80,  def:100, spd:20,  price:300,  tier:"common",    moves:["Tackle","Rock Throw","Rollout","Stone Edge"] },
  129: { name:"Magikarp",   type:"water",    hp:20,  atk:10,  def:55,  spd:80,  price:100,  tier:"common",    moves:["Splash","Tackle","Flail","Bounce"] },
  // ── UNCOMMON ────────────────────────────────────────────────────
  6:   { name:"Charizard",  type:"fire",     hp:78,  atk:84,  def:78,  spd:100, price:2000, tier:"uncommon",  moves:["Flamethrower","Dragon Claw","Air Slash","Blast Burn"] },
  9:   { name:"Blastoise",  type:"water",    hp:79,  atk:83,  def:100, spd:78,  price:2000, tier:"uncommon",  moves:["Hydro Pump","Ice Beam","Flash Cannon","Skull Bash"] },
  3:   { name:"Venusaur",   type:"grass",    hp:80,  atk:82,  def:83,  spd:80,  price:2000, tier:"uncommon",  moves:["Razor Leaf","Solar Beam","Sludge Bomb","Frenzy Plant"] },
  26:  { name:"Raichu",     type:"electric", hp:60,  atk:90,  def:55,  spd:110, price:1500, tier:"uncommon",  moves:["Thunderbolt","Thunder","Quick Attack","Volt Tackle"] },
  94:  { name:"Gengar",     type:"ghost",    hp:60,  atk:65,  def:60,  spd:110, price:1800, tier:"uncommon",  moves:["Shadow Ball","Dark Pulse","Hypnosis","Shadow Punch"] },
  68:  { name:"Machamp",    type:"fighting", hp:90,  atk:130, def:80,  spd:55,  price:1600, tier:"uncommon",  moves:["Cross Chop","Dynamic Punch","Seismic Toss","Close Combat"] },
  65:  { name:"Alakazam",   type:"psychic",  hp:55,  atk:50,  def:45,  spd:120, price:1800, tier:"uncommon",  moves:["Psychic","Shadow Ball","Focus Blast","Psybeam"] },
  130: { name:"Gyarados",   type:"water",    hp:95,  atk:125, def:79,  spd:81,  price:2200, tier:"uncommon",  moves:["Waterfall","Hyper Beam","Ice Fang","Dragon Rage"] },
  143: { name:"Snorlax",    type:"normal",   hp:160, atk:110, def:65,  spd:30,  price:1800, tier:"uncommon",  moves:["Body Slam","Crunch","Rest","Hyper Beam"] },
  131: { name:"Lapras",     type:"water",    hp:130, atk:85,  def:80,  spd:60,  price:2000, tier:"uncommon",  moves:["Surf","Ice Beam","Thunder","Psychic"] },
  59:  { name:"Arcanine",   type:"fire",     hp:90,  atk:110, def:80,  spd:95,  price:2200, tier:"uncommon",  moves:["Flamethrower","Extreme Speed","Crunch","Outrage"] },
  // ── RARE ────────────────────────────────────────────────────────
  149: { name:"Dragonite",  type:"dragon",   hp:91,  atk:134, def:95,  spd:80,  price:4000, tier:"rare",      moves:["Dragon Claw","Hyper Beam","Thunder","Fire Blast"] },
  112: { name:"Rhydon",     type:"rock",     hp:105, atk:130, def:120, spd:40,  price:3000, tier:"rare",      moves:["Stone Edge","Earthquake","Hammer Arm","Megahorn"] },
  142: { name:"Aerodactyl", type:"flying",   hp:80,  atk:105, def:65,  spd:130, price:3500, tier:"rare",      moves:["Aerial Ace","Rock Slide","Bite","Hyper Beam"] },
  248: { name:"Tyranitar",  type:"rock",     hp:100, atk:134, def:110, spd:61,  price:4500, tier:"rare",      moves:["Stone Edge","Crunch","Earthquake","Hyper Beam"] },
  // ── LEGENDARY ───────────────────────────────────────────────────
  144: { name:"Articuno",   type:"ice",      hp:90,  atk:85,  def:100, spd:85,  price:7000, tier:"legendary", moves:["Blizzard","Ice Beam","Hurricane","Sheer Cold"] },
  145: { name:"Zapdos",     type:"electric", hp:90,  atk:90,  def:85,  spd:100, price:7000, tier:"legendary", moves:["Thunder","Thunderbolt","Heat Wave","Drill Peck"] },
  146: { name:"Moltres",    type:"fire",     hp:90,  atk:100, def:90,  spd:90,  price:7000, tier:"legendary", moves:["Fire Blast","Flamethrower","Heat Wave","Solar Beam"] },
  150: { name:"Mewtwo",     type:"psychic",  hp:106, atk:110, def:90,  spd:130, price:10000,tier:"legendary", moves:["Psystrike","Shadow Ball","Ice Beam","Hyper Beam"] },
  249: { name:"Lugia",      type:"psychic",  hp:106, atk:90,  def:130, spd:110, price:9000, tier:"legendary", moves:["Aeroblast","Psychic","Shadow Ball","Hydro Pump"] },
  250: { name:"Ho-Oh",      type:"fire",     hp:106, atk:130, def:90,  spd:90,  price:9000, tier:"legendary", moves:["Sacred Fire","Brave Bird","Earthquake","Solar Beam"] },
}

// ── Move power table ──────────────────────────────────────────────────
const MOVE_POWER = {
  "Splash":0,"Sing":0,"Hypnosis":0,"Rest":0,
  "Tackle":35,"Scratch":35,"Pound":35,"Flail":30,"Bounce":60,
  "Quick Attack":40,"Bite":60,"Vine Whip":45,"Water Gun":40,
  "Ember":40,"Thundershock":40,"Bubble":40,"Pay Day":40,
  "Rock Throw":50,"Confusion":50,"Rollout":30,"Razor Leaf":55,
  "Slash":70,"Body Slam":85,"Seismic Toss":60,"Submission":80,
  "Flamethrower":90,"Thunderbolt":90,"Ice Beam":90,"Psychic":90,
  "Shadow Ball":80,"Solar Beam":120,"Hyper Beam":150,"Thunder":110,
  "Blizzard":110,"Hydro Pump":110,"Dark Pulse":80,"Dragon Claw":80,
  "Air Slash":75,"Surf":90,"Cross Chop":100,"Dynamic Punch":100,
  "Hammer Arm":100,"Fire Blast":110,"Blast Burn":150,"Focus Blast":120,
  "Psybeam":65,"Dragon Rage":40,"Ice Fang":65,"Waterfall":80,"Crunch":80,
  "Volt Tackle":120,"Extreme Speed":80,"Outrage":120,"Psystrike":100,
  "Sheer Cold":120,"Heat Wave":95,"Drill Peck":80,"Sacred Fire":100,
  "Earthquake":100,"Brave Bird":120,"Frenzy Plant":150,"Skull Bash":130,
  "Flash Cannon":80,"Sludge Bomb":90,"Stone Edge":100,"Megahorn":120,
  "Shadow Punch":60,"Aeroblast":100,"Last Resort":140,"Hyper Voice":90,
  "Close Combat":120,"Rock Slide":75,"Aerial Ace":60,"Aerial Slash":75,
  "Thunderforce":110,"Volt Crash":90,"Last Stand":120,
}

// ── Type effectiveness ────────────────────────────────────────────────
const TYPE_CHART = {
  fire:     { grass:2, bug:2, ice:2, steel:2, water:0.5, fire:0.5, rock:0.5, dragon:0.5 },
  water:    { fire:2, ground:2, rock:2, water:0.5, grass:0.5, dragon:0.5 },
  grass:    { water:2, ground:2, rock:2, fire:0.5, grass:0.5, poison:0.5, flying:0.5, bug:0.5, dragon:0.5, steel:0.5 },
  electric: { water:2, flying:2, electric:0.5, grass:0.5, dragon:0.5, ground:0 },
  psychic:  { fighting:2, poison:2, psychic:0.5, dark:0 },
  ice:      { grass:2, ground:2, flying:2, dragon:2, water:0.5, ice:0.5 },
  dragon:   { dragon:2, steel:0.5 },
  ghost:    { ghost:2, psychic:2, normal:0, fighting:0 },
  fighting: { normal:2, ice:2, rock:2, dark:2, steel:2, ghost:0, flying:0.5, psychic:0.5 },
  rock:     { fire:2, ice:2, flying:2, bug:2, fighting:0.5, ground:0.5, steel:0.5 },
  normal:   { rock:0.5, steel:0.5, ghost:0 },
  fairy:    { fighting:2, dragon:2, dark:2, fire:0.5, poison:0.5, steel:0.5 },
  flying:   { grass:2, fighting:2, bug:2, electric:0.5, rock:0.5, steel:0.5 },
}

// ── Emoji helpers ─────────────────────────────────────────────────────
const TIER_EMOJI = { common:"⚪", uncommon:"🟢", rare:"🔵", legendary:"🌟" }
const TYPE_EMOJI = {
  fire:"🔥", water:"💧", grass:"🌿", electric:"⚡", psychic:"🔮",
  ice:"❄️",  dragon:"🐉", ghost:"👻", fighting:"🥊", rock:"🪨",
  normal:"🔘", fairy:"🧚", flying:"🌪️", poison:"☠️",
}

function tierEmoji(t) { return TIER_EMOJI[t]  || "⚪" }
function typeEmoji(t)  { return TYPE_EMOJI[t]  || "❓" }

// ── Animated GIF URL (Gen-V Black/White sprites — they actually move!) ─
function gifUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`
}

// Static fallback (front-default)
function imgUrl(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`
}

// ── User helpers (UID = phone number only — shared across DM + groups) ─
function getUser(uid) {
  if (!DB.users[uid]) DB.users[uid] = { cards:[], activeCard:0, battleWins:0, battleLosses:0 }
  return DB.users[uid]
}

function getActiveCard(uid) {
  const u = getUser(uid)
  return u.cards[u.activeCard] || u.cards[0] || null
}

function hasCard(uid, pokemonId) {
  return getUser(uid).cards.some(c => c.pokemonId === pokemonId)
}

// ── Coin bridge (reads from slot machine's global.slotData) ───────────
function getCoins(uid) {
  if (!global.slotData) global.slotData = { coins: new Map(), cooldowns: new Map(), daily: new Map(), totalSpins:0, totalJackpots:0 }
  if (!global.slotData.coins.has(uid)) global.slotData.coins.set(uid, 200)
  return global.slotData.coins.get(uid)
}

function addCoins(uid, amount) {
  const cur = getCoins(uid)
  global.slotData.coins.set(uid, Math.max(0, cur + amount))
  return global.slotData.coins.get(uid)
}

// ── Damage formula ────────────────────────────────────────────────────
function calcDamage(atkCard, defCard, moveName) {
  const pkA   = POKEMON[atkCard.pokemonId]
  const pkD   = POKEMON[defCard.pokemonId]
  const power = MOVE_POWER[moveName] ?? 40
  if (power === 0) return 0

  const base   = Math.floor(((2 * 50 / 5 + 2) * power * pkA.atk / pkD.def) / 50 + 2)
  const rand   = 0.85 + Math.random() * 0.15
  const eff    = (TYPE_CHART[pkA.type] || {})[pkD.type] ?? 1
  return Math.max(1, Math.floor(base * rand * eff))
}

function effText(atkType, defType) {
  const eff = (TYPE_CHART[atkType] || {})[defType] ?? 1
  if (eff === 2)   return "\n⚡ *Super effective!*"
  if (eff === 0.5) return "\n😶 *Not very effective...*"
  if (eff === 0)   return "\n🚫 *Has no effect!*"
  return ""
}

// ── HP bar ────────────────────────────────────────────────────────────
function hpBar(cur, max, len = 10) {
  const pct  = Math.max(0, cur) / max
  const fill = Math.round(pct * len)
  const dot  = pct > 0.5 ? "🟩" : pct > 0.25 ? "🟨" : "🟥"
  return dot.repeat(fill) + "⬛".repeat(len - fill) + `  ${Math.max(0,cur)}/${max} HP`
}

// ── Sleep / edit helpers ──────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function editMsg(sock, from, key, text) {
  try { await sock.sendMessage(from, { text, edit: key }) }
  catch { await sock.sendMessage(from, { text }) }
}

// ── Auto-battle simulator (edits one message per round) ───────────────
async function runBattle(sock, from, battleKey, sentKey) {
  const battle = DB.activeBattles[battleKey]
  if (!battle) return

  const { uid1, uid2, name1, name2, card1, card2, prize } = battle
  const pkm1 = POKEMON[card1.pokemonId]
  const pkm2 = POKEMON[card2.pokemonId]

  let hp1 = pkm1.hp
  let hp2 = pkm2.hp
  const log = []

  const header =
    `╔════════════════════════════╗\n` +
    `║   ⚔️  *POKÉMON BATTLE!*  ⚔️   ║\n` +
    `╚════════════════════════════╝`

  for (let round = 1; round <= 25; round++) {
    if (hp1 <= 0 || hp2 <= 0) break

    // Speed determines first attacker
    const order = pkm1.spd >= pkm2.spd ? [1, 2] : [2, 1]

    for (const atk of order) {
      if (hp1 <= 0 || hp2 <= 0) break

      const isA1    = atk === 1
      const atkCard = isA1 ? card1 : card2
      const defCard = isA1 ? card2 : card1
      const atkPkm  = isA1 ? pkm1  : pkm2
      const atkName = isA1 ? name1 : name2
      const defName = isA1 ? name2 : name1
      const move    = atkPkm.moves[Math.floor(Math.random() * atkPkm.moves.length)]
      const dmg     = calcDamage(atkCard, defCard, move)
      const eff     = effText(atkPkm.type, POKEMON[defCard.pokemonId].type)

      if (isA1) hp2 = Math.max(0, hp2 - dmg)
      else      hp1 = Math.max(0, hp1 - dmg)

      log.push(`${isA1 ? "🔴" : "🔵"} *${atkName}* → *${move}* ─ -${dmg} HP${eff}`)
    }

    const roundText =
      header + `\n\n` +
      `🔴 *${name1}* (${pkm1.name} ${typeEmoji(pkm1.type)})\n` +
      hpBar(hp1, pkm1.hp) + `\n\n` +
      `🔵 *${name2}* (${pkm2.name} ${typeEmoji(pkm2.type)})\n` +
      hpBar(hp2, pkm2.hp) + `\n\n` +
      `───── Round ${round} ─────\n` +
      log.slice(-6).join("\n") + `\n\n` +
      (hp1 > 0 && hp2 > 0 ? `⏳ Round ${round + 1} loading...` : "")

    await editMsg(sock, from, sentKey, roundText)
    if (hp1 > 0 && hp2 > 0) await sleep(2800)
  }

  // ── Result ─────────────────────────────────────────────────────
  const p1won     = hp1 > 0
  const winnerUid = p1won ? uid1 : uid2
  const loserUid  = p1won ? uid2 : uid1
  const winName   = p1won ? name1 : name2
  const losName   = p1won ? name2 : name1
  const winPkm    = p1won ? pkm1  : pkm2
  const losPkm    = p1won ? pkm2  : pkm1

  addCoins(winnerUid, prize)
  const wUser = getUser(winnerUid)
  const lUser = getUser(loserUid)
  wUser.battleWins++
  lUser.battleLosses++

  // XP + win for winner's active card
  const wCard = p1won ? card1 : card2
  const wIdx  = wUser.cards.findIndex(c => c.pokemonId === wCard.pokemonId)
  if (wIdx !== -1) {
    wUser.cards[wIdx].xp   = (wUser.cards[wIdx].xp   || 0) + 50
    wUser.cards[wIdx].wins = (wUser.cards[wIdx].wins  || 0) + 1
  }

  delete DB.activeBattles[battleKey]
  saveData()

  const finalText =
    `╔════════════════════════════╗\n` +
    `║   🏆  *BATTLE RESULT!*  🏆   ║\n` +
    `╚════════════════════════════╝\n\n` +
    `🔴 *${name1}* (${pkm1.name})\n` +
    hpBar(Math.max(0,hp1), pkm1.hp) + `\n\n` +
    `🔵 *${name2}* (${pkm2.name})\n` +
    hpBar(Math.max(0,hp2), pkm2.hp) + `\n\n` +
    `✨✨✨✨✨✨✨✨✨✨\n` +
    `🥇 *${winName} WINS!*\n` +
    `💔 ${losName}'s *${losPkm.name}* fainted!\n` +
    `✨✨✨✨✨✨✨✨✨✨\n\n` +
    `💰 *+${prize} coins* awarded to ${winName}!\n` +
    `📊 W/L  ${wUser.battleWins}/${wUser.battleLosses} → ${winName}`

  await editMsg(sock, from, sentKey, finalText)
}

module.exports = {
  DB, saveData, POKEMON, gifUrl, imgUrl,
  tierEmoji, typeEmoji, hpBar, sleep, editMsg,
  getUser, getActiveCard, hasCard, getCoins, addCoins,
  calcDamage, effText, runBattle,
  TIER_EMOJI, TYPE_EMOJI,
}
