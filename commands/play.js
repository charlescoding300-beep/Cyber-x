'use strict'

// 𓃦 𝗭Ξ𝗡 𝗫 — .play  (also answers to .song and .ytplay)
//
// HOW IT DOWNLOADS (each step only runs if the one before failed):
//   1) 5 community APIs + any of yours, all asked AT ONCE — first real audio file wins
//   2) yt-dlp on your own server   (needs: yt-dlp, and ideally Deno + cookies.txt)
//   3) @vreden/youtube_scraper     (optional:  npm i @vreden/youtube_scraper)
//
// WHEN IT FAILS it now tells you WHY for every source, right in WhatsApp.
//
// OWNER DIAGNOSTICS:   .play check
//   tests every source live and reports ✅/❌ + what your server has installed.
//
// ADD YOUR OWN MP3 API without editing code — in .env:
//   YT_MP3_APIS=https://host-a/path?url={url}|https://host-b/path?link={url}
//   (YT_COOKIES=/path/cookies.txt and YTDLP_EXTRA=... are also read by the yt-dlp step)
//   ALYA_API_KEY=your-own-key   (the built-in one is the original author's shared key)
//
// FIXING yt-dlp's "Sign in to confirm you're not a bot":
//   yt-dlp -U   ·   install Deno (curl -fsSL https://deno.land/install.sh | sh)
//   ·   put a cookies.txt (exported from a logged-in browser) in the bot's root folder

const axios = require('axios')
const yts = require('yt-search')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

let libConverter = null
try { libConverter = require('../lib/converter') } catch {}

const TAG = '[ZEN X PLAY]'
const API_TIMEOUT_MS = 30000
const API_TIER_DEADLINE_MS = 35000
const CHECK_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw' // "Me at the zoo" — 19s, always there

// Alya key from the command you pasted (shared by its original author — it can be
// revoked any time). Put your own in .env as ALYA_API_KEY.
const ALYA_KEY = process.env.ALYA_API_KEY || 'G7I6X7'

const AXIOS_DEFAULTS = {
  timeout: API_TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*'
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label = 'operation') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function shortReason(err) {
  const m = String(err?.message || err || '')
  const code = err?.code
  if (code === 'ENOTFOUND' || /ENOTFOUND/.test(m)) return 'host not found (API is dead)'
  if (code === 'ECONNREFUSED') return 'connection refused'
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timed? ?out/i.test(m)) return 'timed out'
  const st = err?.response?.status
  if (st) return `HTTP ${st}`
  if (/certificate|CERT_/i.test(m)) return 'SSL certificate problem'
  return m.replace(/\s+/g, ' ').slice(0, 70)
}

const URL_SKIP_KEYS = /thumb|image|cover|poster|icon|avatar|banner/i
const URL_KEYS = ['download_url', 'downloadUrl', 'downloadURL', 'dl', 'dl_url', 'url', 'link', 'audio', 'mp3', 'result', 'data', 'download', 'media']

// finds an http(s) URL anywhere in an API response, whatever its shape
function pickUrl(node, depth = 0) {
  if (!node || depth > 4) return null
  if (typeof node === 'string') return /^https?:\/\//i.test(node) ? node : null
  if (Array.isArray(node)) {
    for (const n of node) { const u = pickUrl(n, depth + 1); if (u) return u }
    return null
  }
  if (typeof node === 'object') {
    for (const k of URL_KEYS) {
      if (k in node) { const u = pickUrl(node[k], depth + 1); if (u) return u }
    }
    for (const [k, v] of Object.entries(node)) {
      if (URL_SKIP_KEYS.test(k)) continue
      const u = pickUrl(v, depth + 1)
      if (u) return u
    }
  }
  return null
}

