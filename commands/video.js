'use strict'

const knightApi = require('../lib/knightapi')
// ════════════════════════════════════════════════════════════════════
//  commands/video.js  —  ZENX  |  🎬 YouTube Video Downloader
//  Usage: .video <song / video name | YouTube link> [--360|--480|--720|--1080]
//         .video --check            (tests every download source)
//  Aliases: .ytv  .ytmp4  .playvid     Reaction: 🎬 → ✅   Category: media
//
//  FLOW:  find the video (name search or link) → send an info card with the
//         thumbnail → download the MP4 → send it (as a document if it is big).
//
//  DOWNLOAD SOURCES (tried in this order, first one that works wins):
//    1. KnightBot API   — https://knightbotapi.stream   (enabled by .env, see below)
//    2. Gifted API      — /api/download/ytvideo         (free, key "gifted")
//    3. ruhend-scraper  — only if you ran:  npm i ruhend-scraper
//
//  ── TURN ON KNIGHTBOT ───────────────────────────────────────────────
//  The KnightBot site draws its endpoint list with JavaScript, so the exact
//  path could not be read automatically. Open https://knightbotapi.stream, press
//  Ctrl+K, search "youtube" / "ytmp4", and copy the path from the example URL.
//  Then add to .env (example — use the REAL path from the site):
//      KNIGHT_VIDEO_PATH=/api/download/ytmp4
//      KNIGHT_VIDEO_PARAM=url           # the query-parameter name that carries the link
//      KNIGHT_API_KEY=knight            # default
//  Restart the bot and run  .video --check  to confirm it says ✅.
//
//  OTHER .env SETTINGS (all optional):
//      VIDEO_QUALITY=720      default quality
//      VIDEO_MAX_MIN=20       refuse videos longer than this many minutes
//      VIDEO_AS_VIDEO_MB=60   up to this size → normal video message
//      VIDEO_MAX_MB=150       up to this size → document; above → refused
//      BOT_CREDIT=...         footer text
// ════════════════════════════════════════════════════════════════════

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)
const num = (k, d) => { const n = parseFloat(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d }
const CFG = {
  knightBase:  () => env('KNIGHT_API_BASE', 'https://knightbotapi.stream').replace(/\/+$/, ''),
  knightKey:   () => env('KNIGHT_API_KEY', 'knight'),
  knightPath:  () => env('KNIGHT_VIDEO_PATH', ''),
  knightParam: () => env('KNIGHT_VIDEO_PARAM', 'url'),
  giftedBase:  () => env('GIFTED_API_BASE', 'https://api.gifted.co.ke').replace(/\/+$/, ''),
  giftedKey:   () => env('GIFTED_API_KEY', 'gifted'),
  quality:     () => String(env('VIDEO_QUALITY', '720')),
  maxMin:      () => num('VIDEO_MAX_MIN', 20),
  asVideoMB:   () => num('VIDEO_AS_VIDEO_MB', 60),
  maxMB:       () => num('VIDEO_MAX_MB', 150),
}

const warn = (...a) => console.warn('[VIDEO]', ...a)
const log  = (...a) => console.log('[VIDEO]', ...a)

// ── professional layout ──────────────────────────────────────────────
const box = (title, lines) =>
  `╔══════════════════════════════╗\n║  ${title}\n╚══════════════════════════════╝\n\n${lines.join('\n')}\n\n${CREDIT}`

const TITLE = '🎬  *VIDEO DOWNLOADER*'

const USAGE = box(TITLE, [
  '❌ *No video name or link given!*',
  '',
  '📌 *Usage:*',
  '  _.video <name or YouTube link>_',
  '  _.ytv <name or YouTube link>_',
  '',
  '⚙️ *Quality (optional):*',
  '  _.video <name> --360_  ·  _--480_  ·  _--720_  ·  _--1080_',
  '',
  '🔥 *Examples:*',
  '  _.video burna boy last last_',
  '  _.video https://youtu.be/dQw4w9WgXcQ --480_',
])

// ── small helpers ────────────────────────────────────────────────────
const fmtDur = s => {
  s = Math.round(Number(s) || 0)
  if (!s) return 'Unknown'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`
}
const parseDur = str => {
  if (!str) return 0
  return String(str).split(':').map(Number).reduce((a, p) => a * 60 + (p || 0), 0)
}
const fmtMB = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim()
const fileSafe = s => clean(s).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'video'

const YT_ID = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/i
const idFromUrl = u => (String(u).match(YT_ID) || [])[1] || null

async function getText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 12000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ════════════════════════════════════════════════════════════════════
//  FIND THE VIDEO  (name → YouTube search · link → oEmbed)
// ════════════════════════════════════════════════════════════════════

function parseYtResults(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
            html.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/)
  if (!m) return []
  let data
  try { data = JSON.parse(m[1]) } catch { return [] }
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
  const out = []
  for (const sec of sections) {
    for (const it of sec?.itemSectionRenderer?.contents || []) {
      const v = it?.videoRenderer
      if (!v?.videoId || !v.lengthText?.simpleText) continue          // skip live streams / ads
      out.push({
        id: v.videoId,
        title: clean((v.title?.runs || []).map(r => r.text).join('')),
        channel: clean(v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text),
        duration: parseDur(v.lengthText.simpleText),
        views: clean(v.viewCountText?.simpleText || v.shortViewCountText?.simpleText),
        ago: clean(v.publishedTimeText?.simpleText),
      })
    }
  }
  return out
}

async function searchYouTube(query) {
  // 1) yt-search, if your bot already has it
  try {
    const yts = require('yt-search')
    const r = await yts(query)
    const v = (r.videos || []).find(x => x.seconds)
    if (v) return { id: v.videoId, title: clean(v.title), channel: clean(v.author?.name), duration: v.seconds, views: v.views ? Number(v.views).toLocaleString('en-US') : '', ago: clean(v.ago) }
  } catch {}
  // 2) built-in: read YouTube's own results page (no key, no package)
  const html = await getText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`,
    { headers: { Cookie: 'CONSENT=YES+cb; SOCS=CAI' } }
  )
  return parseYtResults(html)[0] || null
}

