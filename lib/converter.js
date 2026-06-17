/**
 * CYBER X - Media Converter
 * FFmpeg utility for WhatsApp-compatible audio/video conversion
 */

const fs   = require('fs')
const path = require('path')
const { spawn } = require('child_process')

function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = path.join(__dirname, '../temp')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

      const tmp = path.join(tempDir, `${Date.now()}.${ext}`)
      const out = `${tmp}.${ext2}`

      await fs.promises.writeFile(tmp, buffer)

      spawn('ffmpeg', ['-y', '-i', tmp, ...args, out])
        .on('error', reject)
        .on('close', async (code) => {
          try {
            await fs.promises.unlink(tmp).catch(() => {})
            if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}`))
            const result = await fs.promises.readFile(out)
            await fs.promises.unlink(out).catch(() => {})
            resolve(result)
          } catch (e) { reject(e) }
        })
    } catch (e) { reject(e) }
  })
}

/** Convert any audio buffer to MP3 (WhatsApp audio) */
function toAudio(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn', '-ac', '2', '-b:a', '128k', '-ar', '44100', '-f', 'mp3'
  ], ext, 'mp3')
}

/** Convert any audio buffer to Opus PTT (WhatsApp voice note) */
function toPTT(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-compression_level', '10'
  ], ext, 'opus')
}

/** Convert any video buffer to MP4 (WhatsApp video) */
function toVideo(buffer, ext) {
  return ffmpeg(buffer, [
    '-c:v', 'libx264', '-c:a', 'aac', '-ab', '128k',
    '-ar', '44100', '-crf', '32', '-preset', 'slow'
  ], ext, 'mp4')
}

/**
 * Detect actual audio/video format from buffer magic bytes
 * Returns { ext, mimetype }
 */
function detectFormat(buffer) {
  if (!buffer || buffer.length < 12) return { ext: 'mp3', mimetype: 'audio/mpeg' }

  const ascii4 = buffer.slice(0, 4).toString('ascii')
  const ascii8 = buffer.slice(4, 8).toString('ascii')

  // OGG / Opus
  if (ascii4 === 'OggS') return { ext: 'ogg', mimetype: 'audio/ogg; codecs=opus' }
  // WAV
  if (ascii4 === 'RIFF') return { ext: 'wav', mimetype: 'audio/wav' }
  // MP4 / M4A (ftyp box at byte 4)
  if (ascii8 === 'ftyp')  return { ext: 'm4a', mimetype: 'audio/mp4' }
  // ID3 tag = MP3
  if (ascii4.slice(0, 3) === 'ID3') return { ext: 'mp3', mimetype: 'audio/mpeg' }
  // MPEG frame sync
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) return { ext: 'mp3', mimetype: 'audio/mpeg' }

  // Default M4A (most APIs return this)
  return { ext: 'm4a', mimetype: 'audio/mp4' }
}

module.exports = { ffmpeg, toAudio, toPTT, toVideo, detectFormat }