// ── download sources: the 5 from the pasted command (response shapes unchanged) ──
const SOURCES = [
  {
    name: 'EliteProTech',
    get: async (url) => {
      const res = await axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, AXIOS_DEFAULTS)
      if (res?.data?.success && res?.data?.downloadURL) return { download: res.data.downloadURL, title: res.data.title }
      throw new Error('no download in response')
    }
  },
  {
    name: 'Yupra',
    get: async (url) => {
      const res = await axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS)
      if (res?.data?.success && res?.data?.data?.download_url) return { download: res.data.data.download_url, title: res.data.data.title }
      throw new Error('no download in response')
    }
  },
  {
    name: 'Okatsu',
    get: async (url) => {
      const res = await axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS)
      if (res?.data?.dl) return { download: res.data.dl, title: res.data.title }
      throw new Error('no download in response')
    }
  },
  {
    name: 'Alya',
    get: async (url) => {
      const res = await axios.get(`https://api.alyachan.pro/api/ytmp3?url=${encodeURIComponent(url)}&apikey=${ALYA_KEY}`, AXIOS_DEFAULTS)
      if (res?.data?.status && res?.data?.data?.url) return { download: res.data.data.url, title: res.data.data.title }
      throw new Error('no download in response')
    }
  },
  {
    name: 'Vreden',
    get: async (url) => {
      const res = await axios.get(`https://api.vreden.my.id/api/ytmp3?url=${encodeURIComponent(url)}`, AXIOS_DEFAULTS)
      if (res?.data?.status && res?.data?.result?.download?.url) {
        return { download: res.data.result.download.url, title: res.data.result.metadata?.title }
      }
      throw new Error('no download in response')
    }
  },
]

// your own endpoints from .env (YT_MP3_APIS), parsed leniently
function customSources() {
  return String(process.env.YT_MP3_APIS || '')
    .split('|').map(s => s.trim()).filter(s => /^https?:\/\//i.test(s))
    .map((tpl, i) => ({
      name: `custom-${i + 1}`,
      get: async (url) => {
        const res = await axios.get(tpl.replace('{url}', encodeURIComponent(url)), AXIOS_DEFAULTS)
        const d = res.data
        if (d?.status === false || d?.success === false) throw new Error(d?.message || d?.error || 'API reported failure')
        const link = pickUrl(d)
        if (!link) throw new Error('no download in response')
        return { download: link, title: d?.title || d?.result?.title || d?.data?.title }
      }
    }))
}

const allSources = () => [...customSources(), ...SOURCES]

// ── audio validation (an HTML/JSON error page can never be sent as a song) ───
function sniffAudio(b) {
  if (!b || b.length < 10000) return null
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return { ext: 'mp3', mime: 'audio/mpeg' }
  if (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return { ext: 'mp3', mime: 'audio/mpeg' }
  if (b.slice(4, 8).toString('latin1') === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' }
  if (b.slice(0, 4).toString('latin1') === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' }
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { ext: 'webm', mime: 'audio/webm' }
  if (b.slice(0, 4).toString('latin1') === 'RIFF') return { ext: 'wav', mime: 'audio/wav' }
  return null
}

async function fetchAudio(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 100 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  })
  const buf = Buffer.from(res.data)
  const kind = sniffAudio(buf)
  if (!kind) throw new Error(`link didn't return audio (${buf.length} bytes)`)
  return { buf, ...kind }
}

// ── STEP 1: all APIs at once, answers handled in arrival order ───────────────
async function* answersAsTheyArrive(url, failures) {
  const pending = new Map()
  const sources = allSources()
  sources.forEach((src, i) => {
    pending.set(i, src.get(url).then(
      data => ({ i, name: src.name, data }),
      err => ({ i, name: src.name, error: err })
    ))
  })

  const deadline = Date.now() + API_TIER_DEADLINE_MS
  while (pending.size) {
    const left = deadline - Date.now()
    const timeout = new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), Math.max(left, 0)))
    const r = await Promise.race([...pending.values(), timeout])

    if (r.timedOut) {
      for (const i of pending.keys()) failures.push({ src: sources[i].name, reason: 'no answer in time' })
      return
    }
    pending.delete(r.i)
    if (r.error) {
      failures.push({ src: r.name, reason: shortReason(r.error) })
      console.log(`${TAG} ${r.name} failed: ${shortReason(r.error)}`)
      continue
    }
    if (r.data?.download) yield r
  }
}

async function downloadViaApis(url, failures) {
  for await (const r of answersAsTheyArrive(url, failures)) {
    try {
      const file = await fetchAudio(r.data.download)
      console.log(`${TAG} ✔ audio via ${r.name} (${(file.buf.length / 1e6).toFixed(2)}MB, ${file.ext})`)
      return { ...file, title: r.data.title, via: r.name }
    } catch (e) {
      failures.push({ src: r.name, reason: shortReason(e) })
      console.log(`${TAG} ${r.name} gave a link but the file was unusable: ${e.message}`)
    }
  }
  return null
}

