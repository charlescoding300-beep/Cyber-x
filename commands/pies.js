const fetch = require('node-fetch');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — PIES COMMAND
//  Usage: .pies <any country in the world>
//  Reaction: 🗽  |  Category: General
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BASE = 'https://api.shizo.top/pies';

// Normalize input → match closest country slug
// Uses a broad alias map + fallback to raw input
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
};

function resolveCountry(input) {
    const lower = input.toLowerCase().trim();
    // Check alias map first
    if (ALIASES[lower]) return ALIASES[lower];
    // Strip spaces for compound names (e.g. "south africa" → "southafrica")
    const noSpace = lower.replace(/\s+/g, '');
    if (ALIASES[noSpace]) return ALIASES[noSpace];
    // Fallback: just pass it raw (single word countries like france, japan, etc.)
    return noSpace || lower;
}

async function fetchPiesImage(country) {
    const url = `${BASE}/${encodeURIComponent(country)}?apikey=shizo`;
    const res = await fetch(url, { timeout: 10000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) throw new Error('Not an image');
    return res.buffer();
}

async function piesCommand(sock, chatId, message, args) {
    const input = Array.isArray(args) ? args.join(' ') : (args || '');

    if (!input.trim()) {
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🗽  *C Y B E R  X  PIES*   ║',
                '╚════════════════════════════╝',
                '',
                '❌ *No country provided!*',
                '',
                '┌─────────────────────────────',
                '│ 📌 *Usage:*',
                '│  `.pies <any country>`',
                '└─────────────────────────────',
                '',
                '🔥 *Examples:*',
                '  `.pies nigeria`',
                '  `.pies united states`',
                '  `.pies south africa`',
                '  `.pies japan`',
                '  `.pies brazil`',
                '',
                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *Any country in the world*'
            ].join('\n')
        }, { quoted: message });
        return;
    }

    // React 🗽
    await sock.sendMessage(chatId, { react: { text: '🗽', key: message.key } });

    const countrySlug = resolveCountry(input);
    const displayName = input.trim()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

    try {
        const imgBuf = await fetchPiesImage(countrySlug);
        await sock.sendMessage(chatId, {
            image: imgBuf,
            caption: [
                `🗽 *${displayName}*`,
                '',
                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
            ].join('\n'),
            mimetype: 'image/jpeg'
        }, { quoted: message });
    } catch (err) {
        console.error('[CYBER X] pies error:', err.message);
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🗽  *C Y B E R  X  PIES*   ║',
                '╚════════════════════════════╝',
                '',
                `❌ *Could not find image for:* _"${displayName}"_`,
                '',
                '💡 Try a different spelling or country name',
                '',
                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
            ].join('\n')
        }, { quoted: message });
    }
}

module.exports = { piesCommand };
