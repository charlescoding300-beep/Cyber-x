// commands/spotify.js
// .spotify <song name>   (alias: .sp)
//
//   Searches Spotify's OFFICIAL API for the song, sends a clean "now playing"
//   card (cover art, title, artist, album, duration, link), then downloads the
//   actual playable audio via the knightbotapi.stream endpoint and sends it.
//
// SETUP — Spotify search (required)
//   1) https://developer.spotify.com/dashboard → Create App
//      (any Redirect URI works, e.g. http://127.0.0.1:8888/callback — this
//      command never uses it, Client Credentials needs no user login)
//   2) Set env vars: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
//   3) Optional: SPOTIFY_MARKET=US (default) — Client Credentials search can
//      return "unavailable" results with no market set.
//
//   ⚠️ As of Feb 6 2026, Spotify requires the APP OWNER'S ACCOUNT to have
//   Premium before a brand-new Developer App can use the Web API at all.
//   An app created before that date is currently still working without
//   Premium, but Spotify has only called that a temporary exemption.
//
// SETUP — audio download
//   KNIGHT_API_KEY=knight (the public demo key from the playground; get your
//   own if it starts rate-limiting — it's a third-party service, no SLA)
//
// KnightBot's documented /api/spotify route accepts a Spotify track URL and
// returns a short-lived download link; search-by-name still uses Spotify's API.
const axios = require('axios')
const knightApi = require('../lib/knightapi')

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_SEARCH_URL = 'https://api.spotify.com/v1/search'
let cachedToken = null // { value, expiresAt } — private to this module, never exported

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID
  const secret = process.env.SPOTIFY_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error(
      "Spotify isn't configured yet. Create a free app at https://developer.spotify.com/dashboard, then set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET."
    )
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) return cachedToken.value

  const basic = Buffer.from(`${id}:${secret}`).toString('base64')
  let res
  try {
    res = await axios.post(SPOTIFY_TOKEN_URL, 'grant_type=client_credentials', {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    })
  } catch (e) {
    const status = e.response?.status
    if (status === 400 || status === 403) {
      throw new Error(
        "Spotify rejected the app credentials (or your Developer App needs Premium under Spotify's Feb 2026 rules). Double-check SPOTIFY_CLIENT_ID/SECRET."
      )
    }
    throw new Error(`Couldn't reach Spotify's token endpoint: ${e.message}`)
  }
  cachedToken = { value: res.data.access_token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 }
  return cachedToken.value
}

async function searchTrack(query) {
  const token = await getSpotifyToken()
  const market = process.env.SPOTIFY_MARKET || 'US'
  const res = await axios.get(SPOTIFY_SEARCH_URL, {
    params: { q: query, type: 'track', limit: 1, market },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000,
  })
  const track = res.data?.tracks?.items?.[0]
  if (!track) return null
  return {
    title: track.name,
    artists: (track.artists || []).map(a => a.name).join(', '),
    album: track.album?.name || '',
    durationMs: track.duration_ms,
    cover: track.album?.images?.[0]?.url || null,
    url: track.external_urls?.spotify,
  }
}

function fmtDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return ''
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// MP3 frame sync (11 set bits) or an ID3 tag header — catches a flaky API
// returning an HTML error page with a 200 status instead of a real error.
function looksLikeAudio(buf) {
  if (!buf || buf.length < 64) return false
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true // "ID3"
  const scanLen = Math.min(buf.length - 1, 4096)
  for (let i = 0; i < scanLen; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return true
  }
  return false
}

async function downloadFromKnightApi(spotifyUrl) {
  const media = await knightApi.getSpotify(spotifyUrl, { timeout: 20000 })
  const file = await axios.get(media.download, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
    headers: { 'User-Agent': 'ZENX-Bot/1.0', Accept: '*/*' },
  })
  const buffer = Buffer.from(file.data)
  if (!looksLikeAudio(buffer)) {
    throw new Error('the download API returned something that is not a real audio file')
  }
  return { buffer, title: media.title }
}

function buildCaption(track) {
  return (
    `🎧 *${track.title}*\n` +
    `👤 ${track.artists}\n` +
    (track.album ? `💿 ${track.album}\n` : '') +
    (track.durationMs ? `⏱ ${fmtDuration(track.durationMs)}\n` : '') +
    `🔗 ${track.url}`
  )
}

module.exports = {
  name: 'spotify',
  aliases: ['sp'],
  desc: 'Search Spotify and send the song as playable audio.',
  usage: '.spotify <song name or Spotify track URL>',
  category: 'download',

  async run({ sock, from, msg, text, helper }) {
    const query = String(text || '').trim()
    if (!query) return helper.reply(sock, msg, '❌ Give me a song name, e.g. *.spotify shape of you*')

    let track
    const directSpotifyUrl = normalizeSpotifyTrackUrl(query)
    if (directSpotifyUrl) {
      track = { title: 'Spotify track', artists: '', album: '', durationMs: 0, cover: null, url: directSpotifyUrl }
    } else {
      try {
        track = await searchTrack(query)
      } catch (e) {
        return helper.reply(sock, msg, `❌ ${e.message}`)
      }
    }
    if (!track) return helper.reply(sock, msg, `❌ No Spotify match for "${query}".`)

    const caption = buildCaption(track)
    if (track.cover) {
      await helper.sendImage(sock, from, track.cover, caption)
    } else {
      await helper.reply(sock, msg, caption)
    }

    let media
    try {
      media = await downloadFromKnightApi(track.url)
    } catch (e) {
      return helper.reply(
        sock, msg,
        `⚠️ Found the track, but couldn't download it.\n${e.message}\nIt's a free third-party API with no uptime guarantee — try again shortly.`
      )
    }

    await sock.sendMessage(from, {
      audio: media.buffer,
      mimetype: 'audio/mpeg',
      fileName: `${track.artists ? `${track.artists} - ` : ''}${track.title || media.title || 'spotify-track'}.mp3`,
    })
  },
}

function normalizeSpotifyTrackUrl(value) {
  const input = String(value || '').trim()
  const uri = input.match(/^spotify:track:([A-Za-z0-9]+)$/i)
  if (uri) return `https://open.spotify.com/track/${uri[1]}`
  try {
    const parsed = new URL(input)
    if (!/(^|\.)open\.spotify\.com$/i.test(parsed.hostname)) return null
    const match = parsed.pathname.match(/^\/track\/([A-Za-z0-9]+)/i)
    return match ? `https://open.spotify.com/track/${match[1]}` : null
  } catch {
    return null
  }
}

// Reuse the catalog lookup in companion commands without exposing helpers to
// command registries that enumerate the module's public properties.
Object.defineProperty(module.exports, '_internals', {
  value: { searchTrack },
  enumerable: false,
})