// ── STEP 2: yt-dlp on this server ────────────────────────────────────────────
function ytdlpArgs() {
  const args = ['--no-playlist', '--no-warnings', '--force-ipv4']

  const candidates = [
    process.env.YT_COOKIES,
    path.join(__dirname, '..', 'cookies.txt'),
    path.join(process.cwd(), 'cookies.txt'),
  ].filter(Boolean)
  const cookies = candidates.find(p => { try { return fs.existsSync(p) } catch { return false } })
  if (cookies) args.push('--cookies', cookies)

  const extra = String(process.env.YTDLP_EXTRA || '').trim()
  if (extra) args.push(...extra.split(/\s+/))
  return args
}

function ytdlpReason(e) {
  if (e?.code === 'ENOENT') return 'not installed on this server'
  const t = `${e?.stderr || ''} ${e?.message || ''}`
  if (/not a bot|Sign in to confirm/i.test(t)) return "YouTube's bot check blocked this server (needs cookies.txt / Deno)"
  if (/JavaScript runtime|js.?runtime|deno/i.test(t)) return 'needs a JS runtime — install Deno'
  if (/ffmpeg|ffprobe/i.test(t)) return 'ffmpeg is missing'
  if (/HTTP Error 403|\b403\b/.test(t)) return 'YouTube answered 403 (blocked)'
  if (/unavailable|private video|age.?restricted|confirm your age/i.test(t)) return 'video unavailable / age-restricted'
  if (/timed? ?out|ETIMEDOUT|killed/i.test(t)) return 'timed out'
  const line = t.split('\n').map(s => s.trim()).filter(Boolean).pop() || 'unknown error'
  return line.replace(/^ERROR:\s*/i, '').slice(0, 80)
}

async function downloadViaYtDlp(url) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zenx-play-'))
  const out = path.join(workDir, 'audio.%(ext)s')
  const opts = { maxBuffer: 10 * 1024 * 1024, timeout: 150000 }
  try {
    try {
      await execFileAsync('yt-dlp', [...ytdlpArgs(), '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', out, url], opts)
    } catch (e) {
      const text = `${e.stderr || ''} ${e.message || ''}`
      if (e.code !== 'ENOENT' && /ffmpeg|ffprobe/i.test(text)) {
        // no ffmpeg → take the native audio stream instead (nothing to convert)
        await execFileAsync('yt-dlp', [...ytdlpArgs(), '-f', 'bestaudio[ext=m4a]/bestaudio', '-o', out, url], opts)
      } else {
        throw e
      }
    }
    const files = await fs.promises.readdir(workDir)
    const file = files.find(f => /\.(mp3|m4a|webm|ogg|opus|wav)$/i.test(f))
    if (!file) throw new Error('yt-dlp produced no audio file')
    const buf = await fs.promises.readFile(path.join(workDir, file))
    const kind = sniffAudio(buf)
    if (!kind) throw new Error('yt-dlp output is not audio')
    return { buf, ...kind }
  } finally {
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── STEP 3: @vreden/youtube_scraper (optional package) ───────────────────────
async function downloadViaVredenPkg(url) {
  let yt
  try { yt = require('@vreden/youtube_scraper') } catch { throw new Error('package not installed') }

  let lastErr = null
  for (const fn of ['ytmp3', 'apimp3']) {
    if (typeof yt[fn] !== 'function') continue
    try {
      const r = await withTimeout(yt[fn](url, 128), 45000, `vreden ${fn}`)
      const dl = r?.download?.url || pickUrl(r?.download) || pickUrl(r)
      if (!dl) throw new Error('no download url in response')
      return await fetchAudio(dl)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('package unavailable')
}

// ── all steps, collecting WHY each one failed ────────────────────────────────
async function downloadAudio(url) {
  const failures = []

  const viaApi = await downloadViaApis(url, failures)
  if (viaApi) return viaApi

  try {
    const file = await downloadViaYtDlp(url)
    console.log(`${TAG} ✔ audio via yt-dlp (${(file.buf.length / 1e6).toFixed(2)}MB, ${file.ext})`)
    return { ...file, via: 'yt-dlp' }
  } catch (e) {
    failures.push({ src: 'yt-dlp', reason: ytdlpReason(e) })
    console.log(`${TAG} yt-dlp failed: ${ytdlpReason(e)}`)
  }

  try {
    const file = await downloadViaVredenPkg(url)
    console.log(`${TAG} ✔ audio via @vreden/youtube_scraper (${(file.buf.length / 1e6).toFixed(2)}MB, ${file.ext})`)
    return { ...file, via: 'vreden-package' }
  } catch (e) {
    if (e.message !== 'package not installed') failures.push({ src: 'vreden package', reason: shortReason(e) })
  }

  const err = new Error('All download sources failed.')
  err.failures = failures
  throw err
}

function failureMessage(err) {
  if (!err.failures?.length) return `❌ Error: ${err.message}`
  const lines = err.failures.slice(0, 9).map(f => `• ${f.src}: ${f.reason}`)
  const all = err.failures.map(f => f.reason).join(' | ')

  let tip = ''
  if (/bot check/i.test(all)) tip = '\n\n💡 YouTube is blocking this server. Install Deno + add a cookies.txt (see top of play.js).'
  else if (/not installed on this server/i.test(all)) tip = '\n\n💡 yt-dlp isn\'t installed here — it\'s the most reliable source. Install it, or add a working API with YT_MP3_APIS in .env.'
  else if (/host not found/i.test(all)) tip = '\n\n💡 Those APIs are dead. Add working ones with YT_MP3_APIS in .env, or fix yt-dlp.'

  return `❌ Couldn't download this song.\n\n${lines.join('\n')}${tip}\n\n(Owner: send *.play check* for a full diagnosis)`
}

// ── conversion to mp3 (all optional) ─────────────────────────────────────────
function runFfmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: 'ignore' })
    const timer = setTimeout(() => { try { p.kill('SIGKILL') } catch {} ; reject(new Error('ffmpeg timeout')) }, timeoutMs)
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)) })
  })
}

