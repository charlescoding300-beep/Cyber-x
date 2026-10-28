'use strict'

const knightApi = require('../lib/knightapi')
// ════════════════════════════════════════════════════════════════════
//  commands/youtube.js  —  ZENX  |  ▶️ YouTube Link Downloader
//  Usage: .youtube <link>                 → the video (MP4)
//         .youtube <link> --audio         → just the sound (MP3)      (--mp3 · -a)
//         .youtube <link> --480           → pick quality: 360 · 480 · 720 · 1080
//         .youtube <link> --doc           → send as a document (keeps full quality)
//         (reply to ANY message that contains a link with  .youtube  — no pasting needed)
//         .youtube --check                → tests every download source
//  Aliases: .yt  .ytdl  .ytlink  .yta     Reaction: ▶️ → ✅   Category: media
//
//  .video  = search by NAME.     .youtube = paste a LINK.
//  Understands: watch?v= · youtu.be · shorts · live · embed · music.youtube.com
//
//  SOURCES (first that works wins):
//    VIDEO  1. KnightBot API (KNIGHT_VIDEO_PATH)   2. Gifted API ytvideo   3. ruhend-scraper (npm i ruhend-scraper)
//    AUDIO  1. KnightBot API (KNIGHT_AUDIO_PATH)   2. Gifted API ytmp3
//
//  KNIGHTBOT: its site draws the endpoint list with JavaScript, so the paths could not be
//  read automatically. Open https://knightbotapi.stream → Ctrl+K → search "youtube" / "mp3" and
//  copy the path from the example URL into .env (these are EXAMPLES — use the real ones):
//      KNIGHT_VIDEO_PATH=/api/download/ytmp4
//      KNIGHT_AUDIO_PATH=/api/download/ytaudio
//      KNIGHT_VIDEO_PARAM=url        KNIGHT_API_KEY=knight
//
//  OPTIONAL .env: VIDEO_QUALITY=720 · VIDEO_MAX_MIN=30 · VIDEO_AS_VIDEO_MB=60 · VIDEO_MAX_MB=150 · BOT_CREDIT=...
// ════════════════════════════════════════════════════════════════════

