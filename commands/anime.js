const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const webp = require('node-webpmux');
const crypto = require('crypto');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — ANIME REACTION COMMAND
//  Usage: .anime <reaction>   (reply to someone OR solo)
//  Anyone can use | Category: General
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REACTIONS = {
    // ── some-random-api.com/animu ──
    hug:         { emoji: '🤗', text: (a, b) => `${a} hugged ${b}`,        api: 'animu' },
    kiss:        { emoji: '💋', text: (a, b) => `${a} kissed ${b}`,        api: 'animu' },
    pat:         { emoji: '🫶', text: (a, b) => `${a} patted ${b}`,        api: 'animu' },
    poke:        { emoji: '👉', text: (a, b) => `${a} poked ${b}`,         api: 'animu' },
    cry:         { emoji: '😢', text: (a, b) => `${a} is crying`,          api: 'animu' },
    wink:        { emoji: '😉', text: (a, b) => `${a} winked at ${b}`,     api: 'animu' },
    nom:         { emoji: '😋', text: (a, b) => `${a} is nomming`,         api: 'animu' },
    'face-palm': { emoji: '🤦', text: (a, b) => `${a} facepalmed`,         api: 'animu' },

    // ── nekos.best ──
    kick:        { emoji: '🦵🏻', text: (a, b) => `${a} kicked ${b}`,      api: 'nekos' },
    slap:        { emoji: '🫲🏻', text: (a, b) => `${a} slapped ${b}`,     api: 'nekos' },
    punch:       { emoji: '👊',  text: (a, b) => `${a} punched ${b}`,      api: 'nekos' },
    bite:        { emoji: '😬',  text: (a, b) => `${a} bit ${b}`,          api: 'nekos' },
    blush:       { emoji: '😳',  text: (a, b) => `${a} is blushing`,       api: 'nekos' },
    bored:       { emoji: '😒',  text: (a, b) => `${a} is bored`,          api: 'nekos' },
    cuddle:      { emoji: '🥰',  text: (a, b) => `${a} cuddled ${b}`,      api: 'nekos' },
    dance:       { emoji: '💃',  text: (a, b) => `${a} is dancing`,        api: 'nekos' },
    facepalm:    { emoji: '🤦',  text: (a, b) => `${a} facepalmed`,        api: 'nekos' },
    feed:        { emoji: '🍱',  text: (a, b) => `${a} fed ${b}`,          api: 'nekos' },
    handhold:    { emoji: '🤝',  text: (a, b) => `${a} held hands with ${b}`, api: 'nekos' },
    happy:       { emoji: '😄',  text: (a, b) => `${a} is happy`,          api: 'nekos' },
    highfive:    { emoji: '🙏',  text: (a, b) => `${a} high-fived ${b}`,   api: 'nekos' },
    laugh:       { emoji: '😂',  text: (a, b) => `${a} is laughing`,       api: 'nekos' },
    lick:        { emoji: '👅',  text: (a, b) => `${a} licked ${b}`,       api: 'nekos' },
    nod:         { emoji: '🙂',  text: (a, b) => `${a} nodded at ${b}`,    api: 'nekos' },
    nope:        { emoji: '🙅',  text: (a, b) => `${a} said nope`,         api: 'nekos' },
    pout:        { emoji: '😤',  text: (a, b) => `${a} is pouting`,        api: 'nekos' },
    run:         { emoji: '🏃',  text: (a, b) => `${a} ran away`,          api: 'nekos' },
    sad:         { emoji: '😔',  text: (a, b) => `${a} is sad`,            api: 'nekos' },
    shrug:       { emoji: '🤷',  text: (a, b) => `${a} shrugged`,          api: 'nekos' },
    sleep:       { emoji: '😴',  text: (a, b) => `${a} fell asleep`,       api: 'nekos' },
    smile:       { emoji: '😊',  text: (a, b) => `${a} smiled at ${b}`,    api: 'nekos' },
    smug:        { emoji: '😏',  text: (a, b) => `${a} is smug`,           api: 'nekos' },
    stare:       { emoji: '👀',  text: (a, b) => `${a} stared at ${b}`,    api: 'nekos' },
    think:       { emoji: '🤔',  text: (a, b) => `${a} is thinking`,       api: 'nekos' },
    thumbsup:    { emoji: '👍',  text: (a, b) => `${a} gave ${b} a thumbs up`, api: 'nekos' },
    tickle:      { emoji: '🤣',  text: (a, b) => `${a} tickled ${b}`,      api: 'nekos' },
    wave:        { emoji: '👋',  text: (a, b) => `${a} waved at ${b}`,     api: 'nekos' },
    yawn:        { emoji: '🥱',  text: (a, b) => `${a} yawned`,            api: 'nekos' },
};

// ── GIF FETCHERS ─────────────────────────────────────────────
async function fetchFromAnimu(type) {
    const res = await axios.get(`https://api.some-random-api.com/animu/${type}`, { timeout: 10000 });
    return res.data?.link || null;
}

async function fetchFromNekos(type) {
    const res = await axios.get(`https://nekos.best/api/v2/${type}`, { timeout: 10000 });
    return res.data?.results?.[0]?.url || null;
}

