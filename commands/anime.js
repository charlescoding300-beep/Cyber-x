const axios = require('axios');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — ANIME REACTION COMMAND
//  Usage: .anime <reaction>   (reply to someone OR solo)
//  Anyone can use | Category: Fun
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REACTIONS = {
    // ── ❤️  AFFECTION ──────────────────────────────────────────
    hug:       { emoji: '🤗', text: (a, b) => `${a} hugged ${b}`,             api: 'nekos' },
    kiss:      { emoji: '💋', text: (a, b) => `${a} kissed ${b}`,             api: 'nekos' },
    cuddle:    { emoji: '🥰', text: (a, b) => `${a} cuddled ${b}`,            api: 'nekos' },
    pat:       { emoji: '🫶', text: (a, b) => `${a} patted ${b}`,             api: 'nekos' },
    handhold:  { emoji: '🤝', text: (a, b) => `${a} held hands with ${b}`,    api: 'nekos' },
    handshake: { emoji: '🫱', text: (a, b) => `${a} shook hands with ${b}`,   api: 'nekos' },
    blowkiss:  { emoji: '💨💋', text: (a, b) => `${a} blew a kiss at ${b}`,   api: 'nekos' },
    peck:      { emoji: '😚', text: (a, b) => `${a} gave ${b} a peck`,        api: 'nekos' },
    carry:     { emoji: '🫂', text: (a, b) => `${a} is carrying ${b}`,        api: 'nekos' },
    feed:      { emoji: '🍱', text: (a, b) => `${a} fed ${b}`,                api: 'nekos' },
    lappillow: { emoji: '🛋️',  text: (a, b) => `${a} gave ${b} a lap pillow`, api: 'nekos' },
    kabedon:   { emoji: '🧱', text: (a, b) => `${a} kabedon'd ${b}`,          api: 'nekos' },

    // ── 🥊  AGGRESSION ─────────────────────────────────────────
    slap:      { emoji: '🫲🏻', text: (a, b) => `${a} slapped ${b}`,          api: 'nekos' },
    kick:      { emoji: '🦵🏻', text: (a, b) => `${a} kicked ${b}`,           api: 'nekos' },
    punch:     { emoji: '👊',   text: (a, b) => `${a} punched ${b}`,          api: 'nekos' },
    bite:      { emoji: '😬',   text: (a, b) => `${a} bit ${b}`,              api: 'nekos' },
    bonk:      { emoji: '🔨',   text: (a, b) => `${a} bonked ${b}`,           api: 'nekos' },
    yeet:      { emoji: '🚀',   text: (a, b) => `${a} yeeted ${b}`,           api: 'nekos' },
    baka:      { emoji: '😤',   text: (a, b) => `${a} called ${b} a baka!`,   api: 'nekos' },
    shoot:     { emoji: '🔫',   text: (a, b) => `${a} shot at ${b}`,          api: 'nekos' },
    tickle:    { emoji: '🤣',   text: (a, b) => `${a} tickled ${b}`,          api: 'nekos' },
    poke:      { emoji: '👉',   text: (a, b) => `${a} poked ${b}`,            api: 'nekos' },

    // ── 😂  REACTIONS ──────────────────────────────────────────
    cry:       { emoji: '😢', text: (a, b) => `${a} is crying`,               api: 'nekos' },
    laugh:     { emoji: '😂', text: (a, b) => `${a} is laughing`,             api: 'nekos' },
    blush:     { emoji: '😳', text: (a, b) => `${a} is blushing`,             api: 'nekos' },
    smile:     { emoji: '😊', text: (a, b) => `${a} smiled at ${b}`,          api: 'nekos' },
    wink:      { emoji: '😉', text: (a, b) => `${a} winked at ${b}`,          api: 'nekos' },
    smug:      { emoji: '😏', text: (a, b) => `${a} is being smug`,           api: 'nekos' },
    pout:      { emoji: '😤', text: (a, b) => `${a} is pouting`,              api: 'nekos' },
    angry:     { emoji: '😡', text: (a, b) => `${a} is angry at ${b}`,        api: 'nekos' },
    shocked:   { emoji: '😱', text: (a, b) => `${a} is shocked`,              api: 'nekos' },
    confused:  { emoji: '😕', text: (a, b) => `${a} is confused`,             api: 'nekos' },
    happy:     { emoji: '😄', text: (a, b) => `${a} is happy`,                api: 'nekos' },
    sad:       { emoji: '😔', text: (a, b) => `${a} is sad`,                  api: 'nekos' },
    bored:     { emoji: '😒', text: (a, b) => `${a} is bored`,                api: 'nekos' },
    teehee:    { emoji: '🙈', text: (a, b) => `${a} is being cheeky`,         api: 'nekos' },
    bleh:      { emoji: '😛', text: (a, b) => `${a} goes bleh at ${b}`,       api: 'nekos' },
    nya:       { emoji: '🐱', text: (a, b) => `${a} says nyaa~`,              api: 'nekos' },

    // ── 🕺  ACTIONS ────────────────────────────────────────────
    dance:     { emoji: '💃', text: (a, b) => `${a} is dancing`,              api: 'nekos' },
    spin:      { emoji: '🌀', text: (a, b) => `${a} is spinning`,             api: 'nekos' },
    run:       { emoji: '🏃', text: (a, b) => `${a} ran away`,                api: 'nekos' },
    wave:      { emoji: '👋', text: (a, b) => `${a} waved at ${b}`,           api: 'nekos' },
    clap:      { emoji: '👏', text: (a, b) => `${a} clapped at ${b}`,         api: 'nekos' },
    highfive:  { emoji: '🙏', text: (a, b) => `${a} high-fived ${b}`,         api: 'nekos' },
    salute:    { emoji: '🫡', text: (a, b) => `${a} saluted ${b}`,            api: 'nekos' },
    thumbsup:  { emoji: '👍', text: (a, b) => `${a} gave ${b} a thumbs up`,   api: 'nekos' },
    nod:       { emoji: '🙂', text: (a, b) => `${a} nodded at ${b}`,          api: 'nekos' },
    nope:      { emoji: '🙅', text: (a, b) => `${a} said nope`,               api: 'nekos' },
    shrug:     { emoji: '🤷', text: (a, b) => `${a} shrugged`,                api: 'nekos' },
    stare:     { emoji: '👀', text: (a, b) => `${a} stared at ${b}`,          api: 'nekos' },
    lick:      { emoji: '👅', text: (a, b) => `${a} licked ${b}`,             api: 'nekos' },
    nom:       { emoji: '😋', text: (a, b) => `${a} is nomming`,              api: 'animu'  },
    sip:       { emoji: '🍵', text: (a, b) => `${a} is sipping tea`,          api: 'nekos' },
    lurk:      { emoji: '👁️',  text: (a, b) => `${a} is lurking`,             api: 'nekos' },
    wag:       { emoji: '🐾', text: (a, b) => `${a} is wagging their tail`,   api: 'nekos' },
    shake:     { emoji: '🤝', text: (a, b) => `${a} shook ${b}`,              api: 'nekos' },
    tableflip: { emoji: '(╯°□°）╯︵ ┻━┻', text: (a, b) => `${a} flipped the table`, api: 'nekos' },

    // ── 💤  CHILL ──────────────────────────────────────────────
    sleep:     { emoji: '😴', text: (a, b) => `${a} fell asleep`,             api: 'nekos' },
    yawn:      { emoji: '🥱', text: (a, b) => `${a} yawned`,                  api: 'nekos' },
    think:     { emoji: '🤔', text: (a, b) => `${a} is thinking`,             api: 'nekos' },
    facepalm:  { emoji: '🤦', text: (a, b) => `${a} facepalmed`,              api: 'nekos' },

    // ── 🎌  ANIMU EXCLUSIVES (SRA only) ───────────────────────
    'face-palm': { emoji: '🤦', text: (a, b) => `${a} facepalmed`,            api: 'animu' },
};

