// commands/sfx.js — CYBER X Sound Effects Command
// Reply to any audio/voice message and apply an effect
//
// Commands:
//   .fast     → 2x speed (chipmunk energy)
//   .slow     → 0.5x speed (deep slow motion)
//   .robot    → robotic metallic voice
//   .cyber    → cyberpunk glitch distortion
//   .reverse  → plays audio backwards
//   .bass     → heavy bass boost
//   .helium   → high pitched chipmunk
//   .deep     → very deep demon voice
//   .echo     → echo/reverb effect
//   .phone    → old telephone filter
//
// Requires: ffmpeg installed on server (available on Render)
// Install: npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg

const { exec } = require("child_process")
const fs        = require("fs")
const path      = require("path")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const Pino      = require("pino")

// ── Try to set ffmpeg path from installer ────────────────────────────────────
let ffmpegPath = "ffmpeg" // default — use system ffmpeg
try {
  ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
} catch {}

const TEMP = path.join(__dirname, "..", "temp")
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true })

// ── FFmpeg filter presets ────────────────────────────────────────────────────
const EFFECTS = {
  fast:    { filter: "atempo=2.0",                                             label: "⚡ FAST",    emoji: "⚡", category: 'soundeffect' },
  slow:    { filter: "atempo=0.5",                                             label: "🐢 SLOW",    emoji: "🐢", category: 'soundeffect' },
  robot:   { filter: "asetrate=44100*0.8,atempo=1.25,aecho=0.8:0.88:60:0.4", label: "🤖 ROBOT",   emoji: "🤖", category: 'soundeffect' },
  cyber:   { filter: "asetrate=44100*1.2,atempo=0.83,flanger=delay=20:depth=5:speed=0.5,aecho=0.6:0.7:40:0.3", label: "⬣ CYBER", emoji: "⬣", category: 'soundeffect' },
  reverse: { filter: "areverse",                                               label: "🔄 REVERSE", emoji: "🔄", category: 'soundeffect' },
  bass:    { filter: "bass=g=20:f=110:w=0.3,aecho=0.8:0.9:20:0.2",          label: "🔊 BASS",    emoji: "🔊", category: 'soundeffect' },
  helium:  { filter: "asetrate=44100*1.6,atempo=0.625",                       label: "🎈 HELIUM",  emoji: "🎈", category: 'soundeffect' },
  deep:    { filter: "asetrate=44100*0.6,atempo=1.666",                       label: "👹 DEEP",    emoji: "👹", category: 'soundeffect' },
  echo:    { filter: "aecho=0.8:0.9:1000|1800:0.3|0.25",                     label: "🌊 ECHO",    emoji: "🌊", category: 'soundeffect' },
  phone:   { filter: "highpass=f=300,lowpass=f=3400,aecho=0.8:0.9:15:0.1",   label: "📞 PHONE",   emoji: "📞", category: 'soundeffect' },
}

// ── Helper: run ffmpeg command ───────────────────────────────────────────────
function runFFmpeg(inputPath, outputPath, filter) {
  return new Promise((resolve, reject) => {
    const cmd = `"${ffmpegPath}" -y -i "${inputPath}" -af "${filter}" -c:a libopus -b:a 64k "${outputPath}"`
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve(outputPath)
    })
  })
}

// ── Helper: delete temp files ────────────────────────────────────────────────
function cleanup(...files) {
  for (const f of files) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch {} }
}

// ── Build one command handler ─────────────────────────────────────────────────
function makeSfxCommand(effectName) {
  const effect = EFFECTS[effectName]
  return {
    pattern:  effectName,
    category: effect.category || "MEDIA",
    desc:     `Apply ${effect.label} effect to a replied audio`,
    usage:    `.${effectName} (reply to an audio/voice message)`,

    async run({ sock, from, msg, helper }) {
      // ── Must be a reply to an audio/voice message ─────────────────────────
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      if (!quoted) {
        return sock.sendMessage(from, {
          text: `${effect.emoji} *${effect.label} EFFECT*\n\nReply to a voice/audio message to apply this effect!\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        }, { quoted: msg })
      }

      const hasAudio = quoted.audioMessage || quoted.pttMessage
      const hasVideo = quoted.videoMessage
      if (!hasAudio && !hasVideo) {
        return sock.sendMessage(from, {
          text: `${effect.emoji} *${effect.label} EFFECT*\n\n❌ Please reply to an *audio* or *voice* message!\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        }, { quoted: msg })
      }

      // ── React to show processing ──────────────────────────────────────────
      await sock.sendMessage(from, { react: { text: effect.emoji, key: msg.key } })

      const statusMsg = await sock.sendMessage(from, {
        text: `${effect.emoji} *Applying ${effect.label} effect...*\n⏳ Processing audio, please wait...`
      }, { quoted: msg })

      const timestamp  = Date.now()
      const inputPath  = path.join(TEMP, `sfx_in_${timestamp}.ogg`)
      const outputPath = path.join(TEMP, `sfx_out_${timestamp}.ogg`)

      try {
        // ── Reconstruct the quoted message so we can download it ──────────
        // We need to fake a full message object for downloadMediaMessage
        const quotedKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant

        // Build a minimal message wrapper for download
        const fakeMsg = {
          key: {
            remoteJid: from,
            id:        quotedKey || "fake",
            participant: quotedParticipant,
          },
          message: quoted,
        }

        // ── Download the audio ─────────────────────────────────────────────
        const buffer = await downloadMediaMessage(
          fakeMsg,
          "buffer",
          {},
          { logger: Pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
        )

        if (!buffer || buffer.length === 0) throw new Error("Could not download audio")

        // ── Save to temp ───────────────────────────────────────────────────
        fs.writeFileSync(inputPath, buffer)

        // ── Run FFmpeg with the effect ─────────────────────────────────────
        await runFFmpeg(inputPath, outputPath, effect.filter)

        // ── Read output and send ───────────────────────────────────────────
        const outBuffer = fs.readFileSync(outputPath)
        const isPtt     = !!(quoted.audioMessage?.ptt || quoted.pttMessage)

        await sock.sendMessage(from, {
          audio:    outBuffer,
          ptt:      isPtt,
          mimetype: "audio/ogg; codecs=opus",
        }, { quoted: msg })

        // ── Send success label ─────────────────────────────────────────────
        await sock.sendMessage(from, {
          text: `${effect.emoji} *${effect.label} EFFECT APPLIED* ✅\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        })

        // ── React done ─────────────────────────────────────────────────────
        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } })

      } catch (e) {
        console.error(`[SFX:${effectName}] Error:`, e.message)
        await sock.sendMessage(from, { react: { text: "❌", key: msg.key } })
        await sock.sendMessage(from, {
          text: `${effect.emoji} *${effect.label} EFFECT*\n\n❌ Failed: ${e.message}\n\nMake sure ffmpeg is installed on the server.\n\n© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™`
        }, { quoted: msg })
      } finally {
        cleanup(inputPath, outputPath)
      }
    }
  }
}

// ── Export the FIRST effect as default (index.js loads pattern + run) ────────
// All effects are registered via the sfxList export below
module.exports = makeSfxCommand("fast")

// ── Also export all effects so a loader can register them all ────────────────
module.exports.sfxList = Object.keys(EFFECTS).map(makeSfxCommand)
module.exports.EFFECTS = EFFECTS
