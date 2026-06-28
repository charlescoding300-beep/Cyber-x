'use strict'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CYBER X — LYRICS COMMAND
//  Usage: .lyrics <song>  OR  .lyrics <song> - <artist>
//  Anyone can use | Category: utility
//  Fallback chain: lrclib → lyrics.ovh → chartlyrics →
//                  some-random-api → genius-unofficial
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fetch               = require('node-fetch')
const youtubesearchapi    = require('youtube-search-api')

const CREDIT =
`*╭══ ✕-CYBER X ⚡*
*┃👨‍💻 ᴅᴇᴠᴇʟᴏᴘᴇʀ :* *Charles Tech*
*╰═════════════════⊷*`

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LYRICS ENGINES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function tryLrcLib(trackName, artistName) {
    try {
        let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(trackName)}`
        if (artistName) url += `&artist_name=${encodeURIComponent(artistName)}`
        const res  = await fetch(url, { headers: { 'User-Agent': 'CYBER-X-Bot/1.0' }, timeout: 8000 })
        if (!res.ok) return null
        const data = await res.json()
        const song = Array.isArray(data) && data.find(r => r.plainLyrics)
        if (!song) return null
        return { lyrics: song.plainLyrics, title: song.trackName, artist: song.artistName, album: song.albumName }
    } catch { return null }
}

async function tryLyricsOvh(trackName, artistName) {
    try {
        const artist = artistName || trackName.split(' ')[0]
        const title  = artistName ? trackName : trackName.split(' ').slice(1).join(' ') || trackName
        const res    = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 8000 })
        if (!res.ok) return null
        const data = await res.json()
        if (!data.lyrics) return null
        return { lyrics: data.lyrics, title, artist }
    } catch { return null }
}

async function tryChartLyrics(trackName, artistName) {
    try {
        const url = `http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artistName || '')}&song=${encodeURIComponent(trackName)}`
        const res  = await fetch(url, { timeout: 8000 })
        if (!res.ok) return null
        const text        = await res.text()
        const lyricsMatch = text.match(/<Lyric>([\s\S]*?)<\/Lyric>/)
        const titleMatch  = text.match(/<LyricSong>([\s\S]*?)<\/LyricSong>/)
        const artistMatch = text.match(/<LyricArtist>([\s\S]*?)<\/LyricArtist>/)
        if (!lyricsMatch || !lyricsMatch[1].trim()) return null
        return { lyrics: lyricsMatch[1].trim(), title: titleMatch?.[1] || trackName, artist: artistMatch?.[1] || artistName || '' }
    } catch { return null }
}

async function trySomeRandomApi(trackName, artistName) {
    try {
        const q   = artistName ? `${trackName} ${artistName}` : trackName
        const res = await fetch(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`, { timeout: 8000 })
        if (!res.ok) return null
        const data = await res.json()
        if (!data.lyrics) return null
        return { lyrics: data.lyrics, title: data.title, artist: data.author, thumbnail: data.thumbnail?.genius }
    } catch { return null }
}