async function getGifUrl(action, apiType) {
    try {
        if (apiType === 'animu') return await fetchFromAnimu(action === 'facepalm' ? 'face-palm' : action);
        if (apiType === 'nekos') return await fetchFromNekos(action);
    } catch {}
    try {
        if (apiType === 'animu') return await fetchFromNekos(action);
        if (apiType === 'nekos') return await fetchFromAnimu(action === 'facepalm' ? 'face-palm' : action);
    } catch {}
    return null;
}

// ── GIF → ANIMATED STICKER ───────────────────────────────────
async function convertToSticker(mediaBuffer, isAnimated) {
    const tmpDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const ext    = isAnimated ? 'gif' : 'jpg';
    const input  = path.join(tmpDir, `anime_${Date.now()}.${ext}`);
    const output = path.join(tmpDir, `anime_${Date.now()}.webp`);
    fs.writeFileSync(input, mediaBuffer);

    const cmd = isAnimated
        ? `ffmpeg -y -i "${input}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,fps=15" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 60 -compression_level 6 "${output}"`
        : `ffmpeg -y -i "${input}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${output}"`;

    await new Promise((res, rej) => exec(cmd, e => e ? rej(e) : res()));

    const buf = fs.readFileSync(output);
    const img = new webp.Image();
    await img.load(buf);

    const json = {
        'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
        'sticker-pack-name': 'CYBER X Anime',
        'emojis': ['🎌']
    };
    const exifAttr = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
    const jsonBuf  = Buffer.from(JSON.stringify(json), 'utf8');
    const exif     = Buffer.concat([exifAttr, jsonBuf]);
    exif.writeUIntLE(jsonBuf.length, 14, 4);
    img.exif = exif;

    const final = await img.save(null);
    try { fs.unlinkSync(input); } catch {}
    try { fs.unlinkSync(output); } catch {}
    return final;
}

// ── MAIN COMMAND ─────────────────────────────────────────────
async function animeCommand(sock, chatId, message, args) {
    const action   = ((Array.isArray(args) ? args[0] : args) || '').toLowerCase().trim();
    const reaction = REACTIONS[action];
    const allActions = Object.keys(REACTIONS).join(', ');

    // ── No action ──
    if (!action) {
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🎌  *C Y B E R  X  ANIME*  ║',
                '╚════════════════════════════╝',
                '',
                '❌ *No reaction provided!*',
                '',
                '┌─────────────────────────────',
                '│ 📌 *Usage:*',
                '│  Reply to someone + `.anime <action>`',
                '│  OR just `.anime <action>`',
                '└─────────────────────────────',
                '',
                `🎯 *Available:*\n${allActions}`,
                '',
                '🔥 *Examples:*',
                '  `.anime kick`',
                '  `.anime hug`',
                '  `.anime slap`',
                '',
                '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
            ].join('\n')
        }, { quoted: message });
        return;
    }

    // ── Unknown action ──
    if (!reaction) {
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🎌  *C Y B E R  X  ANIME*  ║',
                '╚════════════════════════════╝',
                '',
                `❌ *Unknown reaction:* _"${action}"_`,
                '',
                `🎯 *Try one of:*\n${allActions}`,
                '',
                '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
            ].join('\n')
        }, { quoted: message });
        return;
    }

    // ── Detect sender & target ──
    const senderJid = message.key.participant || message.key.remoteJid;
    const senderTag = `@${senderJid.split('@')[0]}`;

    const quoted    = message.message?.extendedTextMessage?.contextInfo;
    const targetJid = quoted?.participant || quoted?.remoteJid || null;
    const targetTag = targetJid ? `@${targetJid.split('@')[0]}` : null;

    const actionText = reaction.text(senderTag, targetTag || 'the air 🌬️');

    // ── React with emoji ──
    await sock.sendMessage(chatId, { react: { text: reaction.emoji, key: message.key } });

    // ── Fetch GIF ──
    const gifUrl = await getGifUrl(action, reaction.api);

    // ── Mentions ──
    const mentions = [senderJid];
    if (targetJid) mentions.push(targetJid);

    // ── Caption — full line bold ──
    const caption = [
        `${reaction.emoji} *${actionText}*`,
        '',
        '> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
    ].join('\n');

    if (!gifUrl) {
        await sock.sendMessage(chatId, {
            text: caption + '\n\n_(GIF unavailable)_',
            mentions
        }, { quoted: message });
        return;
    }

    // ── Download & send as animated sticker ──
    try {
        const resp    = await axios.get(gifUrl, { responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const buf     = Buffer.from(resp.data);
        const isGif   = gifUrl.toLowerCase().endsWith('.gif');
        const sticker = await convertToSticker(buf, isGif);

        // Send sticker (quoted)
        await sock.sendMessage(chatId, { sticker }, { quoted: message });

        // Send bold caption with mentions right after
        await sock.sendMessage(chatId, { text: caption, mentions }, { quoted: message });

    } catch (err) {
        console.error('[CYBER X] anime error:', err.message);
        // Fallback: send as gif video
        try {
            await sock.sendMessage(chatId, {
                video: { url: gifUrl },
                caption,
                gifPlayback: true,
                mentions
            }, { quoted: message });
        } catch {
            await sock.sendMessage(chatId, {
                text: caption + '\n\n_(Could not load GIF)_',
                mentions
            }, { quoted: message });
        }
    }
}

module.exports = { animeCommand };
