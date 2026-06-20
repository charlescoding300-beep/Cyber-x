'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/ytdl.js  —  CYBER X  |  YouTube Downloader (youtubei.js direct)
//
// Replaces third-party scraper APIs (EliteProTech/Yupra/Okatsu) — those are
// unofficial, unmaintained, and die/rate-limit constantly, which is why
// "all download sources failed" kept happening.
//
// This talks to YouTube's real Innertube API directly via youtubei.js —
// faster (no extra hop through someone else's slow server) and far more
// reliable since it's not dependent on third-party uptime.
//
// Includes the Platform.shim.eval fix for the v16+ "login required" issue.
// ─────────────────────────────────────────────────────────────────────────────

const { Innertube, UniversalCache, Platform } = require('youtubei.js')

// ── Fix for "login required" breaking change in youtubei.js v16+ ──────────────
Platform.shim.eval = async (data) => new Function(data.output)()

let ytClient = null

async function getClient() {
  if (ytClient) return ytClient
  ytClient = await Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
  })
  return ytClient
}

/**
 * Search YouTube and return the top result in the same shape yt-search
 * provided, so song.js/video.js don't need to change their card-building
 * code at all.
 */
async function search(query) {
  const yt = await getClient()
  const results = await yt.search(query, { type: 'video' })
  const v = results?.videos?.[0]
  if (!v) return null

  return {
    title:     v.title?.text || v.title || 'Unknown',
    url:       `https://www.youtube.com/watch?v=${v.id}`,
    id:        v.id,
    thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${v.id}/sddefault.jpg`,
    timestamp: v.duration?.text || 'N/A',
    views:     v.view_count?.text ? parseInt(String(v.view_count.text).replace(/\D/g, '')) || 0 : 0,
    author:    { name: v.author?.name || 'Unknown' },
    ago:       v.published?.text || 'N/A',
  }
}

/**
 * Get a downloadable stream for a video ID/URL.
 * @param {string} idOrUrl
 * @param {"audio"|"video"} type
 * @returns {Promise<Buffer>}
 */
async function download(idOrUrl, type = 'audio') {
  const yt = await getClient()
  const videoId = (idOrUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [, idOrUrl])[1]

  const format = type === 'audio'
    ? { type: 'audio', quality: 'best', format: 'mp4' }
    : { type: 'video+audio', quality: 'best', format: 'mp4' }

  const stream = await yt.download(videoId, format)

  const chunks = []
  for await (const chunk of Utils.streamToIterable(stream)) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// Helper to read a web ReadableStream (youtubei.js returns one)
const Utils = {
  async *streamToIterable(stream) {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  },
}

module.exports = { search, download, getClient }
