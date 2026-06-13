'use strict'
/**
 * lib/play.js — YouTube search + download via youtubei.js
 * Works on Render (no residential IP needed)
 */

const { Innertube, Platform } = require('youtubei.js')

// ── Required by youtubei.js v16+: JS interpreter to decipher stream URLs ──
Platform.shim.eval = async (data) => {
  // eslint-disable-next-line no-new-func
  return new Function(data.output)()
}

async function getYT() {
  return Innertube.create({
    cache: undefined,
    generate_session_locally: true,
  })
}

async function searchTrack(query, limit = 5) {
  const yt      = await getYT()
  const results = await yt.search(query, { type: 'video' })
  return (results.videos || []).slice(0, limit).map(v => ({
    title:    v.title?.text || 'Unknown',
    videoId:  v.id,
    author:   { name: v.author?.name || 'Unknown' },
    duration: { seconds: v.duration?.seconds || 0 },
    views:    v.view_count?.text || '0',
    ago:      v.published?.text || 'N/A',
    thumb:    v.best_thumbnail?.url || v.thumbnails?.[0]?.url || null,
  }))
}

async function downloadAudio(videoId) {
  const yt     = await getYT()
  const info   = await yt.getInfo(videoId)
  const stream = await info.download({
    type:    'audio',
    quality: 'best',
    format:  'mp4',
  })
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

module.exports = { searchTrack, downloadAudio }
