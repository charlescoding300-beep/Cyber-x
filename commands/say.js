// commands/say.js — ZEN X TTS Command
// .say <text> — speaks the text back as a voice note (Sarah, ElevenLabs)
'use strict'

const https = require("https")
const fs    = require("fs")
const path  = require("path")
const { exec } = require("child_process")

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

// Sarah — premade voice, confirmed available on this account's free tier
const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

// ── ffmpeg path — same fallback pattern as sfx.js ──
let ffmpegPath = "ffmpeg"
try {
  ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
  // Baileys itself shells out to a bare `ffmpeg` command internally to
  // probe audio duration when building a voice-note message. If that's
  // missing, it silently skips the duration field and WhatsApp shows
  // "audio not available" even though the bytes are fine. Since
  // @ffmpeg-installer's binary lives inside node_modules (not on PATH),
  // we expose its folder on PATH here so Baileys' own probe finds it too.
  process.env.PATH = `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH || ""}`
} catch {}

const TEMP = path.join(__dirname, "..", "temp")
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true })

function stripForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, "code block, check the text above")
    .replace(/[*_~`]/g, "")
    .replace(/https?:\/\/\S+/g, "link, check the text above")
    .slice(0, 900) // free tier is 10K chars/month — keep each call small
}

async function elevenLabsTTS(text) {
  const API_KEY = process.env.ELEVENLABS_API_KEY
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not set")

  const clean = stripForSpeech(text)
  const body = JSON.stringify({
    text: clean,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  })

  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.elevenlabs.io",
      path:     `/v1/text-to-speech/${VOICE_ID}`,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "xi-api-key":     API_KEY,
        "Accept":         "audio/mpeg",
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      const chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }))
    })
    req.on("error", reject)
    req.setTimeout(30000, () => req.destroy())
    req.write(body)
    req.end()
  })

  // Non-200 responses come back as JSON error text, not audio
  if (data.status !== 200) {
    let msg = `HTTP ${data.status}`
    try { msg = JSON.parse(data.buffer.toString("utf8"))?.detail?.message || msg } catch {}
    throw new Error(msg)
  }
  if (!data.buffer || data.buffer.length < 500) throw new Error("empty audio response")

  return data.buffer
}

// ── WhatsApp voice notes (ptt) require OGG/Opus, mono, proper VBR settings —
// ElevenLabs returns MP3 stereo, so it has to be transcoded correctly or the
// bubble shows "audio not available" even though bytes technically exist.
function mp3ToOggOpus(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const timestamp  = Date.now()
    const inputPath  = path.join(TEMP, `say_in_${timestamp}.mp3`)
    const outputPath = path.join(TEMP, `say_out_${timestamp}.ogg`)

    fs.writeFileSync(inputPath, mp3Buffer)

    const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -vn -ac 1 -ar 48000 -c:a libopus -b:a 64k -vbr on -compression_level 10 -frame_duration 60 -application voip "${outputPath}"`
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      const cleanup = () => {
        try { fs.unlinkSync(inputPath) } catch {}
        try { fs.unlinkSync(outputPath) } catch {}
      }
      if (err) {
        cleanup()
        return reject(new Error(stderr || err.message))
      }
      try {
        const outBuffer = fs.readFileSync(outputPath)
        cleanup()
        resolve(outBuffer)
      } catch (e) {
        cleanup()
        reject(e)
      }
    })
  })
}

module.exports = {
  pattern:  "say",
  alias:    ["tts"],
  category: "media",
  desc:     "Speak text back as a voice note (Sarah — ElevenLabs)",
  usage:    ".say <text>",

  run: async ({ sock, from, msg, args }) => {
    const text = (args || []).join(" ").trim()

    if (!text) {
      return sock.sendMessage(from, {
        text: `> 🗣️ *SAY*\n>\n> Give me something to say!\n> Usage: *.say <text>*\n>\n${CREDIT}`
      }, { quoted: msg })
    }

    await sock.sendMessage(from, { react: { text: "🗣️", key: msg.key } }).catch(() => {})

    try {
      const mp3Buffer = await elevenLabsTTS(text)
      const oggBuffer = await mp3ToOggOpus(mp3Buffer)

      await sock.sendMessage(from, {
        audio:    oggBuffer,
        mimetype: "audio/ogg; codecs=opus",
        ptt:      true,
      }, { quoted: msg })

      await sock.sendMessage(from, { react: { text: "🗣️", key: msg.key } }).catch(() => {})

    } catch (e) {
      console.error("[SAY] Error:", e.message)
      await sock.sendMessage(from, { react: { text: "❌", key: msg.key } }).catch(() => {})

      const friendly = e.message.includes("ELEVENLABS_API_KEY")
        ? "❌ *ELEVENLABS_API_KEY not set!*\nAdd it to your .env file."
        : e.message.toLowerCase().includes("quota") || e.message.toLowerCase().includes("credit")
        ? "⚠️ *Monthly voice quota used up.* Free tier resets next month!"
        : e.message.toLowerCase().includes("ffmpeg") || e.message.toLowerCase().includes("enoent")
        ? "❌ *ffmpeg not found on server.*\nRun: npm install @ffmpeg-installer/ffmpeg"
        : `❌ *Failed:* ${e.message}`

      await sock.sendMessage(from, {
        text: `> 🗣️ *SAY*\n>\n> ${friendly}\n>\n${CREDIT}`
      }, { quoted: msg })
    }
  }
}
