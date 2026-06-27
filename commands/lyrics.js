const fetch = require('node-fetch');
const youtubesearchapi = require('youtube-search-api');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — LYRICS COMMAND
//  Flow: 🔍 react → send header text → 1s delay → 
//        send image+lyrics (thumbnail above, lyrics below)
//  Fallback chain: lrclib → lyrics.ovh → chartlyrics →
//                  some-random-api → genius-unofficial
//  Usage: .lyrics <song>  OR  .lyrics <song> - <artist>
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── FALLBACK LYRICS ENGINES ─────────────────────────────────

async function tryLrcLib(trackName, artistName) {
    try {
        let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}`;
        if (artistName) url += `&artist_name=${encodeURIComponent(artistName)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }, timeout: 8000 });
        if (!res.ok) return null;
        const data = await res.json();
        const song = Array.isArray(data) && data.find(r => r.plainLyrics);
        if (!song) return null;
        return { lyrics: song.plainLyrics, title: song.trackName, artist: song.artistName, album: song.albumName };
    } catch { return null; }
}

async function tryLyricsOvh(trackName, artistName) {
    try {
        const artist = artistName || trackName.split(' ')[0];
        const title  = artistName ? trackName : trackName.split(' ').slice(1).join(' ') || trackName;
        const res = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 8000 });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.lyrics) return null;
        return { lyrics: data.lyrics, title, artist };
    } catch { return null; }
}

async function tryChartLyrics(trackName, artistName) {
    try {
        const url = `http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artistName || '')}&song=${encodeURIComponent(trackName)}`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) return null;
        const text = await res.text();
        const lyricsMatch = text.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
        const titleMatch  = text.match(/<LyricSong>([\s\S]*?)<\/LyricSong>/);
        const artistMatch = text.match(/<LyricArtist>([\s\S]*?)<\/LyricArtist>/);
        if (!lyricsMatch || !lyricsMatch[1].trim()) return null;
        return { lyrics: lyricsMatch[1].trim(), title: titleMatch?.[1] || trackName, artist: artistMatch?.[1] || artistName || '' };
    } catch { return null; }
}

