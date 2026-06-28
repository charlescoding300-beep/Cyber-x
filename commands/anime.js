const axios = require('axios');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — ANIME REACTION COMMAND
//  Usage: .anime <reaction>   (reply to someone OR solo)
//  Anyone can use | Category: Fun
//  6-API fallback chain (fastest first):
//    1. otakugifs.xyz
//    2. waifu.pics
//    3. gifukai.com
//    4. some-random-api.com
//    5. nekos.best
//    6. nekos.fun
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REACTIONS = {
    // ── ❤️  AFFECTION ──────────────────────────────────────────
    hug:       { emoji: '🤗', text: (a, b) => `${a} hugged ${b}` },
    kiss:      { emoji: '💋', text: (a, b) => `${a} kissed ${b}` },
    cuddle:    { emoji: '🥰', text: (a, b) => `${a} cuddled ${b}` },
    pat:       { emoji: '🫶', text: (a, b) => `${a} patted ${b}` },
    handhold:  { emoji: '🤝', text: (a, b) => `${a} held hands with ${b}` },
    handshake: { emoji: '🫱', text: (a, b) => `${a} shook hands with ${b}` },
    blowkiss:  { emoji: '💨💋', text: (a, b) => `${a} blew a kiss at ${b}` },
    peck:      { emoji: '😚', text: (a, b) => `${a} gave ${b} a peck` },
    carry:     { emoji: '🫂', text: (a, b) => `${a} is carrying ${b}` },
    feed:      { emoji: '🍱', text: (a, b) => `${a} fed ${b}` },
    lappillow: { emoji: '🛋️',  text: (a, b) => `${a} gave ${b} a lap pillow` },
    kabedon:   { emoji: '🧱', text: (a, b) => `${a} kabedon'd ${b}` },

    // ── 🥊  AGGRESSION ─────────────────────────────────────────
    slap:      { emoji: '🫲🏻', text: (a, b) => `${a} slapped ${b}` },
    kick:      { emoji: '🦵🏻', text: (a, b) => `${a} kicked ${b}` },
    punch:     { emoji: '👊',   text: (a, b) => `${a} punched ${b}` },
    bite:      { emoji: '😬',   text: (a, b) => `${a} bit ${b}` },
    bonk:      { emoji: '🔨',   text: (a, b) => `${a} bonked ${b}` },
    yeet:      { emoji: '🚀',   text: (a, b) => `${a} yeeted ${b}` },
    baka:      { emoji: '😤',   text: (a, b) => `${a} called ${b} a baka!` },
    shoot:     { emoji: '🔫',   text: (a, b) => `${a} shot at ${b}` },
    tickle:    { emoji: '🤣',   text: (a, b) => `${a} tickled ${b}` },
    poke:      { emoji: '👉',   text: (a, b) => `${a} poked ${b}` },

    // ── 😂  REACTIONS ──────────────────────────────────────────
    cry:       { emoji: '😢', text: (a, b) => `${a} is crying` },
    laugh:     { emoji: '😂', text: (a, b) => `${a} is laughing` },
    blush:     { emoji: '😳', text: (a, b) => `${a} is blushing` },
    smile:     { emoji: '😊', text: (a, b) => `${a} smiled at ${b}` },
    wink:      { emoji: '😉', text: (a, b) => `${a} winked at ${b}` },
    smug:      { emoji: '😏', text: (a, b) => `${a} is being smug` },
    pout:      { emoji: '😤', text: (a, b) => `${a} is pouting` },
    angry:     { emoji: '😡', text: (a, b) => `${a} is angry at ${b}` },
    shocked:   { emoji: '😱', text: (a, b) => `${a} is shocked` },
    confused:  { emoji: '😕', text: (a, b) => `${a} is confused` },
    happy:     { emoji: '😄', text: (a, b) => `${a} is happy` },
    sad:       { emoji: '😔', text: (a, b) => `${a} is sad` },
    bored:     { emoji: '😒', text: (a, b) => `${a} is bored` },
    teehee:    { emoji: '🙈', text: (a, b) => `${a} is being cheeky` },
    bleh:      { emoji: '😛', text: (a, b) => `${a} goes bleh at ${b}` },
    nya:       { emoji: '🐱', text: (a, b) => `${a} says nyaa~` },

    // ── 🕺  ACTIONS ────────────────────────────────────────────
    dance:     { emoji: '💃', text: (a, b) => `${a} is dancing` },
    spin:      { emoji: '🌀', text: (a, b) => `${a} is spinning` },
    run:       { emoji: '🏃', text: (a, b) => `${a} ran away` },
    wave:      { emoji: '👋', text: (a, b) => `${a} waved at ${b}` },
    clap:      { emoji: '👏', text: (a, b) => `${a} clapped at ${b}` },
    highfive:  { emoji: '🙏', text: (a, b) => `${a} high-fived ${b}` },
    salute:    { emoji: '🫡', text: (a, b) => `${a} saluted ${b}` },
    thumbsup:  { emoji: '👍', text: (a, b) => `${a} gave ${b} a thumbs up` },
    nod:       { emoji: '🙂', text: (a, b) => `${a} nodded at ${b}` },
    nope:      { emoji: '🙅', text: (a, b) => `${a} said nope` },
    shrug:     { emoji: '🤷', text: (a, b) => `${a} shrugged` },
    stare:     { emoji: '👀', text: (a, b) => `${a} stared at ${b}` },
    lick:      { emoji: '👅', text: (a, b) => `${a} licked ${b}` },
    nom:       { emoji: '😋', text: (a, b) => `${a} is nomming` },
    sip:       { emoji: '🍵', text: (a, b) => `${a} is sipping tea` },
    lurk:      { emoji: '👁️',  text: (a, b) => `${a} is lurking` },
    wag:       { emoji: '🐾', text: (a, b) => `${a} is wagging their tail` },
    shake:     { emoji: '🤝', text: (a, b) => `${a} shook ${b}` },
    tableflip: { emoji: '(╯°□°）╯︵ ┻━┻', text: (a, b) => `${a} flipped the table` },

    // ── 💤  CHILL ──────────────────────────────────────────────
    sleep:     { emoji: '😴', text: (a, b) => `${a} fell asleep` },
    yawn:      { emoji: '🥱', text: (a, b) => `${a} yawned` },
    think:     { emoji: '🤔', text: (a, b) => `${a} is thinking` },
    facepalm:  { emoji: '🤦', text: (a, b) => `${a} facepalmed` },
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API FETCHERS — each returns a .gif URL or throws
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── API 1: otakugifs.xyz ──────────────────────────────────────
// endpoint: GET https://api.otakugifs.xyz/gif?reaction=<action>&format=gif
// supported: kiss,hug,pat,slap,kick,punch,bite,poke,cry,laugh,blush,
//            smile,wink,smug,pout,angry,shocked,happy,sad,dance,wave,
//            clap,stare,shrug,tickle,baka,nom,wag
const OTAKU_SUPPORTED = new Set([
    'kiss','hug','pat','slap','kick','punch','bite','poke','cry','laugh',
    'blush','smile','wink','smug','pout','angry','shocked','happy','sad',
    'dance','wave','clap','stare','shrug','tickle','baka','nom','wag',
])
async function fromOtakuGifs(action) {
    if (!OTAKU_SUPPORTED.has(action)) throw new Error('unsupported')
    const res = await axios.get(
        `https://api.otakugifs.xyz/gif?reaction=${action}&format=gif`,
        { timeout: 5000 }
    )
    const url = res.data?.url
    if (!url) throw new Error('no url')
    return url
}

// ── API 2: waifu.pics ─────────────────────────────────────────
// endpoint: GET https://api.waifu.pics/sfw/<action>
// supported: hug,kiss,pat,slap,kick,punch,bite,poke,cry,laugh,blush,
//            smile,wink,smug,pout,dance,wave,highfive,nom,cuddle,
//            handhold,feed,shrug,stare,baka,bonk,lick,wag,yeet,
//            sleep,shoot
const WAIFU_SUPPORTED = new Set([
    'hug','kiss','pat','slap','kick','punch','bite','poke','cry','laugh',
    'blush','smile','wink','smug','pout','dance','wave','highfive','nom',
    'cuddle','handhold','feed','shrug','stare','baka','bonk','lick','wag',
    'yeet','sleep','shoot',
])
async function fromWaifuPics(action) {
    if (!WAIFU_SUPPORTED.has(action)) throw new Error('unsupported')
    const res = await axios.get(
        `https://api.waifu.pics/sfw/${action}`,
        { timeout: 5000 }
    )
    const url = res.data?.url
    if (!url) throw new Error('no url')
    return url
}

// ── API 3: gifukai.com ────────────────────────────────────────
// endpoint: GET https://api.gifukai.com/gif?action=<action>
// supported: hug,kiss,pat,poke,cry,wink,cuddle,handhold,wave,
//            blush,smile,nom,dance,slap,kick,punch,bite,bonk
const GIFUKAI_SUPPORTED = new Set([
    'hug','kiss','pat','poke','cry','wink','cuddle','handhold','wave',
    'blush','smile','nom','dance','slap','kick','punch','bite','bonk',
])
async function fromGifukai(action) {
    if (!GIFUKAI_SUPPORTED.has(action)) throw new Error('unsupported')
    const res = await axios.get(
        `https://api.gifukai.com/gif?action=${action}`,
        { timeout: 5000 }
    )
    const url = res.data?.url
    if (!url) throw new Error('no url')
    return url
}

// ── API 4: some-random-api.com ───────────────────────────────
// endpoint: GET https://some-random-api.com/animu/<action>
// supported: hug,kiss,pat,poke,cry,wink,nom,face-palm
const SRA_MAP = {
    hug: 'hug', kiss: 'kiss', pat: 'pat', poke: 'poke',
    cry: 'cry', wink: 'wink', nom: 'nom', facepalm: 'face-palm',
}
async function fromSomeRandomApi(action) {
    const mapped = SRA_MAP[action]
    if (!mapped) throw new Error('unsupported')
    const res = await axios.get(
        `https://some-random-api.com/animu/${mapped}`,
        { timeout: 5000 }
    )
    const url = res.data?.link
    if (!url) throw new Error('no url')
    return url
}

// ── API 5: nekos.best ─────────────────────────────────────────
// endpoint: GET https://nekos.best/api/v2/<action>
// supported: hug,kiss,pat,poke,cry,laugh,blush,smile,wink,smug,
//            pout,angry,happy,sad,dance,wave,clap,stare,shrug,
//            tickle,baka,nom,cuddle,handhold,feed,lick,wag,
//            yeet,sleep,yawn,think,kick,punch,bite,bonk,shoot,
//            salute,nod,highfive,blowkiss,spin
const NEKOS_SUPPORTED = new Set([
    'hug','kiss','pat','poke','cry','laugh','blush','smile','wink','smug',
    'pout','angry','happy','sad','dance','wave','clap','stare','shrug',
    'tickle','baka','nom','cuddle','handhold','feed','lick','wag',
    'yeet','sleep','yawn','think','kick','punch','bite','bonk','shoot',
    'salute','nod','highfive','blowkiss','spin',
])
async function fromNekosBest(action) {
    if (!NEKOS_SUPPORTED.has(action)) throw new Error('unsupported')
    const res = await axios.get(
        `https://nekos.best/api/v2/${action}`,
        { timeout: 5000 }
    )
    const url = res.data?.results?.[0]?.url
    if (!url) throw new Error('no url')
    return url
}

// ── API 6: nekos.fun ─────────────────────────────────────────
// endpoint: GET https://nekos.fun/api/<action>
// supported: hug,kiss,pat,poke,cry,laugh,blush,smile,wink,smug,
//            pout,angry,dance,wave,stare,tickle,baka,nom,cuddle,
//            lick,sleep,slap,kick,punch,bite,bonk,yeet,shoot
const NEKOSFUN_SUPPORTED = new Set([
    'hug','kiss','pat','poke','cry','laugh','blush','smile','wink','smug',
    'pout','angry','dance','wave','stare','tickle','baka','nom','cuddle',
    'lick','sleep','slap','kick','punch','bite','bonk','yeet','shoot',
])
async function fromNekosFun(action) {
    if (!NEKOSFUN_SUPPORTED.has(action)) throw new Error('unsupported')
    const res = await axios.get(
        `https://nekos.fun/api/${action}`,
        { timeout: 5000 }
    )
    const url = res.data?.image
    if (!url) throw new Error('no url')
    return url
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FALLBACK CHAIN — tries all 6 APIs in order, returns first
//  working URL. All run with a 5s timeout each so it's fast.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function getGifUrl(action) {
    const chain = [
        () => fromOtakuGifs(action),
        () => fromWaifuPics(action),
        () => fromGifukai(action),
        () => fromSomeRandomApi(action),
        () => fromNekosBest(action),
        () => fromNekosFun(action),
    ]
    for (const fetcher of chain) {
        try {
            const url = await fetcher()
            if (url) return url
        } catch {}
    }
    return null
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HELP TEXT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildHelp() {
    const groups = {
        '❤️  Affection':  ['hug','kiss','cuddle','pat','handhold','handshake','blowkiss','peck','carry','feed','lappillow','kabedon'],
        '🥊  Aggression': ['slap','kick','punch','bite','bonk','yeet','baka','shoot','tickle','poke'],
        '😂  Reactions':  ['cry','laugh','blush','smile','wink','smug','pout','angry','shocked','confused','happy','sad','bored','teehee','bleh','nya'],
        '🕺  Actions':    ['dance','spin','run','wave','clap','highfive','salute','thumbsup','nod','nope','shrug','stare','lick','nom','sip','lurk','wag','shake','tableflip'],
        '💤  Chill':      ['sleep','yawn','think','facepalm'],
    }
    const lines = [
        '╔══════════════════════════════════════╗',
        '║  🎌  *C Y B E R  X  —  A N I M E*   ║',
        '╚══════════════════════════════════════╝',
        '',
        '📌 *Usage:*',
        '  `.anime <action>`',
        '  Reply to someone first for best effect!',
        '',
    ]
    for (const [cat, cmds] of Object.entries(groups)) {
        lines.push(`*${cat}*`)
        lines.push(cmds.map(c => `\`${c}\``).join('  '))
        lines.push('')
    }
    lines.push('🔥 *Examples:*')
    lines.push('  `.anime hug`  `.anime bonk`  `.anime kabedon`')
    lines.push('')
    lines.push('> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™')
    return lines.join('\n')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
module.exports = {
    pattern:  'anime',
    alias:    ['reaction'],
    desc:     'Send anime reaction GIFs',
    usage:    '.anime <reaction>  (reply to someone for best effect)',
    category: 'fun',

    async run({ sock, from, msg, args }) {
        const action   = (args[0] || '').toLowerCase().trim()
        const reaction = REACTIONS[action]

        // ── No action → categorised help ──────────────────────
        if (!action) {
            await sock.sendMessage(from, { text: buildHelp() }, { quoted: msg })
            return
        }

        // ── Unknown action ─────────────────────────────────────
        if (!reaction) {
            const all = Object.keys(REACTIONS).join(', ')
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
            }, { quoted: msg })
            return
        }

        // ── Detect sender & target ─────────────────────────────
        const senderJid = msg.key.participant || msg.key.remoteJid
        const senderTag = `@${senderJid.split('@')[0]}`

        const quoted    = msg.message?.extendedTextMessage?.contextInfo
        const targetJid = quoted?.participant || quoted?.remoteJid || null
        const targetTag = targetJid ? `@${targetJid.split('@')[0]}` : null

        const actionText = reaction.text(senderTag, targetTag || 'the air 🌬️')

        // ── Emoji react ────────────────────────────────────────
        await sock.sendMessage(from, { react: { text: reaction.emoji, key: msg.key } })

        // ── Fetch GIF from 6-API fallback chain ───────────────
        const gifUrl = await getGifUrl(action)

        // ── Mentions ───────────────────────────────────────────
        const mentions = [senderJid]
        if (targetJid) mentions.push(targetJid)

        // ── Caption (text attached to the GIF) ────────────────
        const caption = [
            `${reaction.emoji} *${actionText}*`,
            '',
            '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™',
        ].join('\n')

        // ── No GIF found from any API → send text only ─────────
        if (!gifUrl) {
            await sock.sendMessage(from, {
                text: caption + '\n\n_(GIF unavailable)_',
                mentions,
            }, { quoted: msg })
            return
        }

        // ── Send GIF with caption text attached ────────────────
        try {
            await sock.sendMessage(from, {
                video:       { url: gifUrl },
                caption,
                gifPlayback: true,
                mentions,
            }, { quoted: msg })
        } catch (err) {
            console.error('[CYBER X] anime gif error:', err.message)
            // Last resort — send caption as plain text
            await sock.sendMessage(from, {
                text: caption + '\n\n_(Could not load GIF)_',
                mentions,
            }, { quoted: msg })
        }
    },
}
