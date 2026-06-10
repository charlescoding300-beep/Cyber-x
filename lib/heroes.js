// ═══════════════════════════════════════════════════════════════════
//  lib/heroes.js  —  CYBER X  |  Hero Card Catalog
//
//  130+ heroes from Marvel, DC & more — real powerstats (0-100 scale)
//  sourced from superhero-api (akabab.github.io/superhero-api)
//
//  Exports:
//    HERO_CATALOG   → full array of hero objects
//    getHeroData    → (entry) → { name, publisher, alignment, powerstats }
//    getHeroByName  → (name) → hero | undefined
//    getRandomHero  → () → hero
//    heroOverall    → (powerstats) → 0-100 average score
//    HERO_TIERS     → tier thresholds object
//    getHeroTier    → (powerstats) → { tier, label, emoji }
//
//  Also syncs global.heroSystem so buy.js / battle.js pick it up
//  automatically without needing changes.
// ═══════════════════════════════════════════════════════════════════

// ── Powerstats format ────────────────────────────────────────────────
// { intelligence, strength, speed, durability, power, combat }
// All values 0–100

const HERO_CATALOG = [
  // ── MARVEL ─────────────────────────────────────────────────────────
  { id: 1,   name: "Spider-Man",       publisher: "Marvel", alignment: "good", powerstats: { intelligence: 90, strength: 55, speed: 67, durability: 75, power: 74, combat: 85 } },
  { id: 2,   name: "Iron Man",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 85, speed: 58, durability: 85, power: 100, combat: 64 } },
  { id: 3,   name: "Thor",             publisher: "Marvel", alignment: "good", powerstats: { intelligence: 69, strength: 100, speed: 92, durability: 100, power: 100, combat: 100 } },
  { id: 4,   name: "Hulk",             publisher: "Marvel", alignment: "good", powerstats: { intelligence: 94, strength: 100, speed: 53, durability: 100, power: 98, combat: 85 } },
  { id: 5,   name: "Captain America",  publisher: "Marvel", alignment: "good", powerstats: { intelligence: 69, strength: 19, speed: 35, durability: 56, power: 20, combat: 100 } },
  { id: 6,   name: "Black Widow",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 13, speed: 23, durability: 30, power: 36, combat: 90 } },
  { id: 7,   name: "Hawkeye",          publisher: "Marvel", alignment: "good", powerstats: { intelligence: 81, strength: 18, speed: 27, durability: 42, power: 18, combat: 90 } },
  { id: 8,   name: "Vision",           publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 72, speed: 58, durability: 95, power: 95, combat: 57 } },
  { id: 9,   name: "Scarlet Witch",    publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 10, speed: 23, durability: 60, power: 100, combat: 64 } },
  { id: 10,  name: "War Machine",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 80, speed: 58, durability: 80, power: 85, combat: 80 } },
  { id: 11,  name: "Ant-Man",          publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 18, speed: 23, durability: 28, power: 32, combat: 32 } },
  { id: 12,  name: "Ant-Man II",       publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 18, speed: 17, durability: 40, power: 53, combat: 30 } },
  { id: 13,  name: "Wasp",             publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 14, speed: 40, durability: 35, power: 60, combat: 55 } },
  { id: 14,  name: "Doctor Strange",   publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 18, speed: 39, durability: 42, power: 100, combat: 60 } },
  { id: 15,  name: "Black Panther",    publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 32, speed: 35, durability: 60, power: 42, combat: 100 } },
  { id: 16,  name: "Wolverine",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 32, speed: 50, durability: 100, power: 89, combat: 100 } },
  { id: 17,  name: "Cyclops",          publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 19, speed: 35, durability: 55, power: 80, combat: 80 } },
  { id: 18,  name: "Jean Grey",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 48, speed: 83, durability: 90, power: 100, combat: 64 } },
  { id: 19,  name: "Storm",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 20, speed: 94, durability: 60, power: 100, combat: 60 } },
  { id: 20,  name: "Beast",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 67, speed: 35, durability: 55, power: 47, combat: 55 } },
  { id: 21,  name: "Iceman",           publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 18, speed: 23, durability: 60, power: 95, combat: 60 } },
  { id: 22,  name: "Gambit",           publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 18, speed: 40, durability: 40, power: 80, combat: 90 } },
  { id: 23,  name: "Rogue",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 84, speed: 79, durability: 80, power: 100, combat: 60 } },
  { id: 24,  name: "Psylocke",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 32, speed: 38, durability: 50, power: 80, combat: 90 } },
  { id: 25,  name: "Cable",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 52, speed: 35, durability: 75, power: 100, combat: 90 } },
  { id: 26,  name: "Deadpool",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 69, strength: 32, speed: 50, durability: 100, power: 100, combat: 100 } },
  { id: 27,  name: "Professor X",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 10, speed: 23, durability: 14, power: 100, combat: 14 } },
  { id: 28,  name: "Magneto",          publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 88, strength: 44, speed: 83, durability: 60, power: 100, combat: 65 } },
  { id: 29,  name: "Colossus",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 100, speed: 35, durability: 100, power: 28, combat: 75 } },
  { id: 30,  name: "Nightcrawler",     publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 20, speed: 42, durability: 42, power: 60, combat: 75 } },
  { id: 31,  name: "Emma Frost",       publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 19, speed: 17, durability: 60, power: 100, combat: 40 } },
  { id: 32,  name: "Mystique",         publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 75, strength: 13, speed: 23, durability: 50, power: 80, combat: 70 } },
  { id: 33,  name: "Silver Surfer",    publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 100, speed: 100, durability: 100, power: 100, combat: 85 } },
  { id: 34,  name: "Galactus",         publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 100, speed: 92, durability: 100, power: 100, combat: 75 } },
  { id: 35,  name: "Thanos",           publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 100, speed: 42, durability: 100, power: 100, combat: 95 } },
  { id: 36,  name: "Loki",             publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 88, strength: 63, speed: 50, durability: 85, power: 100, combat: 74 } },
  { id: 37,  name: "Odin",             publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 100, speed: 100, durability: 100, power: 100, combat: 100 } },
  { id: 38,  name: "Captain Marvel",   publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 100, speed: 100, durability: 100, power: 100, combat: 80 } },
  { id: 39,  name: "Moon Knight",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 13, speed: 27, durability: 30, power: 30, combat: 90 } },
  { id: 40,  name: "Blade",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 28, speed: 35, durability: 50, power: 50, combat: 90 } },
  { id: 41,  name: "Ghost Rider",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 50, strength: 84, speed: 67, durability: 85, power: 100, combat: 85 } },
  { id: 42,  name: "Punisher",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 18, speed: 23, durability: 40, power: 13, combat: 85 } },
  { id: 43,  name: "Daredevil",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 69, strength: 18, speed: 35, durability: 50, power: 28, combat: 90 } },
  { id: 44,  name: "Luke Cage",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 84, speed: 27, durability: 100, power: 32, combat: 80 } },
  { id: 45,  name: "Iron Fist",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 55, speed: 50, durability: 50, power: 80, combat: 100 } },
  { id: 46,  name: "She-Hulk",         publisher: "Marvel", alignment: "good", powerstats: { intelligence: 88, strength: 100, speed: 53, durability: 100, power: 80, combat: 80 } },
  { id: 47,  name: "Mister Fantastic", publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 46, speed: 27, durability: 45, power: 70, combat: 58 } },
  { id: 48,  name: "Human Torch",      publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 25, speed: 92, durability: 52, power: 100, combat: 60 } },
  { id: 49,  name: "Invisible Woman",  publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 25, speed: 23, durability: 55, power: 100, combat: 60 } },
  { id: 50,  name: "Thing",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 50, strength: 100, speed: 33, durability: 100, power: 48, combat: 100 } },
  { id: 51,  name: "Nova",             publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 85, speed: 100, durability: 85, power: 100, combat: 80 } },
  { id: 52,  name: "Sentry",           publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 100, speed: 100, durability: 100, power: 100, combat: 90 } },
  { id: 53,  name: "Adam Warlock",     publisher: "Marvel", alignment: "good", powerstats: { intelligence: 100, strength: 84, speed: 83, durability: 100, power: 100, combat: 80 } },
  { id: 54,  name: "Beta Ray Bill",    publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 100, speed: 83, durability: 100, power: 100, combat: 90 } },
  { id: 55,  name: "Namor",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 85, speed: 75, durability: 80, power: 80, combat: 80 } },
  { id: 56,  name: "Venom",            publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 50, strength: 84, speed: 50, durability: 75, power: 74, combat: 60 } },
  { id: 57,  name: "Carnage",          publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 50, strength: 80, speed: 67, durability: 85, power: 80, combat: 55 } },
  { id: 58,  name: "Doctor Doom",      publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 28, speed: 35, durability: 42, power: 100, combat: 75 } },
  { id: 59,  name: "Red Skull",        publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 88, strength: 28, speed: 23, durability: 42, power: 100, combat: 75 } },
  { id: 60,  name: "Green Goblin",     publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 88, strength: 55, speed: 50, durability: 55, power: 50, combat: 65 } },
  { id: 61,  name: "Dormammu",         publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 93, speed: 92, durability: 100, power: 100, combat: 80 } },
  { id: 62,  name: "Ultron",           publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 80, speed: 58, durability: 90, power: 80, combat: 80 } },
  { id: 63,  name: "Apocalypse",       publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 100, speed: 50, durability: 100, power: 100, combat: 80 } },
  { id: 64,  name: "Mephisto",         publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 100, strength: 84, speed: 83, durability: 100, power: 100, combat: 67 } },
  { id: 65,  name: "Abomination",      publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 63, strength: 80, speed: 53, durability: 90, power: 62, combat: 95 } },
  { id: 66,  name: "Electro",          publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 50, strength: 18, speed: 50, durability: 50, power: 100, combat: 50 } },
  { id: 67,  name: "Sandman",          publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 50, strength: 85, speed: 27, durability: 100, power: 80, combat: 60 } },
  { id: 68,  name: "Kingpin",          publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 75, strength: 55, speed: 27, durability: 80, power: 28, combat: 90 } },
  { id: 69,  name: "Taskmaster",       publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 63, strength: 28, speed: 35, durability: 50, power: 18, combat: 100 } },
  { id: 70,  name: "Hyperion",         publisher: "Marvel", alignment: "bad",  powerstats: { intelligence: 63, strength: 100, speed: 100, durability: 100, power: 100, combat: 80 } },
  { id: 71,  name: "Spider-Woman",     publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 42, speed: 50, durability: 60, power: 74, combat: 80 } },
  { id: 72,  name: "Nick Fury",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 81, strength: 18, speed: 23, durability: 30, power: 23, combat: 90 } },
  { id: 73,  name: "Havok",            publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 19, speed: 30, durability: 55, power: 90, combat: 50 } },
  { id: 74,  name: "Polaris",          publisher: "Marvel", alignment: "good", powerstats: { intelligence: 63, strength: 18, speed: 60, durability: 60, power: 95, combat: 40 } },
  { id: 75,  name: "Gladiator",        publisher: "Marvel", alignment: "good", powerstats: { intelligence: 75, strength: 100, speed: 100, durability: 100, power: 100, combat: 85 } },

  // ── DC ─────────────────────────────────────────────────────────────
  { id: 76,  name: "Superman",         publisher: "DC", alignment: "good", powerstats: { intelligence: 94, strength: 100, speed: 100, durability: 100, power: 100, combat: 85 } },
  { id: 77,  name: "Batman",           publisher: "DC", alignment: "good", powerstats: { intelligence: 81, strength: 26, speed: 27, durability: 55, power: 47, combat: 100 } },
  { id: 78,  name: "Wonder Woman",     publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 100, speed: 79, durability: 100, power: 100, combat: 100 } },
  { id: 79,  name: "Flash",            publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 48, speed: 100, durability: 70, power: 80, combat: 35 } },
  { id: 80,  name: "Green Lantern",    publisher: "DC", alignment: "good", powerstats: { intelligence: 81, strength: 85, speed: 100, durability: 85, power: 100, combat: 90 } },
  { id: 81,  name: "Aquaman",          publisher: "DC", alignment: "good", powerstats: { intelligence: 81, strength: 85, speed: 79, durability: 80, power: 100, combat: 80 } },
  { id: 82,  name: "Cyborg",           publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 80, speed: 48, durability: 80, power: 90, combat: 80 } },
  { id: 83,  name: "Martian Manhunter",publisher: "DC", alignment: "good", powerstats: { intelligence: 100, strength: 100, speed: 92, durability: 100, power: 100, combat: 85 } },
  { id: 84,  name: "Green Arrow",      publisher: "DC", alignment: "good", powerstats: { intelligence: 81, strength: 18, speed: 27, durability: 42, power: 18, combat: 90 } },
  { id: 85,  name: "Black Canary",     publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 18, speed: 27, durability: 42, power: 60, combat: 90 } },
  { id: 86,  name: "Shazam",           publisher: "DC", alignment: "good", powerstats: { intelligence: 63, strength: 100, speed: 100, durability: 100, power: 100, combat: 70 } },
  { id: 87,  name: "Nightwing",        publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 26, speed: 38, durability: 44, power: 10, combat: 100 } },
  { id: 88,  name: "Batgirl",          publisher: "DC", alignment: "good", powerstats: { intelligence: 81, strength: 18, speed: 27, durability: 40, power: 18, combat: 90 } },
  { id: 89,  name: "Supergirl",        publisher: "DC", alignment: "good", powerstats: { intelligence: 94, strength: 100, speed: 100, durability: 100, power: 100, combat: 80 } },
  { id: 90,  name: "Hawkman",          publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 55, speed: 67, durability: 60, power: 50, combat: 85 } },
  { id: 91,  name: "Zatanna",          publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 10, speed: 42, durability: 42, power: 100, combat: 55 } },
  { id: 92,  name: "Constantine",      publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 10, speed: 23, durability: 28, power: 100, combat: 32 } },
  { id: 93,  name: "Swamp Thing",      publisher: "DC", alignment: "good", powerstats: { intelligence: 50, strength: 100, speed: 17, durability: 95, power: 100, combat: 50 } },
  { id: 94,  name: "Firestorm",        publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 42, speed: 83, durability: 65, power: 95, combat: 50 } },
  { id: 95,  name: "Blue Beetle",      publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 48, speed: 67, durability: 60, power: 80, combat: 65 } },
  { id: 96,  name: "Booster Gold",     publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 42, speed: 67, durability: 60, power: 80, combat: 55 } },
  { id: 97,  name: "Atom",             publisher: "DC", alignment: "good", powerstats: { intelligence: 94, strength: 18, speed: 27, durability: 28, power: 50, combat: 50 } },
  { id: 98,  name: "Plastic Man",      publisher: "DC", alignment: "good", powerstats: { intelligence: 63, strength: 50, speed: 50, durability: 100, power: 80, combat: 60 } },
  { id: 99,  name: "Power Girl",       publisher: "DC", alignment: "good", powerstats: { intelligence: 88, strength: 100, speed: 100, durability: 100, power: 100, combat: 75 } },
  { id: 100, name: "Red Tornado",      publisher: "DC", alignment: "good", powerstats: { intelligence: 75, strength: 55, speed: 83, durability: 80, power: 90, combat: 70 } },
  { id: 101, name: "Darkseid",         publisher: "DC", alignment: "bad",  powerstats: { intelligence: 100, strength: 100, speed: 83, durability: 100, power: 100, combat: 95 } },
  { id: 102, name: "Brainiac",         publisher: "DC", alignment: "bad",  powerstats: { intelligence: 100, strength: 84, speed: 83, durability: 100, power: 100, combat: 80 } },
  { id: 103, name: "General Zod",      publisher: "DC", alignment: "bad",  powerstats: { intelligence: 88, strength: 100, speed: 100, durability: 100, power: 100, combat: 85 } },
  { id: 104, name: "Doomsday",         publisher: "DC", alignment: "bad",  powerstats: { intelligence: 22, strength: 100, speed: 83, durability: 100, power: 100, combat: 100 } },
  { id: 105, name: "Black Adam",       publisher: "DC", alignment: "bad",  powerstats: { intelligence: 81, strength: 100, speed: 100, durability: 100, power: 100, combat: 80 } },
  { id: 106, name: "Sinestro",         publisher: "DC", alignment: "bad",  powerstats: { intelligence: 88, strength: 80, speed: 83, durability: 80, power: 100, combat: 80 } },
  { id: 107, name: "Lex Luthor",       publisher: "DC", alignment: "bad",  powerstats: { intelligence: 100, strength: 28, speed: 27, durability: 40, power: 80, combat: 65 } },
  { id: 108, name: "Joker",            publisher: "DC", alignment: "bad",  powerstats: { intelligence: 88, strength: 18, speed: 27, durability: 35, power: 42, combat: 70 } },
  { id: 109, name: "Bane",             publisher: "DC", alignment: "bad",  powerstats: { intelligence: 75, strength: 100, speed: 27, durability: 80, power: 35, combat: 85 } },
  { id: 110, name: "Ra's al Ghul",     publisher: "DC", alignment: "bad",  powerstats: { intelligence: 88, strength: 26, speed: 27, durability: 55, power: 42, combat: 100 } },
  { id: 111, name: "Deathstroke",      publisher: "DC", alignment: "bad",  powerstats: { intelligence: 88, strength: 55, speed: 35, durability: 65, power: 70, combat: 100 } },
  { id: 112, name: "Black Manta",      publisher: "DC", alignment: "bad",  powerstats: { intelligence: 81, strength: 63, speed: 27, durability: 65, power: 70, combat: 90 } },
  { id: 113, name: "Lobo",             publisher: "DC", alignment: "bad",  powerstats: { intelligence: 75, strength: 100, speed: 83, durability: 100, power: 80, combat: 85 } },
  { id: 114, name: "Reverse Flash",    publisher: "DC", alignment: "bad",  powerstats: { intelligence: 94, strength: 48, speed: 100, durability: 70, power: 90, combat: 55 } },
  { id: 115, name: "Gorilla Grodd",    publisher: "DC", alignment: "bad",  powerstats: { intelligence: 100, strength: 80, speed: 35, durability: 75, power: 90, combat: 80 } },
  { id: 116, name: "Poison Ivy",       publisher: "DC", alignment: "bad",  powerstats: { intelligence: 81, strength: 13, speed: 27, durability: 42, power: 75, combat: 35 } },
  { id: 117, name: "Harley Quinn",     publisher: "DC", alignment: "bad",  powerstats: { intelligence: 63, strength: 18, speed: 27, durability: 50, power: 22, combat: 65 } },
  { id: 118, name: "Killer Frost",     publisher: "DC", alignment: "bad",  powerstats: { intelligence: 69, strength: 28, speed: 35, durability: 55, power: 90, combat: 60 } },
  { id: 119, name: "Solomon Grundy",   publisher: "DC", alignment: "bad",  powerstats: { intelligence: 10, strength: 100, speed: 20, durability: 100, power: 60, combat: 80 } },
  { id: 120, name: "Parasite",         publisher: "DC", alignment: "bad",  powerstats: { intelligence: 50, strength: 80, speed: 35, durability: 80, power: 100, combat: 65 } },

  // ── OTHER PUBLISHERS ───────────────────────────────────────────────
  { id: 121, name: "Spawn",            publisher: "Image",    alignment: "good", powerstats: { intelligence: 63, strength: 72, speed: 35, durability: 85, power: 100, combat: 85 } },
  { id: 122, name: "Invincible",       publisher: "Image",    alignment: "good", powerstats: { intelligence: 75, strength: 90, speed: 90, durability: 90, power: 80, combat: 85 } },
  { id: 123, name: "Omni-Man",         publisher: "Image",    alignment: "bad",  powerstats: { intelligence: 75, strength: 100, speed: 100, durability: 100, power: 90, combat: 90 } },
  { id: 124, name: "Hellboy",          publisher: "Dark Horse",alignment: "good", powerstats: { intelligence: 63, strength: 80, speed: 27, durability: 85, power: 85, combat: 90 } },
  { id: 125, name: "The Tick",         publisher: "NEC",      alignment: "good", powerstats: { intelligence: 25, strength: 100, speed: 27, durability: 100, power: 40, combat: 70 } },
  { id: 126, name: "Judge Dredd",      publisher: "2000 AD",  alignment: "good", powerstats: { intelligence: 75, strength: 18, speed: 27, durability: 55, power: 15, combat: 95 } },
  { id: 127, name: "Goku",             publisher: "Shueisha", alignment: "good", powerstats: { intelligence: 63, strength: 100, speed: 100, durability: 100, power: 100, combat: 100 } },
  { id: 128, name: "Vegeta",           publisher: "Shueisha", alignment: "good", powerstats: { intelligence: 75, strength: 100, speed: 100, durability: 100, power: 100, combat: 100 } },
  { id: 129, name: "One Punch Man",    publisher: "Shueisha", alignment: "good", powerstats: { intelligence: 38, strength: 100, speed: 100, durability: 100, power: 100, combat: 100 } },
  { id: 130, name: "Naruto",           publisher: "Shueisha", alignment: "good", powerstats: { intelligence: 63, strength: 80, speed: 80, durability: 80, power: 90, combat: 85 } },
]

