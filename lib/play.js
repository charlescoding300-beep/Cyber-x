// lib/play.js — yt-dlp + ffmpeg engine (Termux + Render compatible)
const { execFile, execSync } = require("child_process")
const { promisify }          = require("util")
const path                   = require("path")
const fs                     = require("fs")
const yts                    = require("yt-search")

const execFileAsync = promisify(execFile)
const MAX_DURATION  = 600

// ── Auto-detect yt-dlp and ffmpeg paths (works on Termux AND Render) ─────────
function findBin(name) {
  // Check env var first
  const envKey = `${name.toUpperCase().replace("-", "_")}_PATH`
  if (process.env[envKey] && process.env[envKey] !== "null") {
    return process.env[envKey]
  }
  // Try which
  try {
    const found = execSync(`which ${name}`, { timeout: 5000 }).toString().trim()
    if (found) return found
  } catch {}
  // Known fallback paths
  const fallbacks = {
    "yt-dlp": [
      "/data/data/com.termux/files/usr/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
      "/usr/bin/yt-dlp",
    ],
    "ffmpeg": [
      "/data/data/com.termux/files/usr/bin/ffmpeg",
      "/usr/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
    ]
  }
  for (const p of (fallbacks[name] || [])) {
    if (fs.existsSync(p)) return p
  }
  return name // last resort — hope it's in PATH
}

const YTDLP  = findBin("yt-dlp")
const FFMPEG = findBin("ffmpeg")

console.log(`[play] yt-dlp  → ${YTDLP}`)
console.log(`[play] ffmpeg  → ${FFMPEG}`)

// ── Tmp folder ────────────────────────────────────────────────────────────────
const TMP_DIR = path.join(__dirname, "..", "tmp")
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

// ── Parse duration → seconds ──────────────────────────────────────────────────
function parseDuration(dur) {
  if (!dur) return 0
  if (typeof dur === "object" && dur.seconds != null) return dur.seconds
  if (typeof dur === "string") {
    const p = dur.split(":").map(Number)
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
    if (p.length === 2) return p[0] * 60 + p[1]
    return p[0]
  }
  return 0
}

// ── Search ────────────────────────────────────────────────────────────────────
async function searchTrack(query) {
  const res = await yts(query)
  return (res.videos || []).filter(v => {
    const secs = parseDuration(v.duration)
    return secs > 0 && secs <= MAX_DURATION
  })
}

// ── Cleanup old tmp files ─────────────────────────────────────────────────────
function cleanTmp() {
  try {
    const now = Date.now()
    for (const f of fs.readdirSync(TMP_DIR)) {
      const fp = path.join(TMP_DIR, f)
      try {
        if (now - fs.statSync(fp).mtimeMs > 10 * 60 * 1000)
          fs.unlink(fp, () => {})
      } catch {}
    }
  } catch {}
}

// ── Step 1: Download mp3 via yt-dlp ──────────────────────────────────────────
async function downloadMp3(videoId) {
  const url     = `https://www.youtube.com/watch?v=${videoId}`
  const stamp   = Date.now()
  const outTmpl = path.join(TMP_DIR, `audio_${videoId}_${stamp}.%(ext)s`)

  await execFileAsync(YTDLP, [
    url,
    "--format",         "worstaudio/worst",
    "--extract-audio",
    "--audio-format",   "mp3",
    "--audio-quality",  "64K",
    "--output",         outTmpl,
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--socket-timeout", "30",
    "--retries",        "3",
  ], {
    timeout:   90_000,
    maxBuffer: 10 * 1024 * 1024,
    env:       { ...process.env, PATH: process.env.PATH }
  })

  // Find the downloaded mp3
  let files = fs.readdirSync(TMP_DIR).filter(f =>
    f.startsWith(`audio_${videoId}_${stamp}`) && f.endsWith(".mp3")
  )

  if (!files.length) {
    files = fs.readdirSync(TMP_DIR).filter(f =>
      f.includes(videoId) && f.endsWith(".mp3")
    )
  }

  if (!files.length) throw new Error("yt-dlp finished but mp3 not found")

  const mp3Path = path.join(TMP_DIR, files[files.length - 1])
  console.log(`[play] ✅ mp3: ${path.basename(mp3Path)} (${(fs.statSync(mp3Path).size / 1024).toFixed(0)}KB)`)
  return mp3Path
}

