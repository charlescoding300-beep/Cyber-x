'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — YouTube Play

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const axios = require('axios')

const execFileAsync = promisify(execFile)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
}

function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(Number(seconds))) return 'Unknown'

  seconds = Math.floor(Number(seconds))

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return `${m}:${String(s).padStart(2, '0')}`
}

function cleanFileName(name) {
  return String(name || 'audio')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'audio'
}

async function fetchBuffer(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer', timeout: 30000, headers: HEADERS,
    validateStatus: s => s >= 200 && s < 400
  })
  return Buffer.from(r.data)
}

// YouTube returns a small valid placeholder JPG (HTTP 200) when a size
// doesn't exist for a video — walk largest-first, reject anything tiny.
async function fetchRealThumbnail(videoId) {
  const sizes = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default']
  for (const size of sizes) {
    try {
      const buf = await fetchBuffer(`https://i.ytimg.com/vi/${videoId}/${size}.jpg`)
      if (buf?.length > 5000) return buf
    } catch {}
  }
  return null
}

function extractVideoId(url) {
  return url?.match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{11})/)?.[1] || null
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — yt-dlp first (fastest, richest metadata), falling back to the
// yt-search npm package (scrapes YouTube's own search page — a different
// request pattern, not blocked by the same bot-detection as yt-dlp's
// dedicated YouTube extractor).
// ─────────────────────────────────────────────────────────────────────────────
async function searchViaYtDlp(query) {
  const { stdout } = await execFileAsync(
    'yt-dlp',
    ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', `ytsearch1:${query}`],
    { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
  )
  const info = JSON.parse(stdout)
  if (!info?.webpage_url && !info?.id) throw new Error('yt-dlp: no result')

  return {
    title:    info.title || query,
    author:   info.uploader || info.channel || info.creator || 'Unknown',
    duration: formatDuration(info.duration),
    url:      info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
    videoId:  info.id || extractVideoId(info.webpage_url),
  }
}

async function searchViaYtSearch(query) {
  const yts = require('yt-search')
  const search = await yts(query)
  const best = search?.videos?.[0]
  if (!best) throw new Error('yt-search: no result')

  return {
    title:    best.title,
    author:   best.author?.name || 'Unknown',
    duration: best.timestamp || 'Unknown',
    url:      best.url,
    videoId:  best.videoId || extractVideoId(best.url),
  }
}

async function smartSearch(query) {
  try {
    const r = await searchViaYtDlp(query)
    console.log(`[ZEN X PLAY] search OK via yt-dlp: "${r.title}" (${r.url})`)
    return r
  } catch (e) {
    console.error('[ZEN X PLAY] yt-dlp search failed:', e.message)
    const r = await searchViaYtSearch(query)
    console.log(`[ZEN X PLAY] search OK via yt-search fallback: "${r.title}" (${r.url})`)
    return r
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD — yt-dlp first, falling back to third-party download APIs that
// fetch from their own servers (sidesteps this VPS's IP being flagged by
// YouTube's bot detection, which is what "Sign in to confirm you're not a
// bot" means — it's an IP-reputation block, not something fixable in code
// alone without cookies).
// ─────────────────────────────────────────────────────────────────────────────
async function downloadViaYtDlp(youtubeUrl) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zenx-play-'))
  const outputTemplate = path.join(workDir, 'audio.%(ext)s')
  try {
    await execFileAsync(
      'yt-dlp',
      ['--no-playlist', '--no-warnings', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputTemplate, youtubeUrl],
      { maxBuffer: 10 * 1024 * 1024, timeout: 180000 }
    )
    const files = await fs.promises.readdir(workDir)
    const audioFile = files.find(f => f.toLowerCase().endsWith('.mp3'))
    if (!audioFile) throw new Error('yt-dlp: no audio file produced')
    const buf = await fs.promises.readFile(path.join(workDir, audioFile))
    if (buf.length < 10000) throw new Error('yt-dlp: output too small')
    return buf
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

const MP3_APIS = [
  {
    name: 'EliteProTech',
    get: async (url) => {
      const r = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`,
        { timeout: 30000, headers: HEADERS })
      if (r?.data?.success && r?.data?.downloadURL) return r.data.downloadURL
      throw new Error('No URL')
    }
  },
  {
    name: 'Yupra',
    get: async (url) => {
      const r = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS })
      if (r?.data?.success && r?.data?.data?.download_url) return r.data.data.download_url
      throw new Error('No URL')
    }
  },
  {
    name: 'Okatsu',
    get: async (url) => {
      const r = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`,
        { timeout: 30000, headers: HEADERS })
      if (r?.data?.dl) return r.data.dl
      throw new Error('No URL')
    }
  },
  {
    name: 'Cobalt',
    get: async (url) => {
      const r = await axios.post('https://api.cobalt.tools/',
        { url, isAudioOnly: true, filenamePattern: 'basic' },
        { timeout: 30000, headers: { ...HEADERS, 'Content-Type': 'application/json', 'Accept': 'application/json' } })
      if (r?.data?.url) return r.data.url
      throw new Error('No URL')
    }
  },
]

function looksLikeAudio(buf) {
  if (!buf || buf.length < 10000) return false
  const head = buf.slice(0, 16).toString('latin1')
  // Reject obvious non-audio payloads (HTML/JSON error bodies from a
  // flaky API) that would otherwise pass a bare size check.
  if (head.startsWith('<') || head.startsWith('{') || head.startsWith('[')) return false
  return true
}

async function downloadAudio(youtubeUrl) {
  try {
    const buf = await downloadViaYtDlp(youtubeUrl)
    console.log(`[ZEN X PLAY] download OK via yt-dlp (${(buf.length / 1e6).toFixed(2)}MB)`)
    return buf
  } catch (e) {
    console.error('[ZEN X PLAY] yt-dlp download failed:', e.message)
  }

  for (const api of MP3_APIS) {
    try {
      const dlUrl = await api.get(youtubeUrl)
      const buf   = await fetchBuffer(dlUrl)
      if (looksLikeAudio(buf)) {
        console.log(`[ZEN X PLAY] download OK via ${api.name} (${(buf.length / 1e6).toFixed(2)}MB)`)
        return buf
      }
      console.error(`[ZEN X PLAY] ${api.name} returned a non-audio or too-small payload (${buf?.length || 0} bytes) — skipping`)
    } catch (e) {
      console.error(`[ZEN X PLAY] ${api.name} failed:`, e.message)
    }
  }
  throw new Error('All download sources failed')
}

module.exports = {
  name: 'play',
  aliases: ['ytplay', 'song'],
  desc: 'Play a song from YouTube',
  usage: '.play <song name>',
  category: 'download',

  run: async ({ sock, from, msg, args }) => {
    const query = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim()
    if (!query) return

    try {
      // ─────────────────────────────────────────────
      // 1. SEARCH YOUTUBE
      // ─────────────────────────────────────────────
      const info = await smartSearch(query)
      if (!info?.url) return

      // ─────────────────────────────────────────────
      // 2. REAL THUMBNAIL — fetched as a Buffer, not a bare URL
      // ─────────────────────────────────────────────
      const thumbBuf = info.videoId ? await fetchRealThumbnail(info.videoId).catch(() => null) : null
      console.log(`[ZEN X PLAY] thumbnail ${thumbBuf ? `OK (${thumbBuf.length} bytes)` : 'FAILED — sending without one'}`)

      // ─────────────────────────────────────────────
      // 3. DOWNLOAD AUDIO
      // ─────────────────────────────────────────────
      const audioBuf = await downloadAudio(info.url)

      // ─────────────────────────────────────────────
      // 4. SEND ONE AUDIO MESSAGE
      //
      // YouTube information is ATTACHED to the audio.
      // No separate YouTube message.
      // ─────────────────────────────────────────────
      console.log(`[ZEN X PLAY] sending to ${from} — audio ${(audioBuf.length / 1e6).toFixed(2)}MB`)
      const sent = await sock.sendMessage(
        from,
        {
          audio: audioBuf,
          mimetype: 'audio/mpeg',
          fileName: `${cleanFileName(info.title)}.mp3`,
          ptt: false,
          contextInfo: {
            externalAdReply: {
              title: info.title,
              body: `Author ${info.author} || Duration ${info.duration}`,
              thumbnail: thumbBuf || undefined,
              sourceUrl: info.url,
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false
            }
          }
        },
        { quoted: msg }
      )
      console.log(`[ZEN X PLAY] sendMessage resolved — key: ${sent?.key?.id || 'NO KEY RETURNED'}`)

    } catch (error) {
      console.error('[ZEN X PLAY]', error.message)
      sock.sendMessage(from, {
        text: `❌ Play failed: ${error.message}`,
        quoted: msg
      }).catch(() => {})
    }
  }
}
