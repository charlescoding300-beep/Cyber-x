'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — PIES COMMAND
//  Usage: .pies <any country in the world>
//  Anyone can use | Category: general
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CREDIT = `> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

const APIS = [
  (slug) => `https://api.shizo.top/pies/${encodeURIComponent(slug)}?apikey=shizo`,
  (slug) => `https://some-random-api.com/canvas/misc/simpcard?user=${encodeURIComponent(slug)}`,
]

const ALIASES = {
  'usa': 'usa', 'united states': 'usa', 'america': 'usa', 'us': 'usa',
  'uk': 'uk', 'united kingdom': 'uk', 'england': 'uk', 'britain': 'uk',
  'uae': 'uae', 'dubai': 'uae', 'emirates': 'uae', 'united arab emirates': 'uae',
  'south korea': 'korea', 'korea': 'korea',
  'north korea': 'northkorea', 'dprk': 'northkorea',
  'russia': 'russia', 'russian federation': 'russia',
  'saudi': 'saudi', 'saudi arabia': 'saudi',
  'south africa': 'southafrica',
  'new zealand': 'newzealand',
  'costa rica': 'costarica',
  'puerto rico': 'puertorico',
  'sri lanka': 'srilanka',
  'czech republic': 'czech', 'czechia': 'czech',
  'dominican republic': 'dominican',
  'el salvador': 'elsalvador',
  'hong kong': 'hongkong',
  'ivory coast': 'ivorycoast', "cote d'ivoire": 'ivorycoast', 'ivory': 'ivorycoast',
  'trinidad': 'trinidad', 'trinidad and tobago': 'trinidad',
  'bosnia': 'bosnia', 'bosnia and herzegovina': 'bosnia',
  'papua new guinea': 'papuanewguinea',
  'central african republic': 'car',
  'congo': 'congo', 'drc': 'drc', 'democratic republic of congo': 'drc',
  'burkina faso': 'burkinafaso',
  'cape verde': 'capeverde',
  'equatorial guinea': 'equatorialguinea',
  'guinea bissau': 'guineabissau',
  'marshall islands': 'marshallislands',
  'solomon islands': 'solomonislands',
  'sierra leone': 'sierraleone',
  'san marino': 'sanmarino',
}

function resolveCountry(input) {
  const lower = input.toLowerCase().trim()
  if (ALIASES[lower]) return ALIASES[lower]
  const noSpace = lower.replace(/\s+/g, '')
  if (ALIASES[noSpace]) return ALIASES[noSpace]
  return noSpace || lower
}

function toTitleCase(str) {
  return str.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

async function fetchImage(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('image')) throw new Error(`Not an image: ${ct}`)
  return Buffer.from(await res.arrayBuffer())
}

module.exports = {
  pattern:  'pies',
  alias:    ['pie', 'countrypie'],
  category: 'general',
  desc:     'Get a pie chart image for any country',
  usage:    '.pies <country>',

  run: async ({ sock, from, msg, args, text }) => {

    const input = (text || args?.join(' ') || '').trim()

    // ── No input → usage help ──────────────────────────────────
    if (!input) {
      return sock.sendMessage(from, {
        text: `╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIES*  ║
╚════════════════════════════╝

❌ *No country provided!*

┌─────────────────────────────
│ 📌 *Usage:*  _.pies <country>_
└─────────────────────────────

🔥 *Examples:*
  _.pies nigeria_
  _.pies united states_
  _.pies south africa_
  _.pies japan_
  _.pies brazil_

${CREDIT}`,
      }, { quoted: msg })
    }

    // ── React instantly ────────────────────────────────────────
    await sock.sendMessage(from, { react: { text: '🗽', key: msg.key } }).catch(() => {})

    const slug        = resolveCountry(input)
    const displayName = toTitleCase(input)

    // ── Try each API in chain ──────────────────────────────────
    let buf = null
    for (const buildUrl of APIS) {
      try {
        buf = await fetchImage(buildUrl(slug))
        break
      } catch (e) {
        console.warn(`[PIES] API failed (${buildUrl(slug)}):`, e.message)
      }
    }

    if (buf) {
      await sock.sendMessage(from, {
        image:   buf,
        caption: `🗽 *${displayName}*\n\n${CREDIT}`,
        mimetype: 'image/jpeg',
      }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})
    } else {
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      await sock.sendMessage(from, {
        text: `╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIES*  ║
╚════════════════════════════╝

❌ *Could not find pie chart for:* _"${displayName}"_

💡 Try a different spelling or country name

${CREDIT}`,
      }, { quoted: msg })
    }
  }
}
