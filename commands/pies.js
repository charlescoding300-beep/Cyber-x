'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — PIES COMMAND
//  Usage: .pies <any country in the world>
//  Anyone can use | Category: general
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fetch = require('node-fetch')

const CREDIT =
`*╭══ ✕-CYBER X ⚡*
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

const BASE = 'https://api.shizo.top/pies'

const ALIASES = {
    'usa': 'usa', 'united states': 'usa', 'america': 'usa', 'us': 'usa',
    'uk': 'uk', 'united kingdom': 'uk', 'england': 'uk', 'britain': 'uk',
    'uae': 'uae', 'dubai': 'uae', 'emirates': 'uae',
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
    'ivory coast': 'ivorycoast', "cote d'ivoire": 'ivorycoast',
    'trinidad': 'trinidad', 'trinidad and tobago': 'trinidad',
    'united arab emirates': 'uae',
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
    'ivory': 'ivorycoast',
}

function resolveCountry(input) {
    const lower   = input.toLowerCase().trim()
    if (ALIASES[lower]) return ALIASES[lower]
    const noSpace = lower.replace(/\s+/g, '')
    if (ALIASES[noSpace]) return ALIASES[noSpace]
    return noSpace || lower
}

async function fetchPiesImage(country) {
    const url = `${BASE}/${encodeURIComponent(country)}?apikey=shizo`
    const res  = await fetch(url, { timeout: 10000 })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('image')) throw new Error('Not an image')
    return res.buffer()
}

module.exports = {
    pattern:  'pies',
    alias:    ['pie', 'country'],
    category: 'general',
    desc:     'Get a pie chart image for any country',
    usage:    '.pies <country>',

    run: async ({ sock, from, msg, args, text }) => {

        const input = (text || args.join(' ')).trim()

        // ── No input → usage help ──────────────────────────────
        if (!input) {
            return sock.sendMessage(from, {
                text:
`╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIES*   ║
╚════════════════════════════╝

❌ *No country provided!*

┌─────────────────────────────
│ 📌 *Usage:*
│  _.pies <any country>_
└─────────────────────────────

🔥 *Examples:*
  _.pies nigeria_
  _.pies united states_
  _.pies south africa_
  _.pies japan_
  _.pies brazil_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── React 🗽 ───────────────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '🗽', key: msg.key }
        }).catch(() => {})

        const countrySlug = resolveCountry(input)
        const displayName = input.trim()
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')

        try {
            const imgBuf = await fetchPiesImage(countrySlug)

            await sock.sendMessage(from, {
                image:    imgBuf,
                caption:
`🗽 *${displayName}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                mimetype: 'image/jpeg',
            }, { quoted: msg })

        } catch (err) {
            console.error('[PIES]', err.message)
            await sock.sendMessage(from, {
                react: { text: '❌', key: msg.key }
            }).catch(() => {})
            await sock.sendMessage(from, {
                text:
`╔════════════════════════════╗
║  🗽  *C Y B E R  X  PIES*   ║
╚════════════════════════════╝

❌ *Could not find image for:* _"${displayName}"_

💡 Try a different spelling or country name

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }
    }
}