const CREDIT = '> ' + (process.env.BOT_CREDIT || '© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d)
const num = (k, d) => { const n = parseFloat(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d }
const CFG = {
  knightBase:  () => env('KNIGHT_API_BASE', 'https://knightbotapi.stream').replace(/\/+$/, ''),
  knightKey:   () => env('KNIGHT_API_KEY', 'knight'),
  knightVideo: () => env('KNIGHT_VIDEO_PATH', ''),
  knightAudio: () => env('KNIGHT_AUDIO_PATH', ''),
  knightParam: () => env('KNIGHT_VIDEO_PARAM', 'url'),
  giftedBase:  () => env('GIFTED_API_BASE', 'https://api.gifted.co.ke').replace(/\/+$/, ''),
  giftedKey:   () => env('GIFTED_API_KEY', 'gifted'),
  quality:     () => String(env('VIDEO_QUALITY', '720')),
  maxMin:      () => num('VIDEO_MAX_MIN', 30),
  asVideoMB:   () => num('VIDEO_AS_VIDEO_MB', 60),
  maxMB:       () => num('VIDEO_MAX_MB', 150),
}
const warn = (...a) => console.warn('[YOUTUBE]', ...a)
const log  = (...a) => console.log('[YOUTUBE]', ...a)

// ── professional layout ──────────────────────────────────────────────
const box = (title, lines) =>
  `╔══════════════════════════════╗\n║  ${title}\n╚══════════════════════════════╝\n\n${lines.join('\n')}\n\n${CREDIT}`
const TITLE = '▶️  *YOUTUBE DOWNLOADER*'

const USAGE = box(TITLE, [
  '❌ *No YouTube link found!*',
  '',
  '📌 *Usage:*',
  '  _.youtube <link>_  → video',
  '  _.youtube <link> --audio_  → MP3',
  '  _.yt <link> --480_  → choose quality',
  '  _Reply to a message with a link and send_ _.yt_',
  '',
  '🔥 *Example:*',
  '  _.youtube https://youtu.be/dQw4w9WgXcQ_',
  '',
  '🔎 _To search by name use_ _.video <name>_',
])

// ── helpers ──────────────────────────────────────────────────────────
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim()
const fileSafe = s => clean(s).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'youtube'
const fmtMB = b => `${(b / 1024 / 1024).toFixed(1)} MB`
const fmtDur = s => {
  s = Math.round(Number(s) || 0)
  if (!s) return 'Unknown'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`
}
const fmtViews = n => { n = Number(n); return n ? n.toLocaleString('en-US') : '' }

const YT_ID  = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/i
const YT_URL = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"']+/i
const idFromUrl = u => (String(u).match(YT_ID) || [])[1] || null

// the text of whatever message was replied to
function quotedText(msg) {
  const ctx = msg?.message?.extendedTextMessage?.contextInfo
  const q = ctx?.quotedMessage
  if (!q) return ''
  return q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || ''
}

async function getText(url, headers = {}, timeout = 10000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers }, signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ── video details (title/channel from oEmbed, length/views/date from the watch page) ──
async function getDetails(id) {
  const d = { id, title: '', channel: '', duration: 0, views: '', date: '', live: false }
  const watch = `https://www.youtube.com/watch?v=${id}`
  const [oe, page] = await Promise.allSettled([
    getText(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, {}, 8000),
    getText(watch, { Cookie: 'CONSENT=YES+cb; SOCS=CAI' }, 9000),
  ])
  if (oe.status === 'fulfilled') {
    try { const j = JSON.parse(oe.value); d.title = clean(j.title); d.channel = clean(j.author_name) } catch {}
  } else warn(`oEmbed: ${oe.reason?.message}`)
  if (page.status === 'fulfilled') {
    const h = page.value
    d.duration = Number((h.match(/"lengthSeconds":"(\d+)"/) || [])[1]) || 0
    d.views = fmtViews((h.match(/"viewCount":"(\d+)"/) || [])[1])
    d.date = (h.match(/"publishDate":"(\d{4}-\d{2}-\d{2})/) || [])[1] || ''
    d.live = /"isLiveContent":true/.test(h) && /"isLive":true/.test(h)
    if (!d.title) d.title = clean(((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/ - YouTube$/, ''))
  } else warn(`watch page: ${page.reason?.message}`)
  return d
}

// ════════════════════════════════════════════════════════════════════
//  DOWNLOAD SOURCES
// ════════════════════════════════════════════════════════════════════

const PREF_KEYS = ['download_url', 'downloadUrl', 'download', 'dl', 'url', 'link', 'audio', 'video', 'mp3', 'mp4', 'result', 'data']
const BAD_URL = /(youtube\.com|youtu\.be)\/(watch|shorts|embed|live)|\.(jpe?g|png|webp|gif)(\?|$)/i

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
  if (/^(video|audio)\//i.test(ct)) return { directBody: res }
  let j
  try { j = await res.json() } catch { throw new Error('not JSON') }
  if (j && (j.success === false || j.status === false)) throw new Error(String(j.message || j.error || 'API reported failure').slice(0, 80))
  const fileUrl = findFileUrl(j)
  if (!fileUrl) throw new Error('no download link in response')
  return { fileUrl, meta: j }
}

const knightUrl = (path, ytUrl, q) =>
  `${CFG.knightBase()}${path}?${CFG.knightParam()}=${encodeURIComponent(ytUrl)}&quality=${q}&apikey=${encodeURIComponent(CFG.knightKey())}`

const SOURCES = {
  video: [
    { name: 'KnightBot API', enabled: () => !!CFG.knightVideo(), get: async (u, q) => { const n = String(q); const format = /p$/i.test(n) ? n : `${n}p`; const media = await knightApi.getVideo(u, { format }); return { fileUrl: media.download, meta: media.raw } } },
    { name: 'Gifted API', enabled: () => true,
      get: (u, q) => callJsonApi(`${CFG.giftedBase()}/api/download/ytvideo?apikey=${encodeURIComponent(CFG.giftedKey())}&url=${encodeURIComponent(u)}&quality=${q}`) },
    { name: 'ruhend-scraper', enabled: () => { try { require.resolve('ruhend-scraper'); return true } catch { return false } },
      get: async u => { const d = await require('ruhend-scraper').ytmp4(u); const f = findFileUrl(d?.video); if (!f) throw new Error('no video link'); return { fileUrl: f, meta: d } } },
  ],
  audio: [
    { name: 'KnightBot API', enabled: () => !!CFG.knightAudio(), get: async (u, q) => { const n = String(q); const format = /kbps$/i.test(n) ? n : `${n}kbps`; const media = await knightApi.getAudio(u, { format }); return { fileUrl: media.download, meta: media.raw } } },
    { name: 'Gifted API', enabled: () => true,
      get: (u, q) => callJsonApi(`${CFG.giftedBase()}/api/download/ytmp3?apikey=${encodeURIComponent(CFG.giftedKey())}&url=${encodeURIComponent(u)}&quality=${q}`) },
  ],
}

class TooBig extends Error { constructor(b) { super(`file is ${fmtMB(b)}`); this.bytes = b } }

function sniffMedia(buf, kind) {
  const ascii = (a, b) => buf.toString('ascii', a, b)
  if (kind === 'video') {
    if (ascii(4, 8) === 'ftyp') return { mime: 'video/mp4', ext: 'mp4' }
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', ext: 'webm' }
    return null
  }
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' }
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' }
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg; codecs=opus', ext: 'ogg' }
  return null
}

async function downloadFile(src, kind, maxBytes) {
  const res = typeof src === 'string'
    ? await fetch(src, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(240000) })
    : src.directBody
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
  if (buf.length < (kind === 'audio' ? 8000 : 20000)) throw new Error('file too small to be real')
  const type = sniffMedia(buf, kind)
  if (!type) throw new Error(`download was not a ${kind} file`)
  return { buf, ...type }
}

async function fetchMedia(ytUrl, kind, wantQuality) {
  const maxBytes = CFG.maxMB() * 1024 * 1024
  const qualities = kind === 'audio' ? [wantQuality] : [...new Set([wantQuality, '360'])]
  const errors = []
  for (const s of SOURCES[kind]) {
    if (!s.enabled()) continue
    for (const q of qualities) {
      try {
        const got = await s.get(ytUrl, q)
        const file = await downloadFile(got.fileUrl || got, kind, maxBytes)
        log(`${s.name}: ${kind} ${fmtMB(file.buf.length)} @${q}`)
        return { ...file, source: s.name, quality: q, meta: got.meta }
      } catch (e) {
        errors.push(`${s.name}@${q}: ${e.message}`)
        if (!(e instanceof TooBig) || q === '360') break
      }
    }
  }
  const err = new Error(errors.join(' | ') || 'no download source is enabled')
  throw err
}

async function runCheck() {
  const test = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  const lines = []
  for (const kind of ['video', 'audio']) {
    for (const s of SOURCES[kind]) {
      const label = `${kind === 'video' ? '🎞️' : '🎧'} *${s.name}* (${kind})`
      if (!s.enabled()) { lines.push(`⚪ ${label} — ${s.name === 'KnightBot API' ? 'off (set KNIGHT_' + kind.toUpperCase() + '_PATH)' : 'not installed'}`); continue }
      const t = Date.now()
      try {
        const got = await s.get(test, kind === 'audio' ? '128' : '360')
        let note = ''
        if (got.fileUrl) {
          const r = await fetch(got.fileUrl, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
          if (!r.ok && r.status !== 206) throw new Error(`link answered HTTP ${r.status}`)
          const total = (r.headers.get('content-range') || '').split('/')[1] || r.headers.get('content-length')
          note = total && Number(total) > 1 ? `, ≈ ${fmtMB(Number(total))}` : ''
          try { await r.body?.cancel() } catch {}
        }
        lines.push(`✅ ${label} — OK${note} (${Date.now() - t}ms)`)
      } catch (e) { lines.push(`❌ ${label} — ${e.message} (${Date.now() - t}ms)`) }
    }
  }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
//  the command
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  'youtube',
  alias:    ['yt', 'ytdl', 'ytlink', 'yta'],
  category: 'media',
  desc:     'Paste a YouTube link and get the video (or MP3)',
  usage:    '.youtube <link> [--audio] [--360|--480|--720|--1080] [--doc]',

  run: async ({ sock, from, msg, args, text, command }) => {
    const react = e => sock.sendMessage(from, { react: { text: e, key: msg.key } }).catch(() => {})
    const reply = body => sock.sendMessage(from, { text: body }, { quoted: msg })

    let raw = String(text || args?.join(' ') || '').trim()

    if (raw.toLowerCase() === '--check') {
      void react('🔎')
      return reply(box('🔎  *YOUTUBE SOURCE CHECK*', [await runCheck()]))
    }

    // flags
    let kind = /^(yta)$/i.test(String(command || '')) ? 'audio' : 'video'
    if (/(?:^|\s)(--?(?:audio|mp3|a))(?=\s|$)/i.test(raw)) { kind = 'audio'; raw = raw.replace(/(?:^|\s)--?(?:audio|mp3|a)(?=\s|$)/ig, ' ') }
    let asDoc = false
    if (/(?:^|\s)--?(?:doc|document)(?=\s|$)/i.test(raw)) { asDoc = true; raw = raw.replace(/(?:^|\s)--?(?:doc|document)(?=\s|$)/ig, ' ') }
    let quality = kind === 'audio' ? '128' : CFG.quality()
    const qm = raw.match(/(?:^|\s)--?(360|480|720|1080)p?(?=\s|$)/i)
    if (qm) { if (kind === 'video') quality = qm[1]; raw = raw.replace(qm[0], ' ') }
    if (/(?:^|\s)--?(?:hq|320)(?=\s|$)/i.test(raw) && kind === 'audio') { quality = '320'; raw = raw.replace(/(?:^|\s)--?(?:hq|320)(?=\s|$)/ig, ' ') }

    // the link: typed in the command, or inside the message that was replied to
    const urlMatch = raw.match(YT_URL) || quotedText(msg).match(YT_URL)
    if (!urlMatch) return reply(USAGE)
    const id = idFromUrl(urlMatch[0])
    if (!id) {
      return reply(box(TITLE, [
        '❌ *That link has no single video in it*',
        /[?&]list=/.test(urlMatch[0]) ? '📚 Playlists are not supported — send the link of one video' : '💡 Send a full video link, e.g. _youtu.be/xxxxxxxxxxx_',
      ]))
    }
    const ytUrl = `https://www.youtube.com/watch?v=${id}`

    void react('▶️')

    // 1 ── details + safety checks
    const d = await getDetails(id)
    if (d.live) {
      void react('❌')
      return reply(box(TITLE, ['❌ *This is a live stream*', '💡 Live streams cannot be downloaded — try again after it ends', `🔗 ${ytUrl}`]))
    }
    if (d.duration && d.duration > CFG.maxMin() * 60) {
      void react('❌')
      return reply(box(TITLE, [`❌ *Too long:* ${fmtDur(d.duration)}`, `📏 Limit is ${CFG.maxMin()} minutes per ${kind}`, `🔗 ${ytUrl}`]))
    }

    // 2 ── info card
    const fmtLine = kind === 'audio' ? `🎧 *Format:* MP3 · ${quality} kbps` : `🎞️ *Format:* MP4 · ${quality}p${asDoc ? ' · document' : ''}`
    const card = box(TITLE, [
      `📌 *Title:* ${d.title || 'Unknown'}`,
      `👤 *Channel:* ${d.channel || 'Unknown'}`,
      `⏱️ *Duration:* ${fmtDur(d.duration)}`,
      d.views ? `👁️ *Views:* ${d.views}` : null,
      d.date ? `📅 *Published:* ${d.date}` : null,
      fmtLine,
      `🔗 ${ytUrl}`,
      '',
      `⏳ _Getting your ${kind === 'audio' ? 'audio' : 'video'}, please wait…_`,
    ].filter(x => x !== null))
    try {
      await sock.sendMessage(from, { image: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }, caption: card }, { quoted: msg })
    } catch { await reply(card) }

    // 3 ── download
    let file
    try { file = await fetchMedia(ytUrl, kind, quality) } catch (e) {
      warn(`download failed: ${e.message}`)
      void react('❌')
      const tooBig = /file is [\d.]+ MB/.test(e.message)
      return reply(box(TITLE, [
        tooBig ? `❌ *Too large to send* (limit ${CFG.maxMB()} MB)` : `❌ *Could not download this ${kind}*`,
        tooBig ? '💡 Try a lower quality, e.g. _--360_, or use _--audio_' : '💡 Try again in a moment, or run _.youtube --check_ to see which sources are down',
        `🔗 ${ytUrl}`,
      ]))
    }

    // 4 ── send
    const title = d.title || clean(file.meta?.title) || 'YouTube'
    const size = fmtMB(file.buf.length)
    const caption = `${kind === 'audio' ? '🎧' : '🎬'} *${title}*\n\n👤 ${d.channel || 'YouTube'}  •  ⏱️ ${fmtDur(d.duration)}  •  ${kind === 'audio' ? file.ext.toUpperCase() : file.quality + 'p'}  •  💾 ${size}\n\n${CREDIT}`
    try {
      if (kind === 'audio') {
        await sock.sendMessage(from, { audio: file.buf, mimetype: file.mime, fileName: `${fileSafe(title)}.${file.ext}`, ptt: false }, { quoted: msg })
        await sock.sendMessage(from, { text: caption })
      } else if (!asDoc && file.mime === 'video/mp4' && file.buf.length <= CFG.asVideoMB() * 1024 * 1024) {
        await sock.sendMessage(from, { video: file.buf, mimetype: 'video/mp4', caption, fileName: `${fileSafe(title)}.mp4` }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { document: file.buf, mimetype: file.mime, fileName: `${fileSafe(title)}.${file.ext}`, caption }, { quoted: msg })
      }
    } catch (e) {
      warn(`send failed: ${e.message}`)
      void react('❌')
      return reply(box(TITLE, [`❌ *Downloaded but could not be sent*`, `💡 ${String(e.message).slice(0, 80)}`]))
    }
    void react('✅')
  },
}

Object.defineProperty(module.exports, '_test', {
  value: { idFromUrl, quotedText, getDetails, fetchMedia, runCheck, sniffMedia, YT_URL },
  enumerable: false,
})
