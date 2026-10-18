'use strict'

const axios = require('axios')
const playCommand = require('./play')

const { getVideo, downloadVideoViaYtDlp } = playCommand.youtubeHelpers
const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'
const MAX_VIDEO_BYTES = 64 * 1024 * 1024
const API_TIMEOUT_MS = 25_000

const AXIOS_DEFAULTS = {
  timeout: API_TIMEOUT_MS,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, video/mp4, */*',
  },
}

function isYouTubeUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

function isMp4(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 2048 && buffer.slice(4, 8).toString('latin1') === 'ftyp'
}

async function getEliteProTechVideoByUrl(youtubeUrl, signal) {
  const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`
  const res = await axios.get(apiUrl, { ...AXIOS_DEFAULTS, signal })
  if (res?.data?.success && res?.data?.downloadURL) {
    return { download: res.data.downloadURL, title: res.data.title }
  }
  throw new Error('EliteProTech returned no video link')
}

async function getYupraVideoByUrl(youtubeUrl, signal) {
  const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`
  const res = await axios.get(apiUrl, { ...AXIOS_DEFAULTS, signal })
  if (res?.data?.success && res?.data?.data?.download_url) {
    return { download: res.data.data.download_url, title: res.data.data.title }
  }
  throw new Error('Yupra returned no video link')
}

async function getOkatsuVideoByUrl(youtubeUrl, signal) {
  const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`
  const res = await axios.get(apiUrl, { ...AXIOS_DEFAULTS, signal })
  if (res?.data?.result?.mp4) {
    return { download: res.data.result.mp4, title: res.data.result.title }
  }
  throw new Error('Okatsu returned no video link')
}

async function getKeithVideoByUrl(youtubeUrl, signal) {
  const apiUrl = `https://apis-keith.vercel.app/download/dlmp4?url=${encodeURIComponent(youtubeUrl)}`
  const res = await axios.get(apiUrl, { ...AXIOS_DEFAULTS, signal })
  if (res?.data?.status && res?.data?.result?.downloadUrl) {
    return { download: res.data.result.downloadUrl, title: res.data.result.title }
  }
  throw new Error('Keith returned no video link')
}

async function fetchMp4(url, signal) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
    throw new Error('video source returned an invalid download URL')
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120_000,
    maxContentLength: MAX_VIDEO_BYTES,
    maxBodyLength: MAX_VIDEO_BYTES,
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'video/mp4, application/octet-stream, */*' },
  })
  const buffer = Buffer.from(response.data)
  if (buffer.length > MAX_VIDEO_BYTES) throw new Error('video exceeds the 64 MB upload limit')
  if (!isMp4(buffer)) throw new Error('download URL did not return a valid MP4 video')
  return buffer
}

async function downloadFromApis(youtubeUrl) {
  const sources = [
    { name: 'EliteProTech', get: getEliteProTechVideoByUrl },
    { name: 'Yupra', get: getYupraVideoByUrl },
    { name: 'Okatsu', get: getOkatsuVideoByUrl },
    { name: 'Keith', get: getKeithVideoByUrl },
  ]
  const controller = new AbortController()
  const pending = new Map()
  const failures = []

  sources.forEach((source, index) => {
    pending.set(index, source.get(youtubeUrl, controller.signal).then(
      data => ({ index, data }),
      error => ({ index, error }),
    ))
  })

  try {
    while (pending.size) {
      const result = await Promise.race(pending.values())
      pending.delete(result.index)
      const source = sources[result.index]

      if (result.error) {
        failures.push(`${source.name}: ${result.error.message}`)
        console.log(`[VIDEO] ${source.name} failed: ${result.error.message}`)
        continue
      }

      try {
        const buffer = await fetchMp4(result.data.download, controller.signal)
        console.log(`[VIDEO] ${source.name} returned a valid MP4 (${(buffer.length / 1e6).toFixed(1)} MB)`)
        return { buffer, title: result.data.title, via: source.name }
      } catch (error) {
        failures.push(`${source.name}: ${error.message}`)
        console.log(`[VIDEO] ${source.name} video failed: ${error.message}`)
      }
    }
  } finally {
    controller.abort()
  }

  throw new Error(failures.join(' | ') || 'video APIs returned no result')
}