// ── GIF FETCHERS ─────────────────────────────────────────────
async function fetchFromNekos(type) {
    const res = await axios.get(`https://nekos.best/api/v2/${type}`, { timeout: 10000 });
    return res.data?.results?.[0]?.url || null;
}

async function fetchFromAnimu(type) {
    const res = await axios.get(`https://api.some-random-api.com/animu/${type}`, { timeout: 10000 });
    return res.data?.link || null;
}

const ANIMU_EQUIVALENTS = new Set(['hug', 'kiss', 'pat', 'poke', 'cry', 'wink', 'nom']);

async function getGifUrl(action, apiType) {
    try {
        if (apiType === 'nekos') return await fetchFromNekos(action);
        if (apiType === 'animu') return await fetchFromAnimu(action === 'facepalm' ? 'face-palm' : action);
    } catch {}
    // Cross-fallback
    try {
        if (apiType === 'nekos' && ANIMU_EQUIVALENTS.has(action)) return await fetchFromAnimu(action);
        if (apiType === 'animu') return await fetchFromNekos(action);
    } catch {}
    return null;
}

// ── HELP TEXT ─────────────────────────────────────────────────
function buildHelp() {
    const groups = {
        '❤️  Affection':  ['hug','kiss','cuddle','pat','handhold','handshake','blowkiss','peck','carry','feed','lappillow','kabedon'],
        '🥊  Aggression': ['slap','kick','punch','bite','bonk','yeet','baka','shoot','tickle','poke'],
        '😂  Reactions':  ['cry','laugh','blush','smile','wink','smug','pout','angry','shocked','confused','happy','sad','bored','teehee','bleh','nya'],
        '🕺  Actions':    ['dance','spin','run','wave','clap','highfive','salute','thumbsup','nod','nope','shrug','stare','lick','nom','sip','lurk','wag','shake','tableflip'],
        '💤  Chill':      ['sleep','yawn','think','facepalm'],
    };
    const lines = [
        '╔══════════════════════════════════════╗',
        '║  🎌  *C Y B E R  X  —  A N I M E*   ║',
        '╚══════════════════════════════════════╝',
        '',
        '📌 *Usage:*',
        '  `.anime <action>`',
        '  Reply to someone first for best effect!',
        '',
    ];
    for (const [cat, cmds] of Object.entries(groups)) {
        lines.push(`*${cat}*`);
        lines.push(cmds.map(c => `\`${c}\``).join('  '));
        lines.push('');
    }
    lines.push('🔥 *Examples:*');
    lines.push('  `.anime hug`  `.anime bonk`  `.anime kabedon`');
    lines.push('');
    lines.push('> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™');
    return lines.join('\n');
}

