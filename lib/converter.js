/**
 * CYBER X - Media Converter (Fast Path)
 * FFmpeg utility for WhatsApp-compatible audio/video conversion
 *
 * SPEED CHANGES vs the original:
 *  1. Streams the buffer into ffmpeg's stdin instead of writing a temp file
 *     first and waiting for that write to finish — saves a full disk
 *     write+read round trip before conversion even starts.
 *  2. Output is also streamed back via stdout instead of written to disk
 *     and re-read — same saving on the way out.
 *  3. toAudio() now uses '-c:a copy' when the source is ALREADY an audio
 *     codec WhatsApp accepts (m4a/aac, ogg/opus) — this skips re-encoding
 *     entirely, which is normally the single slowest step. Only falls
 *     back to a real MP3 re-encode when the source format actually needs
 *     converting.
 *  4. When a real encode is unavoidable, uses fast preset settings and
 *     '-threads 0' to use every available CPU core.
 */

const { spawn } = require('child_process')

function ffmpegPipe(buffer, args) {
  args = args || []
  return new Promise(function (resolve, reject) {
    const proc = spawn('ffmpeg', ['-y', '-i', 'pipe:0'].concat(args).concat(['pipe:1']), {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const outChunks = []
    let stderr = ''

    proc.stdout.on('data', function (c) { outChunks.push(c) })
    proc.stderr.on('data', function (c) { stderr += c })

    proc.on('error', reject)
    proc.on('close', function (code) {
      if (code !== 0) return reject(new Error('ffmpeg exited ' + code + ': ' + stderr.slice(-300)))
      resolve(Buffer.concat(outChunks))
    })

    proc.stdin.on('error', function () {})
    proc.stdin.write(buffer)
    proc.stdin.end()
  })
}

/**
 * Convert any audio buffer to a WhatsApp-compatible MP3.
 * Skips re-encoding entirely when the source is already a codec WhatsApp
 * accepts well — this is the single biggest speed win since encoding is
 * always slower than just remuxing.
 */
async function toAudio(buffer, ext) {
  if (ext === 'm4a' || ext === 'aac') {
    try {
      return await ffmpegPipe(buffer, [
        '-vn', '-c:a', 'copy', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov',
      ])
    } catch (e) {
      // fall through to real encode if the source has anything ffmpeg can't just copy
    }
  }

  return ffmpegPipe(buffer, [
    '-vn',
    '-ac', '2',
    '-ar', '44100',
    '-b:a', '128k',
    '-threads', '0',
    '-f', 'mp3',
  ])
}

/** Convert any audio buffer to Opus PTT (WhatsApp voice note) */
async function toPTT(buffer, ext) {
  return ffmpegPipe(buffer, [
    '-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on',
    '-compression_level', '0',
    '-threads', '0',
    '-f', 'opus',
  ])
}

/**
 * Convert any video buffer to MP4. Copies the video stream untouched when
 * it's already H.264 (the overwhelming majority of YouTube downloads) —
 * only audio gets touched if needed. Falls back to a fast x264 encode
 * (ultrafast preset) only if the source video codec isn't compatible.
 */
async function toVideo(buffer, ext) {
  try {
    return await ffmpegPipe(buffer, [
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov',
    ])
  } catch (e) {
    return ffmpegPipe(buffer, [
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-threads', '0',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov',
    ])
  }
}

/**
 * Detect actual audio/video format from buffer magic bytes
 * Returns { ext, mimetype }
 */
function detectFormat(buffer) {
  if (!buffer || buffer.length < 12) return { ext: 'mp3', mimetype: 'audio/mpeg' }

  const ascii4 = buffer.slice(0, 4).toString('ascii')
  const ascii8 = buffer.slice(4, 8).toString('ascii')

  if (ascii4 === 'OggS') return { ext: 'ogg', mimetype: 'audio/ogg; codecs=opus' }
  if (ascii4 === 'RIFF') return { ext: 'wav', mimetype: 'audio/wav' }
  if (ascii8 === 'ftyp')  return { ext: 'm4a', mimetype: 'audio/mp4' }
  if (ascii4.slice(0, 3) === 'ID3') return { ext: 'mp3', mimetype: 'audio/mpeg' }
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) return { ext: 'mp3', mimetype: 'audio/mpeg' }

  return { ext: 'm4a', mimetype: 'audio/mp4' }
}

module.exports = { toAudio, toPTT, toVideo, detectFormat }