async function resolveVideo(query) {
  const id = idFromUrl(query)
  if (id) {
    const meta = { id, title: '', channel: '', duration: 0, views: '', ago: '' }
    try {
      const j = JSON.parse(await getText(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`, { timeout: 8000 }))
      meta.title = clean(j.title); meta.channel = clean(j.author_name)
    } catch (e) { warn(`oEmbed failed: ${e.message}`) }
    return meta
  }
  return searchYouTube(query)
}

// ════════════════════════════════════════════════════════════════════
//  DOWNLOAD SOURCES
// ════════════════════════════════════════════════════════════════════

const PREF_KEYS = ['download_url', 'downloadUrl', 'download', 'dl', 'url', 'link', 'video', 'mp4', 'result', 'data']
const BAD_URL = /(youtube\.com|youtu\.be)\/(watch|shorts|embed|live)|\.(jpe?g|png|webp|gif)(\?|$)/i

// walks any JSON shape and returns the first link that looks like a file, never a page/thumbnail
function findFileUrl(o, depth = 0) {
  if (o == null || depth > 5) return null
  if (typeof o === 'string') return /^https?:\/\//i.test(o) && !BAD_URL.test(o) ? o : null
  if (Array.isArray(o)) { for (const x of o) { const u = findFileUrl(x, depth + 1); if (u) return u } return null }
  if (typeof o === 'object') {
    for (const k of PREF_KEYS) if (o[k] !== undefined) { const u = findFileUrl(o[k], depth + 1); if (u) return u }
    for (const v of Object.values(o)) { const u = findFileUrl(v, depth + 1); if (u) return u }
  }
  return null
}

async function callJsonApi(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' }, signal: AbortSignal.timeout(45000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = String(res.headers.get('content-type') || '')
  if (/^video\//i.test(ct)) return { directBody: res }                  // API streamed the file itself
  let j
  try { j = await res.json() } catch { throw new Error('not JSON') }
  if (j && (j.success === false || j.status === false)) throw new Error(String(j.message || j.error || 'API reported failure').slice(0, 80))
  const fileUrl = findFileUrl(j)
  if (!fileUrl) throw new Error('no download link in response')
  return { fileUrl, meta: j }
}

const SOURCES = [
  {
    name: 'KnightBot API',
    enabled: () => !!CFG.knightPath(),
    get: async (ytUrl, quality) => {
      const q = String(quality)
      const format = /p$/i.test(q) ? q : `${q}p`
      const media = await knightApi.getVideo(ytUrl, { format })
      return { fileUrl: media.download, meta: media.raw }
    },
  },
  {
    name: 'Gifted API',
    enabled: () => true,
    get: (ytUrl, quality) =>
      callJsonApi(`${CFG.giftedBase()}/api/download/ytvideo?apikey=${encodeURIComponent(CFG.giftedKey())}&url=${encodeURIComponent(ytUrl)}&quality=${quality}`),
  },
  {
    name: 'ruhend-scraper',
    enabled: () => { try { require.resolve('ruhend-scraper'); return true } catch { return false } },
    get: async ytUrl => {
      const { ytmp4 } = require('ruhend-scraper')
      const d = await ytmp4(ytUrl)
      const fileUrl = findFileUrl(d?.video)
      if (!fileUrl) throw new Error('no video link')
      return { fileUrl, meta: d }
    },
  },
]

class TooBig extends Error { constructor(bytes) { super(`file is ${fmtMB(bytes)}`); this.bytes = bytes } }

// downloads into memory with a hard size limit (never trusts Content-Length alone)
async function downloadFile(resOrUrl, maxBytes) {
  const res = typeof resOrUrl === 'string'
    ? await fetch(resOrUrl, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(240000) })
    : resOrUrl.directBody
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length')) || 0
  if (declared > maxBytes) throw new TooBig(declared)

  const chunks = []
  let size = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) { try { await reader.cancel() } catch {} ; throw new TooBig(size) }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)))
  if (buf.length < 20000) throw new Error('file too small to be a video')
  const isMp4 = buf.toString('ascii', 4, 8) === 'ftyp'
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
  if (!isMp4 && !isWebm) throw new Error('download was not a video file')
  return { buf, mime: isMp4 ? 'video/mp4' : 'video/webm', ext: isMp4 ? 'mp4' : 'webm' }
}

// try each source; step down to 360p once if the file is too big
async function fetchVideo(ytUrl, wantQuality) {
  const maxBytes = CFG.maxMB() * 1024 * 1024
  const qualities = [...new Set([wantQuality, '360'])]
  const errors = []
  for (const src of SOURCES) {
    if (!src.enabled()) continue
    for (const q of qualities) {
      try {
        const got = await src.get(ytUrl, q)
        const file = await downloadFile(got.fileUrl || got, maxBytes)
        log(`${src.name}: ${fmtMB(file.buf.length)} @${q}p`)
        return { ...file, source: src.name, quality: q, meta: got.meta }
      } catch (e) {
        errors.push(`${src.name}@${q}: ${e.message}`)
        if (!(e instanceof TooBig) || q === '360') break               // only retry smaller on "too big"
      }
    }
  }
  const err = new Error(errors.join(' | ') || 'no download source is enabled')
  err.all = errors
  throw err
}

// ── .video --check ───────────────────────────────────────────────────
async function runCheck() {
  const test = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const lines = []
  for (const src of SOURCES) {
    if (!src.enabled()) {
      lines.push(src.name === 'KnightBot API'
        ? `⚪ *${src.name}* — off (set KNIGHT_VIDEO_PATH in .env to enable)`
        : `⚪ *${src.name}* — not installed`)
      continue
    }
    const t = Date.now()
    try {
      const got = await src.get(test, '360')
      let note = ''
      if (got.fileUrl) {
        const r = await fetch(got.fileUrl, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
        if (!r.ok && r.status !== 206) throw new Error(`link answered HTTP ${r.status}`)
        const total = (r.headers.get('content-range') || '').split('/')[1] || r.headers.get('content-length')
        note = total && Number(total) > 1 ? `, file ≈ ${fmtMB(Number(total))}` : ''
        try { await r.body?.cancel() } catch {}
      }
      lines.push(`✅ *${src.name}* — link OK${note} (${Date.now() - t}ms)`)
    } catch (e) {
      lines.push(`❌ *${src.name}* — ${e.message} (${Date.now() - t}ms)`)
    }
  }
  try {
    const f = await searchYouTube('rick astley never gonna give you up')
    lines.push(f ? `✅ *YouTube search* — found “${f.title.slice(0, 40)}”` : '❌ *YouTube search* — nothing found')
  } catch (e) { lines.push(`❌ *YouTube search* — ${e.message}`) }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
//  the command
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  'video',
  alias:    ['ytv', 'ytmp4', 'playvid'],
  category: 'media',
  desc:     'Download a YouTube video by name or link',
  usage:    '.video <name or link> [--360|--480|--720|--1080]',

  run: async ({ sock, from, msg, args, text }) => {
    const react = emoji => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {})
    const reply = body => sock.sendMessage(from, { text: body }, { quoted: msg })

    let raw = String(text || args?.join(' ') || '').trim()
    if (!raw) return reply(USAGE)

    if (raw.toLowerCase() === '--check') {
      void react('🔎')
      return reply(box('🔎  *VIDEO SOURCE CHECK*', [await runCheck()]))
    }

    // quality flag
    let quality = CFG.quality()
    const qm = raw.match(/(?:^|\s)--?(360|480|720|1080)p?(?=\s|$)/i)
    if (qm) { quality = qm[1]; raw = raw.replace(qm[0], ' ').trim() }
    if (!raw) return reply(USAGE)

    void react('🎬')

    // 1 ── find it
    let video
    try { video = await resolveVideo(raw) } catch (e) { warn(`search failed: ${e.message}`) }
    if (!video) {
      void react('❌')
      return reply(box(TITLE, [`❌ *No video found for:* _"${raw}"_`, '💡 Try different keywords or paste the YouTube link']))
    }

    const ytUrl = `https://www.youtube.com/watch?v=${video.id}`
    if (video.duration && video.duration > CFG.maxMin() * 60) {
      void react('❌')
      return reply(box(TITLE, [
        `❌ *Too long:* ${fmtDur(video.duration)}`,
        `📏 Limit is ${CFG.maxMin()} minutes per video`,
        `🔗 ${ytUrl}`,
      ]))
    }

    // 2 ── info card with thumbnail
    const card = box(TITLE, [
      `📌 *Title:* ${video.title || 'Unknown'}`,
      `👤 *Channel:* ${video.channel || 'Unknown'}`,
      `⏱️ *Duration:* ${fmtDur(video.duration)}`,
      video.views ? `👁️ *Views:* ${video.views}` : null,
      video.ago ? `📅 *Published:* ${video.ago}` : null,
      `🎞️ *Quality:* ${quality}p`,
      `🔗 ${ytUrl}`,
      '',
      '⏳ _Downloading your video, please wait…_',
    ].filter(x => x !== null))
    try {
      await sock.sendMessage(from, { image: { url: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` }, caption: card }, { quoted: msg })
    } catch { await reply(card) }

    // 3 ── download
    let file
    try { file = await fetchVideo(ytUrl, quality) } catch (e) {
      warn(`download failed: ${e.message}`)
      void react('❌')
      const tooBig = /file is [\d.]+ MB/.test(e.message)
      return reply(box(TITLE, [
        tooBig ? `❌ *This video is too large to send* (limit ${CFG.maxMB()} MB)` : '❌ *Could not download this video*',
        tooBig ? '💡 Try a lower quality, e.g. _--360_' : '💡 Try again in a moment, or run _.video --check_ to see which sources are down',
        `🔗 ${ytUrl}`,
      ]))
    }

    // 4 ── send
    const title = video.title || clean(file.meta?.title) || 'YouTube video'
    const caption = `🎬 *${title}*\n\n👤 ${video.channel || 'YouTube'}  •  ⏱️ ${fmtDur(video.duration)}  •  🎞️ ${file.quality}p  •  💾 ${fmtMB(file.buf.length)}\n\n${CREDIT}`
    const asVideo = file.buf.length <= CFG.asVideoMB() * 1024 * 1024 && file.mime === 'video/mp4'
    try {
      if (asVideo) {
        await sock.sendMessage(from, { video: file.buf, mimetype: 'video/mp4', caption, fileName: `${fileSafe(title)}.mp4` }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { document: file.buf, mimetype: file.mime, fileName: `${fileSafe(title)}.${file.ext}`, caption }, { quoted: msg })
      }
    } catch (e) {
      warn(`send failed: ${e.message}`)
      void react('❌')
      return reply(box(TITLE, ['❌ *The video downloaded but could not be sent*', `💡 ${String(e.message).slice(0, 80)}`]))
    }
    void react('✅')
  },
}

Object.defineProperty(module.exports, '_test', {
  value: { parseYtResults, findFileUrl, fetchVideo, resolveVideo, runCheck, idFromUrl, fmtDur, SOURCES },
  enumerable: false,
})