// ── Step 2: Convert mp3 → ogg opus via ffmpeg ────────────────────────────────
async function convertToOpus(mp3Path) {
  const oggPath = mp3Path.replace(/\.mp3$/, ".ogg")

  await execFileAsync(FFMPEG, [
    "-i",                 mp3Path,
    "-c:a",               "libopus",
    "-b:a",               "64k",
    "-vbr",               "on",
    "-compression_level", "10",
    "-map",               "0:a",
    "-y",
    oggPath
  ], {
    timeout:   60_000,
    maxBuffer: 10 * 1024 * 1024,
    env:       { ...process.env, PATH: process.env.PATH }
  })

  fs.unlink(mp3Path, () => {})

  if (!fs.existsSync(oggPath)) throw new Error("ffmpeg conversion failed — ogg not created")

  console.log(`[play] ✅ ogg: ${path.basename(oggPath)} (${(fs.statSync(oggPath).size / 1024).toFixed(0)}KB)`)
  return oggPath
}

// ── Main audio pipeline ───────────────────────────────────────────────────────
async function downloadAudio(videoId) {
  if (!videoId) throw new Error("video_id is missing")

  cleanTmp()

  console.log(`[play] ⬇️  Downloading: ${videoId}`)
  const mp3Path = await downloadMp3(videoId)

  console.log(`[play] 🔄 Converting to ogg opus...`)
  const oggPath = await convertToOpus(mp3Path)

  const buffer = fs.readFileSync(oggPath)
  fs.unlink(oggPath, () => {})

  if (!buffer || buffer.length === 0) throw new Error("ogg buffer is empty after conversion")

  console.log(`[play] 🎵 Ready: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`)
  return buffer
}

// ── Download video ────────────────────────────────────────────────────────────
async function downloadVideo(query, quality = "480") {
  cleanTmp()

  const isUrl   = /^https?:\/\//i.test(query)
  const url     = isUrl ? query : `ytsearch1:${query}`
  const stamp   = Date.now()
  const outTmpl = path.join(TMP_DIR, `video_${stamp}.%(ext)s`)

  const { stdout: infoRaw } = await execFileAsync(YTDLP, [
    url,
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--socket-timeout", "15",
  ], {
    timeout:   30_000,
    maxBuffer: 5 * 1024 * 1024,
    env:       { ...process.env, PATH: process.env.PATH }
  })

  const info    = JSON.parse(infoRaw)
  const estSize = info.filesize || info.filesize_approx || 0
  if (estSize > 180 * 1024 * 1024) throw new Error("File too large for WhatsApp (>180MB)")

  const fmt =
    quality === "720" ? "bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]" :
    quality === "360" ? "bestvideo[height<=360][ext=mp4]+bestaudio/best[height<=360]" :
                        "bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]"

  await execFileAsync(YTDLP, [
    url,
    "--format",              fmt,
    "--merge-output-format", "mp4",
    "--output",              outTmpl,
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--socket-timeout",      "30",
    "--retries",             "3",
  ], {
    timeout:   180_000,
    maxBuffer: 10 * 1024 * 1024,
    env:       { ...process.env, PATH: process.env.PATH }
  })

  const files = fs.readdirSync(TMP_DIR).filter(f =>
    f.startsWith(`video_${stamp}`) && f.endsWith(".mp4")
  )
  if (!files.length) throw new Error("yt-dlp finished but video file not found")

  const filePath = path.join(TMP_DIR, files[files.length - 1])

  if (fs.statSync(filePath).size > 200 * 1024 * 1024) {
    fs.unlink(filePath, () => {})
    throw new Error("Video too large for WhatsApp (>200MB). Try 360p.")
  }

  const buffer = fs.readFileSync(filePath)
  fs.unlink(filePath, () => {})

  if (!buffer || buffer.length === 0) throw new Error("Video buffer is empty")

  console.log(`[video] ✅ ${(buffer.length / 1024 / 1024).toFixed(2)}MB | ${info.title}`)

  return {
    buffer,
    size: buffer.length,
    info: {
      title:    info.title      || "Unknown",
      uploader: info.uploader   || info.channel || "Unknown",
      duration: info.duration   || 0,
      views:    info.view_count || 0,
    }
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs) return "N/A"
  const s   = Math.floor(secs)
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`
}

function formatSize(bytes) {
  if (!bytes) return "N/A"
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024).toFixed(0)}KB`
}

function formatViews(n) {
  if (!n) return "N/A"
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

module.exports = {
  searchTrack,
  downloadAudio,
  downloadVideo,
  parseDuration,
  formatDuration,
  formatSize,
  formatViews,
  MAX_DURATION
}