// ── MAIN COMMAND ─────────────────────────────────────────────
module.exports = {
    pattern:  'anime',
    alias:    ['reaction'],
    desc:     'Send anime reaction GIFs',
    usage:    '.anime <reaction>  (reply to someone for best effect)',
    category: 'fun',

    async run({ sock, from, msg, args }) {
        const action   = (args[0] || '').toLowerCase().trim();
        const reaction = REACTIONS[action];

        // ── No action → categorised help ──
        if (!action) {
            await sock.sendMessage(from, { text: buildHelp() }, { quoted: msg });
            return;
        }

        // ── Unknown action ──
        if (!reaction) {
            const all = Object.keys(REACTIONS).join(', ');
            await sock.sendMessage(from, {
                text: [
                    '╔══════════════════════════════════════╗',
                    '║  🎌  *C Y B E R  X  —  A N I M E*   ║',
                    '╚══════════════════════════════════════╝',
                    '',
                    `❌ *Unknown reaction:* _"${action}"_`,
                    '',
                    `🎯 *Available:*\n${all}`,
                    '',
                    '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
                ].join('\n'),
            }, { quoted: msg });
            return;
        }

        // ── Detect sender & target ──
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const senderTag = `@${senderJid.split('@')[0]}`;

        const quoted    = msg.message?.extendedTextMessage?.contextInfo;
        const targetJid = quoted?.participant || quoted?.remoteJid || null;
        const targetTag = targetJid ? `@${targetJid.split('@')[0]}` : null;

        const actionText = reaction.text(senderTag, targetTag || 'the air 🌬️');

        // ── Emoji react ──
        await sock.sendMessage(from, { react: { text: reaction.emoji, key: msg.key } });

        // ── Fetch GIF URL ──
        const gifUrl = await getGifUrl(action, reaction.api);

        // ── Mentions ──
        const mentions = [senderJid];
        if (targetJid) mentions.push(targetJid);

        // ── Caption ──
        const caption = [
            `${reaction.emoji} *${actionText}*`,
            '',
            '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
        ].join('\n');

        if (!gifUrl) {
            await sock.sendMessage(from, {
                text: caption + '\n\n_(GIF unavailable)_',
                mentions,
            }, { quoted: msg });
            return;
        }

        // ── Send as GIF ──
        try {
            await sock.sendMessage(from, {
                video:       { url: gifUrl },
                caption,
                gifPlayback: true,
                mentions,
            }, { quoted: msg });
        } catch (err) {
            console.error('[CYBER X] anime gif error:', err.message);
            await sock.sendMessage(from, {
                text: caption + '\n\n_(Could not load GIF)_',
                mentions,
            }, { quoted: msg });
        }
    },
};