async function convertToMp3(buf, ext) {
  if (libConverter && typeof libConverter.toAudio === 'function') {
    try {
      const out = await libConverter.toAudio(buf, ext)
      if (Buffer.isBuffer(out) && sniffAudio(out)?.ext === 'mp3') return out
    } catch (e) { console.log(`${TAG} lib/converter failed: ${e.message}`) }
  }
  const id = crypto.randomBytes(6).toString('hex')
  const inPath = path.join(os.tmpdir(), `play-${id}.${ext}`)
  const outPath = path.join(os.tmpdir(), `play-${id}.mp3`)
  try {
    await fs.promises.writeFile(inPath, buf)
    await runFfmpeg(['-y', '-i', inPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outPath])
    const out = await fs.promises.readFile(outPath)
    if (out.length > 1000) return out
  } catch (e) {
    console.log(`${TAG} ffmpeg conversion skipped: ${e.message}`)
  } finally {
    await fs.promises.unlink(inPath).catch(() => {})
    await fs.promises.unlink(outPath).catch(() => {})
  }
  return null
}

// ── video lookup / preview ───────────────────────────────────────────────────
const extractVideoId = url => String(url || '').match(/(?:v=|youtu\.be\/|\/shorts\/)([\w-]{11})/)?.[1] || null

async function getVideo(query) {
  if (/youtube\.com|youtu\.be/i.test(query)) {
    const id = extractVideoId(query)
    if (id) {
      try {
        const v = await yts({ videoId: id })
        if (v?.title) return { url: v.url || query, title: v.title, thumbnail: v.thumbnail || v.image || null, timestamp: v.timestamp || null }
      } catch {}
    }
    return { url: query, title: 'YouTube Audio', thumbnail: null, timestamp: null }
  }
  const search = await yts(query)
  if (!search || !search.videos?.length) return null
  return search.videos[0]
}

async function sendPreview(sock, from, msg, video) {
  const caption = `🎵 Downloading: *${video.title}*\n⏱ Duration: ${video.timestamp || 'N/A'}`
  try {
    if (video.thumbnail) {
      await sock.sendMessage(from, { image: { url: video.thumbnail }, caption }, { quoted: msg })
      return
    }
  } catch (e) {
    console.log(`${TAG} preview image failed (${e.message}) — sending text instead`)
  }
  try { await sock.sendMessage(from, { text: caption }, { quoted: msg }) } catch {}
}

// ── .play check ──────────────────────────────────────────────────────────────
async function binaryInfo(cmd, args) {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 })
    return String(stdout).split('\n')[0].trim() || 'ok'
  } catch (e) {
    return e?.code === 'ENOENT' ? null : 'installed'
  }
}

