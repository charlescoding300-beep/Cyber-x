'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/lyrics.js  —  ZENX  |  🎵 Lyrics Finder
//  Usage: .lyrics <song>            .lyrics <artist> - <song>
//         .lyrics --check           (tests every lyrics source)
//  Aliases: .lyric  .ly  .lirik      Reaction: 🎵 → ✅   Category: media
//
//  SOURCES (first one that returns real lyrics wins):
//    1. KnightBot API  — https://knightbotapi.stream   (enabled by .env, see below)
//    2. LRCLIB         — https://lrclib.net            (free, no key; plain + timed lyrics)
//    3. lyrics.ovh     — best-effort backup; only used for "artist - song" searches
//
//  ── TURN ON KNIGHTBOT ───────────────────────────────────────────────
//  The KnightBot site draws its endpoint list with JavaScript, so the exact path
//  could not be read automatically. Open https://knightbotapi.stream, press Ctrl+K,
//  search "lyrics", and copy the path + parameter name from the example URL. Then:
//      KNIGHT_LYRICS_PATH=/api/lyrics        # example — use the REAL path from the site
//      KNIGHT_LYRICS_PARAM=q                 # the query-parameter name for the song
//      KNIGHT_API_KEY=knight                 # default
//  Restart the bot and run  .lyrics --check  to confirm it says ✅.
//
//  OPTIONAL .env:  LYRICS_MAX_PARTS=4 (messages per song) · BOT_CREDIT=...
// ════════════════════════════════════════════════════════════════════

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const { sendMessageUnstyled } = require('../core/responseTextStyle')
const { searchTrack } = require('./spotify')._internals
const UA = 'ZENX-Bot lyrics (+https://github.com/)'      // LRCLIB asks clients to identify themselves

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)
const CFG = {
  knightBase:  () => env('KNIGHT_API_BASE', 'https://knightbotapi.stream').replace(/\/+$/, ''),
  knightKey:   () => env('KNIGHT_API_KEY', 'knight'),
  knightPath:  () => env('KNIGHT_LYRICS_PATH', ''),
  knightParam: () => env('KNIGHT_LYRICS_PARAM', 'q'),
  maxParts:    () => Math.max(1, parseInt(process.env.LYRICS_MAX_PARTS, 10) || 4),
}
const CHUNK = 3000                                          // characters per WhatsApp message

const warn = (...a) => console.warn('[LYRICS]', ...a)

// ── professional layout ──────────────────────────────────────────────
const LINE = '━━━━━━━━━━━━━━━━━━━━━━━━'
const box = (title, lines) =>
  `╔══════════════════════════════╗\n║  ${title}\n╚══════════════════════════════╝\n\n${lines.join('\n')}\n\n${CREDIT}`
const TITLE = '🎵  *LYRICS FINDER*'

const USAGE = box(TITLE, [
  '❌ *No song given!*',
  '',
  '📌 *Usage:*',
  '  _.lyrics <song name>_',
  '  _.lyrics <artist> - <song>_',
  '',
  '🔥 *Examples:*',
  '  _.lyrics last last_',
  '  _.lyrics burna boy - last last_',
])

// ── helpers ──────────────────────────────────────────────────────────
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim()
const fmtDur = s => { s = Math.round(Number(s) || 0); return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '' }
const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