async function downloadVideo(youtubeUrl) {
  let apiError
  try {
    return await downloadFromApis(youtubeUrl)
  } catch (error) {
    apiError = error
    console.log(`[VIDEO] MP4 APIs failed; trying the same yt-dlp setup as .play: ${error.message}`)
  }

  try {
    const result = await downloadVideoViaYtDlp(youtubeUrl)
    return { buffer: result.buf, title: result.title, via: result.via || 'yt-dlp' }
  } catch (error) {
    throw new Error(`Video APIs failed (${apiError.message}); yt-dlp failed (${error.message})`)
  }
}

function fmtViews(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 'N/A'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B 🔥`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M 🔥`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-US')
}

async function sendVideoInfo(sock, from, msg, video, youtubeUrl) {
  const title = String(video.title || 'YouTube video').replace(/[\r\n]+/g, ' ').slice(0, 180)
  const thumbnail = video.thumbnail || null
  const card = `🎬 *${title}*\n\n📺 *Channel:* ${video.author?.name || video.author || 'Unknown'}\n⏱️ *Duration:* ${video.timestamp || 'N/A'}\n👁️ *Views:* ${fmtViews(video.views)}\n🔗 ${youtubeUrl}\n\n⬇️ Downloading video…\n\n${CREDIT}`

  if (thumbnail) {
    try {
      return await sock.sendMessage(from, { image: { url: thumbnail }, caption: card }, { quoted: msg })
    } catch (error) {
      console.log(`[VIDEO] thumbnail send failed: ${error.message}`)
    }
  }
  return sock.sendMessage(from, { text: card }, { quoted: msg })
}

module.exports = {
  pattern: 'video',
  alias: ['ytv', 'ytmp4', 'ytvideo', 'ytvid'],
  category: 'download',
  desc: 'Download a YouTube video',
  usage: '.video <video name or YouTube URL>',

  run: async ({ sock, from, msg, args = [] }) => {
    if (msg?.key) {
      void sock.sendMessage(from, { react: { text: '📺', key: msg.key } }).catch(() => {})
    }

    const query = args.join(' ').trim()
    if (!query) {
      return sock.sendMessage(from, {
        text: `❌ Usage: *.video <video name>*\nExample: .video Burna Boy Last Last\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    let searchMsg
    try {
      searchMsg = await sock.sendMessage(from, { text: `🔎 *Searching YouTube:* ${query}` }, { quoted: msg })
      const video = await getVideo(query)
      if (!video?.url) {
        if (searchMsg?.key) sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
        return sock.sendMessage(from, { text: `❌ No YouTube results found for *${query}*.\n\n${CREDIT}` }, { quoted: msg })
      }

      const youtubeUrl = video.url
      if (!isYouTubeUrl(youtubeUrl)) throw new Error('The search result was not a valid YouTube video link')

      // Start downloading as soon as the search returns, while the info card is sent.
      const downloadPromise = downloadVideo(youtubeUrl).then(
        result => ({ result }),
        error => ({ error }),
      )
      const infoMsg = await sendVideoInfo(sock, from, msg, video, youtubeUrl)
      if (searchMsg?.key) sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})

      const outcome = await downloadPromise
      if (outcome.error) throw outcome.error
      const result = outcome.result
      const title = String(result.title || video.title || 'video').replace(/[\r\n]+/g, ' ').slice(0, 180)
      const safeName = title.replace(/[^\w\s-]/g, '').trim().slice(0, 100) || 'video'

      // Send the downloaded MP4 buffer immediately; WhatsApp no longer has to
      // fetch a third-party URL itself after the command finishes.
      return await sock.sendMessage(from, {
        video: result.buffer,
        mimetype: 'video/mp4',
        fileName: `${safeName}.mp4`,
        caption: `🎬 *${title}*\n\n${CREDIT}`,
      }, { quoted: infoMsg || msg })
    } catch (error) {
      if (searchMsg?.key) sock.sendMessage(from, { delete: searchMsg.key }).catch(() => {})
      console.error('[VIDEO]', error.message)
      return sock.sendMessage(from, {
        text: `❌ Couldn't download that YouTube video.\n${error.message}\n\n${CREDIT}`,
      }, { quoted: msg })
    }
  },
}