async function runCheck() {
  const apiResults = await Promise.all(allSources().map(async (src) => {
    try {
      const d = await withTimeout(src.get(CHECK_URL), 20000, 'API')
      return `✅ ${src.name}${d?.download ? '' : ' (no link)'}`
    } catch (e) {
      return `❌ ${src.name} — ${shortReason(e)}`
    }
  }))

  const ytdlpVer = await binaryInfo('yt-dlp', ['--version'])
  let ytdlpLine
  if (ytdlpVer === null) {
    ytdlpLine = '❌ yt-dlp — not installed'
  } else {
    try {
      await execFileAsync('yt-dlp', [...ytdlpArgs(), '--simulate', CHECK_URL], { timeout: 45000, maxBuffer: 5 * 1024 * 1024 })
      ytdlpLine = `✅ yt-dlp ${ytdlpVer} — can reach YouTube`
    } catch (e) {
      ytdlpLine = `❌ yt-dlp ${ytdlpVer} — ${ytdlpReason(e)}`
    }
  }

  const ffmpeg = await binaryInfo('ffmpeg', ['-version'])
  const deno = await binaryInfo('deno', ['--version'])
  const cookiesPath = [process.env.YT_COOKIES, path.join(__dirname, '..', 'cookies.txt'), path.join(process.cwd(), 'cookies.txt')]
    .filter(Boolean).find(p => { try { return fs.existsSync(p) } catch { return false } })
  let pkg = '➖ @vreden/youtube_scraper — not installed (optional)'
  try { require.resolve('@vreden/youtube_scraper'); pkg = '✅ @vreden/youtube_scraper — installed' } catch {}

  return [
    '🔎 *.play diagnostics*',
    '',
    '*Download APIs*',
    ...apiResults,
    '',
    '*This server*',
    ytdlpLine,
    ffmpeg === null ? '➖ ffmpeg — not installed (needed for mp3 conversion)' : '✅ ffmpeg',
    deno === null ? '➖ Deno — not installed (helps yt-dlp pass YouTube checks)' : `✅ Deno ${deno.replace(/^deno\s*/i, '')}`,
    cookiesPath ? '✅ cookies.txt found' : '➖ cookies.txt — none',
    pkg,
  ].join('\n')
}

// ── the command ──────────────────────────────────────────────────────────────
module.exports = {
  name: 'play',
  aliases: ['song', 'ytplay'],
  desc: 'Download a song from YouTube (name or link)',
  usage: '.play <song name or YouTube link>',
  category: 'download',

  run: async ({ sock, from, msg, args, isOwner }) => {
    const query = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim()

    if (!query) {
      return sock.sendMessage(from, { text: 'Usage: .play <song name or YouTube link>' }, { quoted: msg })
    }

    // owner-only diagnostics
    if (isOwner && query.toLowerCase() === 'check') {
      await sock.sendMessage(from, { text: '🔎 Testing every source… (up to ~45s)' }, { quoted: msg }).catch(() => {})
      const report = await runCheck()
      return sock.sendMessage(from, { text: report }, { quoted: msg })
    }

    // loading reactions run in the background — they never delay the download
    ;(async () => {
      for (const emoji of ['📥', '⏳', '🎵']) {
        try { await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }) } catch {}
      }
    })()

    try {
      const video = await getVideo(query)
      if (!video) {
        return sock.sendMessage(from, { text: 'No results found.' }, { quoted: msg })
      }

      // preview goes out while the download is already running
      const previewDone = sendPreview(sock, from, msg, video)

      const audio = await downloadAudio(video.url)
      let { buf, ext, mime } = audio

      if (ext !== 'mp3') {
        const mp3 = await convertToMp3(buf, ext)
        if (mp3) { buf = mp3; ext = 'mp3'; mime = 'audio/mpeg' }
      }

      const title = audio.title || video.title || 'audio'
      const safe = String(title).replace(/[^\w\s-]/g, '').trim() || 'audio'

      await previewDone
      await sock.sendMessage(from, {
        audio: buf,
        mimetype: mime,
        fileName: `${safe}.${ext}`,
        ptt: false
      }, { quoted: msg })

    } catch (err) {
      console.error(`${TAG} error:`, err.failures ? err.message : err)
      await sock.sendMessage(from, { text: failureMessage(err) }, { quoted: msg }).catch(() => {})
    }
  }
}