async function tryGeniusUnofficial(trackName, artistName) {
    try {
        const q       = artistName ? `${trackName} ${artistName}` : trackName
        const res     = await fetch(`https://genius-unofficial-api.vercel.app/genius/search?q=${encodeURIComponent(q)}`, { timeout: 8000 })
        if (!res.ok) return null
        const data    = await res.json()
        const hit     = data?.hits?.[0]?.result
        if (!hit) return null
        const lyricRes  = await fetch(`https://genius-unofficial-api.vercel.app/genius/lyrics?id=${hit.id}`, { timeout: 10000 })
        if (!lyricRes.ok) return null
        const lyricData = await lyricRes.json()
        if (!lyricData.lyrics) return null
        return { lyrics: lyricData.lyrics, title: hit.title, artist: hit.primary_artist?.name, thumbnail: hit.song_art_image_thumbnail_url }
    } catch { return null }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  YOUTUBE THUMBNAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getYoutubeThumbnail(query) {
    try {
        const results = await youtubesearchapi.GetListByKeyword(query, false, 1, [{ type: 'video' }])
        const item    = results?.items?.[0]
        if (!item) return null
        const videoId = item.id
        return {
            videoId,
            thumb:   `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            title:   item.title,
            channel: item.channelTitle
        }
    } catch { return null }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN COMMAND
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = {
    pattern:  'lyrics',
    alias:    ['lyric', 'song'],
    category: 'utility',
    desc:     'Get lyrics for any song',
    usage:    '.lyrics <song>  OR  .lyrics <song> - <artist>',

    run: async ({ sock, from, msg, args, text }) => {

        const input = (text || args.join(' ')).trim()

        // ── No input → usage help ──────────────────────────────
        if (!input) {
            return sock.sendMessage(from, {
                text:
`╔════════════════════════════╗
║  🎵  *C Y B E R  X  LYRICS*  ║
╚════════════════════════════╝

❌ *No song name provided!*

┌─────────────────────────────
│ 📌 *Usage:*
│  _.lyrics <song name>_
│  _.lyrics <song> - <artist>_
└─────────────────────────────

🔥 *Examples:*
  _.lyrics Blinding Lights_
  _.lyrics APT - Rose_
  _.lyrics Die With A Smile - Bruno Mars_

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── Parse "song - artist" format ───────────────────────
        let trackName  = input.trim()
        let artistName = ''
        if (input.includes(' - ')) {
            const parts = input.split(' - ')
            trackName   = parts[0].trim()
            artistName  = parts.slice(1).join(' - ').trim()
        }

        // ── React 🔍 ───────────────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '🔍', key: msg.key }
        }).catch(() => {})

        // ── Send searching message ─────────────────────────────
        const searchMsg = await sock.sendMessage(from, {
            text:
`╔════════════════════════════╗
║  🎵  *C Y B E R  X  LYRICS*  ║
╚════════════════════════════╝

🔎 *Searching lyrics for:*
_"${input}"_

⏳ Please wait...

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
        }, { quoted: msg })

        // ── Run fallback chain ─────────────────────────────────
        const sources = [
            { name: 'LRCLib',            fn: () => tryLrcLib(trackName, artistName)           },
            { name: 'Lyrics.OVH',        fn: () => tryLyricsOvh(trackName, artistName)        },
            { name: 'ChartLyrics',       fn: () => tryChartLyrics(trackName, artistName)       },
            { name: 'SomeRandomAPI',     fn: () => trySomeRandomApi(trackName, artistName)     },
            { name: 'Genius Unofficial', fn: () => tryGeniusUnofficial(trackName, artistName)  },
        ]

        let result  = null
        let srcName = ''
        for (const src of sources) {
            result = await src.fn()
            if (result?.lyrics?.trim()) { srcName = src.name; break }
        }

        // ── Fetch YouTube thumbnail in parallel ────────────────
        const ytQuery = artistName ? `${trackName} ${artistName} official` : `${trackName} official`
        const ytData  = await getYoutubeThumbnail(ytQuery)

        // ── Delete searching message ───────────────────────────
        sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

        // ── Not found ──────────────────────────────────────────
        if (!result) {
            await sock.sendMessage(from, {
                react: { text: '❌', key: msg.key }
            }).catch(() => {})
            return sock.sendMessage(from, {
                text:
`╔════════════════════════════╗
║  🎵  *C Y B E R  X  LYRICS*  ║
╚════════════════════════════╝

❌ *No lyrics found for:* _"${input}"_

💡 *Tips:*
  • Add artist: _.lyrics Song - Artist_
  • Check spelling
  • Try shorter title

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`,
                quoted: msg
            })
        }

        // ── 1 second delay (feels natural) ────────────────────
        await sleep(1000)

        // ── React 📝 found ─────────────────────────────────────
        await sock.sendMessage(from, {
            react: { text: '📝', key: msg.key }
        }).catch(() => {})

        const songTitle  = result.title  || trackName
        const songArtist = result.artist || artistName || 'Unknown Artist'
        const songAlbum  = result.album  || ''
        const ytUrl      = ytData ? `https://youtube.com/watch?v=${ytData.videoId}` : null
        const thumbUrl   = result.thumbnail || ytData?.thumb || null

        // ── Truncate long lyrics ───────────────────────────────
        const MAX      = 3500
        let lyricsText = result.lyrics.trim()
        let truncated  = false
        if (lyricsText.length > MAX) {
            lyricsText = lyricsText.slice(0, MAX).trimEnd() + '\n\n_... (truncated)_'
            truncated  = true
        }

        // ── Build full caption ─────────────────────────────────
        const fullCaption =
`╔════════════════════════════╗
║  📝  *C Y B E R  X  LYRICS*  ║
╚════════════════════════════╝

🎵 *${songTitle}*
🎤 *Artist:* ${songArtist}${songAlbum ? `\n💿 *Album:* ${songAlbum}` : ''}${ytUrl ? `\n▶️ *YouTube:* ${ytUrl}` : ''}
📡 *Source:* ${srcName}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────── 『 LYRICS 』 ───────
${lyricsText}
└──────────────────────────────

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`

        // ── Send with thumbnail if available ───────────────────
        if (thumbUrl) {
            try {
                const imgRes = await fetch(thumbUrl, { timeout: 8000 })
                if (imgRes.ok) {
                    const imgBuf = await imgRes.buffer()
                    await sock.sendMessage(from, {
                        image:    imgBuf,
                        caption:  fullCaption,
                        mimetype: 'image/jpeg',
                    }, { quoted: msg })

                    // ── Send remaining lyrics if truncated ─────
                    if (truncated) {
                        const remaining = result.lyrics.trim().slice(MAX)
                        if (remaining.trim()) {
                            await sock.sendMessage(from, {
                                text:
`┌─────── 『 LYRICS — Part 2 』 ───────
${remaining.trim()}
└──────────────────────────────

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`
                            })
                        }
                    }
                    return
                }
            } catch { /* fall through */ }
        }

        // ── No image fallback ──────────────────────────────────
        await sock.sendMessage(from, {
            text: fullCaption,
            quoted: msg
        })

        if (truncated) {
            const remaining = result.lyrics.trim().slice(MAX)
            if (remaining.trim()) {
                await sock.sendMessage(from, {
                    text:
`┌─────── 『 LYRICS — Part 2 』 ───────
${remaining.trim()}
└──────────────────────────────

━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`
                })
            }
        }
    }
}
