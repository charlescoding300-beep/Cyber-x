/**
 * CYBER X - Media Converter
 * FFmpeg utility for WhatsApp-compatible audio/video conversion
 *
 * ── Concurrency control ─────────────────────────────────────────
 * Render free tier = shared CPU + 512MB RAM. If every user/session
 * fires .song or .video at once, each spawns its own ffmpeg process.
 * A handful of simultaneous ffmpeg jobs is enough to OOM-kill the
 * whole bot (all sessions go down, not just the one user).
 *
 * Fix: a single shared semaphore across ALL sessions. Max 2 ffmpeg
 * processes run at once, system-wide. Everyone can still run .song /
 * .video as many times as they want — nothing is blocked or refused.
 * If the 2 slots are full, the next job just waits for a slot to free
 * up (usually a second or two, since conversions are quick) — fully
 * silent, no "queued" message, no user-visible difference. This is
 * NOT a request queue or rate limiter; nobody is throttled per-user.
 * It's purely a global cap on simultaneous CPU-heavy ffmpeg work so
 * Render doesn't run out of memory.
 * ─────────────────────────────────────────────────────────────────
 */

const fs   = require('fs')
const path = require('path')
const { spawn } = require('child_process')

// ── Global ffmpeg concurrency limiter (shared across every session) ──
const MAX_CONCURRENT_FFMPEG = 2

let active = 0
const waiting = []

function acquireSlot() {
  if (active < MAX_CONCURRENT_FFMPEG) {
    active++
    return Promise.resolve()
  }
  return new Promise(resolve => waiting.push(resolve))
}

function releaseSlot() {
  active--
  const next = waiting.shift()
  if (next) {
    active++
    next()
  }
}

// Optional: peek at current load (used for logging/health endpoint only)
function converterStatus() {
  return { active, queued: waiting.length, max: MAX_CONCURRENT_FFMPEG }
}

function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    await acquireSlot()

    let tmp, out
    try {
      const tempDir = path.join(__dirname, '../temp')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

      tmp = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
      out = `${tmp}.${ext2}`

      await fs.promises.writeFile(tmp, buffer)

      const proc = spawn('ffmpeg', ['-y', '-i', tmp, ...args, out])

      proc.on('error', (e) => {
        releaseSlot()
        cleanup(tmp, out)
        reject(e)
      })

      proc.on('close', async (code) => {
        try {
          await fs.promises.unlink(tmp).catch(() => {})
          if (code !== 0) {
            releaseSlot()
            return reject(new Error(`ffmpeg exited with code ${code}`))
          }
          const result = await fs.promises.readFile(out)
          await fs.promises.unlink(out).catch(() => {})
          releaseSlot()
          resolve(result)
        } catch (e) {
          releaseSlot()
          reject(e)
        }
      })
    } catch (e) {
      releaseSlot()
      cleanup(tmp, out)
      reject(e)
    }
  })
}

function cleanup(tmp, out) {
  if (tmp) fs.promises.unlink(tmp).catch(() => {})
  if (out) fs.promises.unlink(out).catch(() => {})
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

module.exports = { ffmpeg, toAudio, toPTT, toVideo, detectFormat, converterStatus }
