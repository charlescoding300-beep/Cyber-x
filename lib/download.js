// ═══════════════════════════════════════════════════════════════
// lib/download.js — CYBER X DOWNLOAD ENGINE (STABLE BUILD)
// Powered by yt-dlp + FFmpeg support for Render stability
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")
const http  = require("http")
const https = require("https")

// ── FFmpeg binding (IMPORTANT FIX FOR RENDER) ──
try {
  const ffmpegPath = require("ffmpeg-static")
  process.env.FFMPEG_PATH = ffmpegPath
} catch {}

// ── Load yt-dlp-exec ──
let ytdlp
try {
  ytdlp = require("yt-dlp-exec")
  if (ytdlp.default) ytdlp = ytdlp.default
} catch {
  throw new Error("[DOWNLOAD] yt-dlp-exec not found — run: npm install yt-dlp-exec")
}

const TMP = "/tmp"

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return "0:00"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
  return `${m}:${String(s).padStart(2,"0")}`
}

function formatSize(bytes) {
  if (!bytes) return "?"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatViews(n) {
  if (!n) return "?"
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function tmpPath(label, ext) {
  return path.join(
    TMP,
    `cyberx_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  )
}

function safeDelete(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

// Find output file safely
function findOutputFile(basePath) {
  if (fs.existsSync(basePath)) return basePath

  const baseName = path.basename(basePath, path.extname(basePath))
  const files = fs.readdirSync(TMP).filter(f => f.startsWith(baseName))

  if (files.length > 0) return path.join(TMP, files[0])
  return null
}

// Fetch buffer
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http
    const req = lib.get(url, res => {
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks)))
      res.on("error", reject)
    })
    req.setTimeout(15000, () => {
      req.destroy()
      reject(new Error("Timeout"))
    })
    req.on("error", reject)
  })
}

// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════

async function search(query, limit = 1) {
  try {
    const isUrl = /^https?:\/\//.test(query)

    if (isUrl) {
      return [await getInfo(query)]
    }

    const raw = await ytdlp(`ytsearch${limit}:${query}`, {
      dumpSingleJson: true,
      skipDownload: true,
      flatPlaylist: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificates: true
    })

    const entries = raw?.entries || (raw?.id ? [raw] : [])

    return entries.map(e => ({
      id: e.id || "",
      title: e.title || "Unknown",
      url: e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
      duration: e.duration || 0,
      thumbnail: e.thumbnail || null,
      uploader: e.uploader || "Unknown",
      views: e.view_count || 0
    }))

  } catch (e) {
    throw new Error("Search failed: " + e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// INFO
// ═══════════════════════════════════════════════════════════════

async function getInfo(url) {
  const raw = await ytdlp(url, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noCallHome: true
  })

  return {
    id: raw.id || "",
    title: raw.title || "Unknown",
    url: raw.webpage_url || url,
    duration: raw.duration || 0,
    thumbnail: raw.thumbnail || null,
    uploader: raw.uploader || "Unknown",
    views: raw.view_count || 0
  }
}

// ═══════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════

async function downloadAudio(urlOrQuery) {
  let url = urlOrQuery
  let info = null

  if (!/^https?:\/\//.test(urlOrQuery)) {
    const r = await search(urlOrQuery, 1)
    if (!r.length) throw new Error("No results")
    info = r[0]
    url = info.url
  }

  const out = tmpPath("audio", "mp3")

  try {
    await ytdlp(url, {
      output: out,
      extractAudio: true,
      audioFormat: "mp3",
      audioQuality: "128K",
      noPlaylist: true,
      noWarnings: true,
      noCallHome: true
    })

    const file = findOutputFile(out)
    if (!file) throw new Error("Audio missing")

    const buffer = fs.readFileSync(file)
    safeDelete(file)

    if (!info) info = await getInfo(url)

    return { buffer, info, size: buffer.length }

  } catch (e) {
    safeDelete(out)
    throw new Error("Audio failed: " + e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// VIDEO (FIXED + RETRY SYSTEM)
// ═══════════════════════════════════════════════════════════════

async function downloadVideo(urlOrQuery, quality = "480") {

  const qualityMap = {
    "360": "best[height<=360]",
    "480": "best[height<=480]",
    "720": "best[height<=720]",
    "1080": "best[height<=1080]"
  }

  let url = urlOrQuery
  let info = null

  if (!/^https?:\/\//.test(urlOrQuery)) {
    const r = await search(urlOrQuery, 1)
    if (!r.length) throw new Error("No results")
    info = r[0]
    url = info.url
  }

  const out = tmpPath("video", "mp4")

  try {
    await ytdlp(url, {
      output: out,
      format: qualityMap[quality] || qualityMap["480"],
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noWarnings: true,
      noCallHome: true
    })

    let file = findOutputFile(out)
    if (!file) throw new Error("Video missing")

    const stat = fs.statSync(file)
    const sizeMB = stat.size / 1024 / 1024

    if (sizeMB > 95) {
      safeDelete(file)
      throw new Error("Video too large, try 360p")
    }

    const buffer = fs.readFileSync(file)
    safeDelete(file)

    if (!info) info = await getInfo(url)

    return { buffer, info, size: buffer.length }

  } catch (e) {
    safeDelete(out)
    throw new Error("Video failed: " + e.message)
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  search,
  getInfo,
  downloadAudio,
  downloadVideo,
  formatDuration,
  formatSize,
  formatViews,
  safeDelete
}
