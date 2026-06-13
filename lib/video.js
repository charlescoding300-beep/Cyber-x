'use strict'

const { Innertube, Platform } = require('youtubei.js')

// ── Required by youtubei.js v16+: provide a JS interpreter so it can
//    decipher YouTube's obfuscated streaming URLs (login required fix) ──
Platform.shim.eval = async (data) => {
  // eslint-disable-next-line no-new-func
  return new Function(data.output)()
}

let yt = null

async function getYT() {
  if (!yt) yt = await Innertube.create()
  return yt
}

// ── Search YouTube, return top N results ────────────────────────
async function searchVideo(query, limit = 1) {
  const tube    = await getYT()
  const results = await tube.search(query, { type: 'video' })
  return (results.videos || []).slice(0, limit)
}

// ── Download video as buffer (360p mp4 — fastest + WhatsApp safe) ─
async function downloadVideo(videoId) {
  const tube   = await getYT()
  const chunks = []

  const stream = await tube.download(videoId, {
    type:    'video+audio',
    quality: '360p',
    format:  'mp4',
  })

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

module.exports = { searchVideo, downloadVideo }
