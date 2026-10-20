'use strict'

// ElevenLabs TTS helper for Character AI voice replies.
// Configure ELEVENLABS_API_KEY, ELEVENLABS_API_KEYS (comma/newline separated),
// or ELEVENLABS_API_KEY_1, ELEVENLABS_API_KEY_2, ... in the process environment.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const DEFAULT_FEMALE_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL' // Sarah, female library voice
const DEFAULT_MALE_VOICE_ID = 'pNInz6obpgDQGcFmaJgB' // Adam, male library voice
const FEMALE_VOICE_ID = process.env.CHARAI_FEMALE_VOICE_ID || process.env.CHARAI_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || DEFAULT_FEMALE_VOICE_ID
const MALE_VOICE_ID = process.env.CHARAI_MALE_VOICE_ID || DEFAULT_MALE_VOICE_ID
const MODEL_ID = process.env.ELEVENLABS_MODEL || 'eleven_v4'
const keyCooldown = new Map()
let keyCursor = 0
let serviceCooldownUntil = 0

let ffmpegPath = 'ffmpeg'
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
  // Baileys uses ffmpeg to probe voice-note duration when available on PATH.
  process.env.PATH = `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH || ''}`
} catch {}

function loadKeys() {
  const keys = []
  for (const value of [process.env.ELEVENLABS_API_KEYS, process.env.ELEVENLABS_API_KEY]) {
    if (value) keys.push(...String(value).split(/[\s,]+/))
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (/^ELEVENLABS_API_KEY_\d+$/.test(name) && value) keys.push(value)
  }
  return [...new Set(keys.map(key => key.trim()).filter(Boolean))]
}

function nextUsableKey(keys) {
  const now = Date.now()
  for (let offset = 0; offset < keys.length; offset++) {
    const index = (keyCursor + offset) % keys.length
    const key = keys[index]
    if ((keyCooldown.get(key) || 0) <= now) {
      keyCursor = (index + 1) % keys.length
      return key
    }
  }
  return null
}

function safeErrorMessage(body, status) {
  try {
    const parsed = JSON.parse(body)
    return parsed?.detail?.message || parsed?.detail?.status || parsed?.message || `HTTP ${status}`
  } catch {
    return `HTTP ${status}`
  }
}

function voiceIdForGender(gender) {
  return String(gender || '').toLowerCase() === 'male' ? MALE_VOICE_ID : FEMALE_VOICE_ID
}

async function synthesizeMp3(text, gender = 'female') {
  const keys = loadKeys()
  if (!keys.length) throw new Error('ELEVENLABS_API_KEY not configured')
  if (serviceCooldownUntil > Date.now()) throw new Error('ElevenLabs rate limit; retry later')

  const cleanText = String(text || '')
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/[*_~`]/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .trim()
    .slice(0, 900)
  if (!cleanText) throw new Error('no text to speak')

  const body = JSON.stringify({
    text: cleanText,
    model_id: MODEL_ID,
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  })
  let lastError = null

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const apiKey = nextUsableKey(keys)
    if (!apiKey) break
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceIdForGender(gender))}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
            Accept: 'audio/mpeg',
          },
          body,
          signal: AbortSignal.timeout(30000),
        },
      )

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'))
        const retryMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 24 * 60 * 60 * 1000)
          : 60_000
        serviceCooldownUntil = Date.now() + retryMs
        lastError = new Error('ElevenLabs rate limit reached')
        break
      }
      if (response.status === 401 || response.status === 403) {
        keyCooldown.set(apiKey, Date.now() + 10 * 60_000)
        lastError = new Error(`ElevenLabs rejected a key (HTTP ${response.status})`)
        continue
      }
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        lastError = new Error(`ElevenLabs ${safeErrorMessage(errorBody, response.status)}`)
        break
      }

      const audio = Buffer.from(await response.arrayBuffer())
      if (audio.length < 500) throw new Error('ElevenLabs returned an empty audio response')
      return audio
    } catch (error) {
      lastError = error
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        keyCooldown.set(apiKey, Date.now() + 30_000)
        break
      }
      break
    }
  }
  throw lastError || new Error('No usable ElevenLabs API key')
}

async function mp3ToWhatsAppVoice(mp3Buffer) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zenx-voice-'))
  const inputPath = path.join(tempDir, 'reply.mp3')
  const outputPath = path.join(tempDir, 'reply.ogg')

  try {
    await fs.promises.writeFile(inputPath, mp3Buffer)
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', inputPath, '-vn', '-ac', '1', '-ar', '48000',
        '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on',
        '-compression_level', '10', '-frame_duration', '60',
        '-application', 'voip', outputPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] })

      let stderr = ''
      let settled = false
      let timer
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        error ? reject(error) : resolve()
      }
      child.stderr.on('data', chunk => {
        if (stderr.length < 4000) stderr += chunk.toString()
      })
      child.once('error', finish)
      child.once('close', code => {
        if (code === 0) return finish()
        finish(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
      })
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error('ffmpeg voice conversion timed out'))
      }, 60_000)
      timer.unref?.()
    })
    return await fs.promises.readFile(outputPath)
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function synthesizeWhatsAppVoice(text, gender = 'female') {
  return mp3ToWhatsAppVoice(await synthesizeMp3(text, gender))
}

module.exports = {
  DEFAULT_VOICE_ID: DEFAULT_FEMALE_VOICE_ID,
  FEMALE_VOICE_ID,
  MALE_VOICE_ID,
  MODEL_ID,
  voiceIdForGender,
  loadKeys,
  synthesizeMp3,
  mp3ToWhatsAppVoice,
  synthesizeWhatsAppVoice,
}
