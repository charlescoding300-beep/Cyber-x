// ═══════════════════════════════════════════════════════════════
// lib/download.js — CYBER X DOWNLOAD ENGINE
// Powered by yt-dlp — supports YouTube, SoundCloud, Facebook,
// Instagram, TikTok, Twitter/X, Dailymotion, Vimeo + 1000 more
// ═══════════════════════════════════════════════════════════════

const fs   = require("fs")
const path = require("path")
const http  = require("http")
const https = require("https")

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
  return path.join(TMP, `cyberx_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
}

function safeDelete(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch {}
}

// Find a file that was created by yt-dlp (handles extension changes)
function findOutputFile(basePath, expectedExt) {
  if (fs.existsSync(basePath)) return basePath
  // yt-dlp sometimes changes extension — scan /tmp for close match
  const baseName = path.basename(basePath, path.extname(basePath))
  const files = fs.readdirSync(TMP).filter(f => f.startsWith(baseName))
  if (files.length > 0) return path.join(TMP, files[0])
  return null
}

// ── Download a URL to buffer (for thumbnails) ──
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http
    const req = lib.get(url, res => {
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => resolve(Buffer.concat(chunks)))
      res.on("error", reject)
    })
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Thumbnail timeout")) })
    req.on("error", reject)
  })
}

// ═══════════════════════════════════════════════════════════════
// SEARCH — finds top results from YouTube (or any platform)
// ═══════════════════════════════════════════════════════════════

async function search(query, limit = 1) {
  try {
    const isUrl = /^https?:\/\//.test(query)

    // If it's already a URL, just get its info directly
    if (isUrl) {
      return [await getInfo(query)]
    }

    const raw = await ytdlp(`ytsearch${limit}:${query}`, {
      dumpSingleJson:   true,
      noWarnings:       true,
      noCallHome:       true,
      skipDownload:     true,
      flatPlaylist:     true,
      noCheckCertificates: true,
    })

    const entries = raw?.entries || (raw?.id ? [raw] : [])

    return entries.map(e => ({
      id:        e.id       || "",
      title:     e.title    || "Unknown Title",
      url:       e.url      || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
      duration:  e.duration || 0,
      thumbnail: e.thumbnail || (e.thumbnails?.[e.thumbnails.length - 1]?.url) || null,
      uploader:  e.uploader || e.channel || "Unknown",
      views:     e.view_count || 0,
      platform:  "YouTube",
    }))

  } catch (e) {
    throw new Error(`Search failed: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// GET FULL INFO — metadata for a direct URL
// ═══════════════════════════════════════════════════════════════

async function getInfo(url) {
  const raw = await ytdlp(url, {
    dumpSingleJson:   true,
    noWarnings:       true,
    noCallHome:       true,
    skipDownload:     true,
    noPlaylist:       true,
    noCheckCertificates: true,
  })

  return {
    id:        raw.id        || "",
    title:     raw.title     || "Unknown Title",
    url:       raw.webpage_url || url,
    duration:  raw.duration  || 0,
    thumbnail: raw.thumbnail || (raw.thumbnails?.[raw.thumbnails.length - 1]?.url) || null,
    uploader:  raw.uploader  || raw.channel || "Unknown",
    views:     raw.view_count || 0,
    platform:  raw.extractor_key || "Unknown",
    filesize:  raw.filesize  || raw.filesize_approx || 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD AUDIO — returns { buffer, info, size }
// ═══════════════════════════════════════════════════════════════

async function downloadAudio(urlOrQuery) {
  let url = urlOrQuery
  let info = null

  // If not a URL, search first
  if (!/^https?:\/\//.test(urlOrQuery)) {
    const results = await search(urlOrQuery, 1)
    if (!results.length) throw new Error("No results found")
    info = results[0]
    url  = info.url
  }

  const out = tmpPath("audio", "mp3")

  try {
    await ytdlp(url, {
      output:           out,
      extractAudio:     true,
      audioFormat:      "mp3",
      audioQuality:     "128K",   // good quality, small size
      noPlaylist:       true,
      noWarnings:       true,
      noCallHome:       true,
      noCheckCertificates: true,
      addMetadata:      true,     // embeds title/artist into mp3
      embedThumbnail:   false,    // skip thumbnail embed (saves space)
    })

    // Find the actual output file (yt-dlp may adjust extension)
    const actualPath = findOutputFile(out, "mp3")
    if (!actualPath) throw new Error("Audio file not found after download")

    const buffer = fs.readFileSync(actualPath)
    safeDelete(actualPath)

    // Get info if we didn't already
    if (!info) info = await getInfo(url)

    return { buffer, info, size: buffer.length }

  } catch (e) {
    safeDelete(out)
    throw new Error(`Audio download failed: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD VIDEO — returns { buffer, info, size }
// Quality cap: 480p to keep WhatsApp-safe (<95MB)
// ═══════════════════════════════════════════════════════════════

async function downloadVideo(urlOrQuery, quality = "480") {

  const qualityMap = {
    "360":  "best[ext=mp4][height<=360]/best[height<=360][ext=mp4]/worst[ext=mp4]",
    "480":  "best[ext=mp4][height<=480]/best[height<=480][ext=mp4]/best[ext=mp4]",
    "720":  "best[ext=mp4][height<=720]/best[height<=720][ext=mp4]/best[ext=mp4]",
    "1080": "best[ext=mp4][height<=1080]/best[ext=mp4]",
  }

  const format = qualityMap[quality] || qualityMap["480"]

  let url  = urlOrQuery
  let info = null

  if (!/^https?:\/\//.test(urlOrQuery)) {
    const results = await search(urlOrQuery, 1)
    if (!results.length) throw new Error("No results found")
    info = results[0]
    url  = info.url
  }

  const out = tmpPath("video", "mp4")

  try {
    await ytdlp(url, {
      output:              out,
      format:              format,
      mergeOutputFormat:   "mp4",
      noPlaylist:          true,
      noWarnings:          true,
      noCallHome:          true,
      noCheckCertificates: true,
    })

    const actualPath = findOutputFile(out, "mp4")
    if (!actualPath) throw new Error("Video file not found after download")

    const stat   = fs.statSync(actualPath)
    const sizeMB = stat.size / 1024 / 1024

    // WhatsApp rejects files over ~95MB
    if (sizeMB > 95) {
      safeDelete(actualPath)
      throw new Error(`Video too large (${sizeMB.toFixed(1)}MB). Try .video ${urlOrQuery} 360`)
    }

    const buffer = fs.readFileSync(actualPath)
    safeDelete(actualPath)

    if (!info) info = await getInfo(url)

    return { buffer, info, size: buffer.length }

  } catch (e) {
    safeDelete(out)
    throw new Error(`Video download failed: ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// GET THUMBNAIL BUFFER
// ═══════════════════════════════════════════════════════════════

async function getThumbnail(thumbUrl) {
  if (!thumbUrl) return null
  try { return await fetchBuffer(thumbUrl) }
  catch { return null }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  search,
  getInfo,
  downloadAudio,
  downloadVideo,
  getThumbnail,
  formatDuration,
  formatSize,
  formatViews,
  safeDelete,
}