async function getJson(url, timeout = 12000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// "artist - song"  /  "song by artist"
function splitQuery(q) {
  let m = q.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (m) return { artist: clean(m[1]), title: clean(m[2]) }
  m = q.match(/^(.+?)\s+by\s+(.+)$/i)
  if (m) return { artist: clean(m[2]), title: clean(m[1]) }
  return { artist: '', title: clean(q) }
}

// LRCLIB sometimes only has timed lyrics — strip "[01:23.45]" stamps to get readable text
const stripTimes = s => String(s || '').replace(/^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s?/gm, '').replace(/\n{3,}/g, '\n\n').trim()

function usableLyrics(rec) {
  if (!rec || rec.instrumental) return ''
  const plain = rec.plainLyrics && String(rec.plainLyrics).trim()
  if (plain && plain.length > 30) return plain
  const synced = rec.syncedLyrics && stripTimes(rec.syncedLyrics)
  return synced && synced.length > 30 ? synced : ''
}

// ════════════════════════════════════════════════════════════════════
//  SOURCES  →  each returns { title, artist, album, duration, lyrics, source } or null
// ════════════════════════════════════════════════════════════════════

function findLyricsText(o, depth = 0) {
  if (o == null || depth > 5) return null
  if (typeof o === 'string') return o.length > 60 && o.includes('\n') ? o : null
  if (Array.isArray(o)) { for (const x of o) { const t = findLyricsText(x, depth + 1); if (t) return t } return null }
  if (typeof o === 'object') {
    for (const k of ['lyrics', 'lyric', 'plainLyrics', 'text', 'result', 'data']) {
      if (o[k] !== undefined) { const t = findLyricsText(o[k], depth + 1); if (t) return t }
    }
    for (const v of Object.values(o)) { const t = findLyricsText(v, depth + 1); if (t) return t }
  }
  return null
}
const pick = (o, keys) => { for (const k of keys) { const v = o?.[k] ?? o?.result?.[k] ?? o?.data?.[k]; if (typeof v === 'string' && v.trim()) return clean(v) } return '' }

async function fromKnight(query) {
  const j = await getJson(`${CFG.knightBase()}${CFG.knightPath()}?${CFG.knightParam()}=${encodeURIComponent(query)}&apikey=${encodeURIComponent(CFG.knightKey())}`, 15000)
  if (j && (j.success === false || j.status === false)) throw new Error(String(j.message || j.error || 'API reported failure').slice(0, 80))
  const lyrics = findLyricsText(j)
  if (!lyrics) return null
  return { title: pick(j, ['title', 'track', 'song', 'name']), artist: pick(j, ['artist', 'author', 'singer']), album: pick(j, ['album']), duration: 0, lyrics: lyrics.trim(), source: 'KnightBot API' }
}

function rankLrclib(list, query) {
  const q = new Set(words(query))
  return list
    .map(r => {
      const hay = new Set(words(`${r.trackName} ${r.artistName}`))
      let hit = 0; for (const w of q) if (hay.has(w)) hit++
      return { r, score: hit / Math.max(1, q.size) }
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r)
}

async function fromLrclib(query) {
  const { artist, title } = splitQuery(query)
  // LRCLIB recommends /api/get first when artist + track are known (faster, more exact)
  if (artist) {
    try {
      const exact = await getJson(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`)
      const lyr = usableLyrics(exact)
      if (lyr) return { title: exact.trackName, artist: exact.artistName, album: exact.albumName, duration: exact.duration, lyrics: lyr, source: 'LRCLIB' }
    } catch (e) { warn(`lrclib get: ${e.message}`) }
  }
  const list = await getJson(`https://lrclib.net/api/search?q=${encodeURIComponent(artist ? `${artist} ${title}` : title)}`)
  if (!Array.isArray(list)) return null
  for (const r of rankLrclib(list, query)) {                                   // many records exist with NULL lyrics — skip them
    const lyr = usableLyrics(r)
    if (lyr) return { title: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration, lyrics: lyr, source: 'LRCLIB' }
  }
  return null
}

async function fromLyricsOvh(query) {                                           // best-effort backup
  const { artist, title } = splitQuery(query)
  if (!artist) return null
  const j = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`)
  const lyr = j?.lyrics && String(j.lyrics).replace(/\r/g, '').trim()
  return lyr && lyr.length > 30 ? { title, artist, album: '', duration: 0, lyrics: lyr, source: 'lyrics.ovh' } : null
}

const SOURCES = [
  { name: 'KnightBot API', enabled: () => !!CFG.knightPath(), fn: fromKnight },
  { name: 'LRCLIB',        enabled: () => true,                fn: fromLrclib },
  { name: 'lyrics.ovh',    enabled: () => true,                fn: fromLyricsOvh },
]

async function findLyrics(query) {
  const errors = []
  for (const s of SOURCES) {
    if (!s.enabled()) continue
    try {
      const r = await s.fn(query)
      if (r?.lyrics) return r
      errors.push(`${s.name}: no match`)
    } catch (e) { errors.push(`${s.name}: ${e.message}`) }
  }
  warn(`no lyrics for "${query}" — ${errors.join(' | ')}`)
  return null
}

// ── layout the lyrics into WhatsApp-sized parts ──────────────────────
function formatBody(text) {
  return text.replace(/\r/g, '').split('\n').map(l => {
    const t = l.trim()
    return /^\[[^\]]{2,40}\]$/.test(t) || /^\([^)]{2,40}\)$/.test(t) && /^(verse|chorus|bridge|intro|outro|hook|pre)/i.test(t.slice(1))
      ? `*${t}*` : l.trimEnd()
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function splitParts(body, size = CHUNK) {
  const parts = []
  let cur = ''
  for (const para of body.split(/\n\n/)) {
    const piece = (cur ? '\n\n' : '') + para
    if ((cur + piece).length > size && cur) { parts.push(cur); cur = para } else cur += piece
    while (cur.length > size) {                                               // a single huge paragraph
      const cut = cur.lastIndexOf('\n', size) > 0 ? cur.lastIndexOf('\n', size) : size
      parts.push(cur.slice(0, cut)); cur = cur.slice(cut).trim()
    }
  }
  if (cur) parts.push(cur)
  return parts
}

async function runCheck() {
  const lines = []
  for (const s of SOURCES) {
    if (!s.enabled()) { lines.push(`⚪ *${s.name}* — off (set KNIGHT_LYRICS_PATH in .env to enable)`); continue }
    const t = Date.now()
    try {
      const r = await s.fn(s.name === 'lyrics.ovh' ? 'rick astley - never gonna give you up' : 'never gonna give you up')
      lines.push(r ? `✅ *${s.name}* — “${r.title || 'ok'}” ${r.lyrics.length} chars (${Date.now() - t}ms)` : `⚠️ *${s.name}* — answered but found nothing (${Date.now() - t}ms)`)
    } catch (e) { lines.push(`❌ *${s.name}* — ${e.message} (${Date.now() - t}ms)`) }
  }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
//  the command
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  'lyrics',
  alias:    ['lyric', 'ly', 'lirik'],
  category: 'media',
  desc:     'Find a song’s lyrics with Spotify track artwork',
  usage:    '.lyrics <song> | .lyrics <artist> - <song>',

  run: async ({ sock, from, msg, args, text }) => {
    const react = emoji => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {})
    const reply = body => sendMessageUnstyled(sock, from, { text: body }, { quoted: msg })

    const query = String(text || args?.join(' ') || '').trim()
    if (!query) return reply(USAGE)

    if (query.toLowerCase() === '--check') {
      void react('🔎')
      return reply(box('🔎  *LYRICS SOURCE CHECK*', [await runCheck()]))
    }

    void react('🎵')
    let track = null
    try {
      track = await searchTrack(query)
    } catch (error) {
      warn(`Spotify search failed: ${error.message}`)
    }

    // Search lyrics with Spotify’s canonical artist and title when available.
    // If that exact match is missing from a lyrics provider, retry the input.
    let r = await findLyrics(track ? `${track.artists} - ${track.title}` : query)
    if (!r && track) r = await findLyrics(query)

    if (!r) {
      void react('❌')
      return reply(box(TITLE, [
        `❌ *No lyrics found for:* _"${query}"_`,
        track ? null : '⚠️ Spotify could not identify a matching track, so artwork is unavailable.',
        '💡 Try the format: _.lyrics artist - song_',
        '💡 Check the spelling, or run _.lyrics --check_',
      ].filter(Boolean)))
    }

    if (track) {
      r = {
        ...r,
        title: track.title || r.title,
        artist: track.artists || r.artist,
        album: track.album || r.album,
        duration: track.durationMs ? track.durationMs / 1000 : r.duration,
      }
    }

    const parts = splitParts(formatBody(r.lyrics))
    const max = CFG.maxParts()
    const cut = parts.length > max
    const shownParts = cut ? parts.slice(0, max) : parts
    const total = shownParts.length

    try {
      if (track) {
        const caption = [
          '🎵 *LYRICS*',
          `🎶 ${track.title}`,
          `🎤 ${track.artists}`,
          track.album ? `💿 ${track.album}` : null,
          track.durationMs ? `⏱️ ${fmtDur(track.durationMs / 1000)}` : null,
          `📚 Lyrics: ${r.source}`,
          track.url ? `🔗 ${track.url}` : null,
          CREDIT,
        ].filter(Boolean).join('\n')

        if (track.cover) {
          try {
            await sendMessageUnstyled(
              sock,
              from,
              { image: { url: track.cover }, caption },
              { quoted: msg },
            )
          } catch (imageError) {
            warn(`Spotify artwork send failed: ${imageError.message}`)
            await reply(caption)
          }
        } else {
          await reply(caption)
        }
      }

      for (let i = 0; i < total; i++) {
        const last = i === total - 1
        const title = r.title || query
        const body =
          (i === 0
            ? `🎵 *LYRICS — ${title}*\n📚 Source: ${r.source}\n\n`
            : `🎵 *${title} — continued*\n\n`) +
          `${LINE}\n${shownParts[i]}\n${LINE}\n` +
          (total > 1 ? `📄 _Part ${i + 1}/${total}_\n` : '') +
          (last && cut ? '✂️ _Lyrics shortened — the song is very long_\n' : '') +
          (last ? `\n${CREDIT}` : '')
        await sendMessageUnstyled(sock, from, { text: body }, { quoted: msg })
      }
    } catch (e) {
      warn(`send failed: ${e.message}`)
      void react('❌')
      return
    }
    void react('✅')
  },
}
Object.defineProperty(module.exports, '_test', {
  value: { splitQuery, usableLyrics, stripTimes, splitParts, formatBody, rankLrclib, findLyricsText, findLyrics, runCheck, SOURCES },
  enumerable: false,
})