// ── Utility functions ────────────────────────────────────────────────

/**
 * Average of all 6 powerstats → 0-100 overall score
 */
function heroOverall(ps) {
  if (!ps) return 0
  const vals = [ps.intelligence, ps.strength, ps.speed, ps.durability, ps.power, ps.combat]
  return Math.round(vals.map(n => n || 0).reduce((a, b) => a + b, 0) / vals.length)
}

/**
 * Get hero data by catalog entry or name string.
 * Always returns a Promise for compatibility with battle.js.
 */
function getHeroData(entry) {
  const name   = typeof entry === "string" ? entry : entry?.name
  const hero   = HERO_CATALOG.find(h => h.name.toLowerCase() === (name || "").toLowerCase())
  if (hero) return Promise.resolve(hero)
  return Promise.reject(new Error(`Hero not found: ${name}`))
}

function getHeroByName(name) {
  return HERO_CATALOG.find(h =>
    h.name.toLowerCase().includes((name || "").toLowerCase())
  )
}

function getRandomHero() {
  return HERO_CATALOG[Math.floor(Math.random() * HERO_CATALOG.length)]
}

// ── Tier system ───────────────────────────────────────────────────────
const HERO_TIERS = { S: 90, A: 75, B: 60, C: 45, D: 0 }

function getHeroTier(ps) {
  const score = heroOverall(ps)
  if (score >= HERO_TIERS.S) return { tier: "S", label: "GODLIKE",  emoji: "🌟", score }
  if (score >= HERO_TIERS.A) return { tier: "A", label: "ELITE",    emoji: "💎", score }
  if (score >= HERO_TIERS.B) return { tier: "B", label: "POWERFUL", emoji: "🔥", score }
  if (score >= HERO_TIERS.C) return { tier: "C", label: "AVERAGE",  emoji: "⚡", score }
  return                             { tier: "D", label: "ROOKIE",   emoji: "🥉", score }
}

// ── Sync global.heroSystem so buy.js / battle.js pick it up ──────────
if (!global.heroSystem) {
  global.heroSystem = { apiCache: new Map(), collection: new Map(), battles: new Map() }
}
global.heroSystem.CATALOG    = HERO_CATALOG
global.heroSystem.getHeroData = getHeroData
global.heroSystem.overall     = heroOverall

console.log(`[HEROES] ✔ ${HERO_CATALOG.length} heroes loaded`)

module.exports = {
  HERO_CATALOG,
  getHeroData,
  getHeroByName,
  getRandomHero,
  heroOverall,
  HERO_TIERS,
  getHeroTier,
}