async function trySomeRandomApi(trackName, artistName) {
    try {
        const q = artistName ? `${trackName} ${artistName}` : trackName;
        const res = await fetch(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`, { timeout: 8000 });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.lyrics) return null;
        return { lyrics: data.lyrics, title: data.title, artist: data.author, thumbnail: data.thumbnail?.genius };
    } catch { return null; }
}

async function tryGeniusUnofficial(trackName, artistName) {
    try {
        const q = artistName ? `${trackName} ${artistName}` : trackName;
        const res = await fetch(`https://genius-unofficial-api.vercel.app/genius/search?q=${encodeURIComponent(q)}`, { timeout: 8000 });
        if (!res.ok) return null;
        const data = await res.json();
        const hit = data?.hits?.[0]?.result;
        if (!hit) return null;
        const lyricRes = await fetch(`https://genius-unofficial-api.vercel.app/genius/lyrics?id=${hit.id}`, { timeout: 10000 });
        if (!lyricRes.ok) return null;
        const lyricData = await lyricRes.json();
        if (!lyricData.lyrics) return null;
        return { lyrics: lyricData.lyrics, title: hit.title, artist: hit.primary_artist?.name, thumbnail: hit.song_art_image_thumbnail_url };
    } catch { return null; }
}

// ── YOUTUBE THUMBNAIL ────────────────────────────────────────
async function getYoutubeThumbnail(query) {
    try {
        const results = await youtubesearchapi.GetListByKeyword(query, false, 1, [{ type: 'video' }]);
        const item = results?.items?.[0];
        if (!item) return null;
        const videoId = item.id;
        return {
            videoId,
            thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            title: item.title,
            channel: item.channelTitle
        };
    } catch { return null; }
}

// ── MAIN COMMAND ─────────────────────────────────────────────
async function lyricsCommand(sock, chatId, args, message) {
    const input = Array.isArray(args) ? args.join(' ') : (args || '');

    if (!input.trim()) {
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🎵  *C Y B E R  X  LYRICS*  ║',
                '╚════════════════════════════╝',
                '',
                '❌ *No song name provided!*',
                '',
                '┌─────────────────────────────',
                '│ 📌 *Usage:*',
                '│  `.lyrics <song name>`',
                '│  `.lyrics <song> - <artist>`',
                '└─────────────────────────────',
                '',
                '🔥 *Examples:*',
                '  `.lyrics Blinding Lights`',
                '  `.lyrics APT - Rose`',
                '  `.lyrics Die With A Smile - Bruno Mars`',
                '',
                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *Powered by 5 Lyrics Engines*'
            ].join('\n')
        }, { quoted: message });
        return;
    }

    // Parse "song - artist" format
    let trackName  = input.trim();
    let artistName = '';
    if (input.includes(' - ')) {
        const parts = input.split(' - ');
        trackName  = parts[0].trim();
        artistName = parts.slice(1).join(' - ').trim();
    }

    // ── STEP 1: React 🔍 (searching) ──
    await sock.sendMessage(chatId, { react: { text: '🔍', key: message.key } });

    // ── STEP 2: Send "searching" header text immediately ──
    const searchingMsg = await sock.sendMessage(chatId, {
        text: [
            '╔════════════════════════════╗',
            '║  🎵  *C Y B E R  X  LYRICS*  ║',
            '╚════════════════════════════╝',
            '',
            `🔎 *Searching lyrics for:*`,
            `_"${input}"_`,
            '',
            '⏳ Please wait...',
            '',
            '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™'
        ].join('\n')
    }, { quoted: message });

    // ── STEP 3: Run fallback chain + YouTube in parallel ──
    const sources = [
        { name: 'LRCLib',            fn: () => tryLrcLib(trackName, artistName)          },
        { name: 'Lyrics.OVH',        fn: () => tryLyricsOvh(trackName, artistName)       },
        { name: 'ChartLyrics',       fn: () => tryChartLyrics(trackName, artistName)      },
        { name: 'SomeRandomAPI',     fn: () => trySomeRandomApi(trackName, artistName)    },
        { name: 'Genius Unofficial', fn: () => tryGeniusUnofficial(trackName, artistName) },
    ];

    let result  = null;
    let srcName = '';
    for (const src of sources) {
        result = await src.fn();
        if (result?.lyrics?.trim()) { srcName = src.name; break; }
    }

    const ytQuery = artistName ? `${trackName} ${artistName} official` : `${trackName} official`;
    const ytData  = await getYoutubeThumbnail(ytQuery);

    // ── NOT FOUND ──
    if (!result) {
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } });
        await sock.sendMessage(chatId, {
            text: [
                '╔════════════════════════════╗',
                '║  🎵  *C Y B E R  X  LYRICS*  ║',
                '╚════════════════════════════╝',
                '',
                `❌ *No lyrics found for:* _"${input}"_`,
                '',
                '💡 *Tips:*',
                '  • Add artist: `.lyrics Song - Artist`',
                '  • Check spelling',
                '  • Try shorter title',
                '',
                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *5 engines searched, no result*'
            ].join('\n')
        }, { quoted: message });
        return;
    }

    // ── STEP 4: 1 second delay (feels like it's "loading" the result) ──
    await sleep(1000);

    // ── STEP 5: React 📝 (found) ──
    await sock.sendMessage(chatId, { react: { text: '📝', key: message.key } });

    const songTitle  = result.title  || trackName;
    const songArtist = result.artist || artistName || 'Unknown Artist';
    const songAlbum  = result.album  || '';
    const ytUrl      = ytData ? `https://youtube.com/watch?v=${ytData.videoId}` : null;
    const thumbUrl   = result.thumbnail || ytData?.thumb || null;

    // ── BUILD LYRICS BODY ──
    const MAX     = 3500;
    let lyricsText = result.lyrics.trim();
    let truncated  = false;
    if (lyricsText.length > MAX) {
        lyricsText = lyricsText.slice(0, MAX).trimEnd() + '\n\n_... (truncated)_';
        truncated  = true;
    }

    const lyricsBlock = [
        '┌─────── 『 LYRICS 』 ───────',
        lyricsText,
        `└${'─'.repeat(30)}`,
        '',
        '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *End of Lyrics*'
    ].join('\n');

    // ── FULL CAPTION (header + lyrics together under the image) ──
    const fullCaption = [
        '╔════════════════════════════╗',
        '║  📝  *C Y B E R  X  LYRICS*  ║',
        '╚════════════════════════════╝',
        '',
        `🎵 *${songTitle}*`,
        `🎤 *Artist:* ${songArtist}`,
        songAlbum ? `💿 *Album:* ${songAlbum}` : '',
        ytUrl     ? `▶️ *YouTube:* ${ytUrl}`   : '',
        `📡 *Source:* ${srcName}`,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        lyricsBlock
    ].filter(Boolean).join('\n');

    // ── STEP 6: Send thumbnail image with full caption (image on top, lyrics below) ──
    if (thumbUrl) {
        try {
            const imgRes = await fetch(thumbUrl, { timeout: 8000 });
            if (imgRes.ok) {
                const imgBuf = await imgRes.buffer();
                await sock.sendMessage(chatId, {
                    image: imgBuf,
                    caption: fullCaption,
                    mimetype: 'image/jpeg'
                });

                // If lyrics were truncated send remaining in follow-up
                if (truncated) {
                    const remaining = result.lyrics.trim().slice(MAX);
                    if (remaining.trim()) {
                        await sock.sendMessage(chatId, {
                            text: [
                                '┌─────── 『 LYRICS — Part 2 』 ───────',
                                remaining.trim(),
                                `└${'─'.repeat(30)}`,
                                '',
                                '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *End of Lyrics*'
                            ].join('\n')
                        });
                    }
                }
                return;
            }
        } catch { /* fall through to text only */ }
    }

    // ── FALLBACK: no image, just text ──
    await sock.sendMessage(chatId, { text: fullCaption });

    if (truncated) {
        const remaining = result.lyrics.trim().slice(MAX);
        if (remaining.trim()) {
            await sock.sendMessage(chatId, {
                text: [
                    '┌─────── 『 LYRICS — Part 2 』 ───────',
                    remaining.trim(),
                    `└${'─'.repeat(30)}`,
                    '',
                    '> 𝕮𝖄𝕭𝕰𝕽 𝖃 ™ — *End of Lyrics*'
                ].join('\n')
            });
        }
    }
}

module.exports = { lyricsCommand };
