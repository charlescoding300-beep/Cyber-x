// commands/sfx.js — ZEN X Sound Effects Command
// Reply to any audio/voice message and apply an effect
//
// Commands:
//   .fast       → 2x speed (chipmunk energy)
//   .slow       → 0.5x speed (deep slow motion)
//   .robot      → robotic metallic voice
//   .cyber      → cyberpunk glitch distortion
//   .reverse    → plays audio backwards
//   .bass       → heavy bass boost
//   .helium     → high pitched chipmunk
//   .deep       → very deep demon voice
//   .echo       → echo/reverb effect
//   .phone      → old telephone filter
//   .chorus     → chorus/choir effect
//   .tremolo    → wobbling volume effect
//   .vibrato    → wobbling pitch effect
//   .flanger    → sweeping jet-like effect
//   .phaser     → swirling phaser effect
//   .nightcore  → sped up + pitched up (anime remix style)
//   .vaporwave  → slowed down + dreamy chorus
//   .8d         → 8D spinning audio (headphones)
//   .alien      → warbly alien voice
//   .underwater → muffled underwater effect
//   .radio      → old AM radio filter
//   .crush      → 8-bit bitcrushed lo-fi
//   .giant      → huge booming giant voice
//   .ghost      → haunted echoey whisper
//   .drunk      → wobbly disoriented voice
//   .whisper    → soft breathy whisper
//   .earrape    → loud distorted blast (use with care!)
//   .woman      → converts voice to a natural woman's voice
//   .girl       → converts voice to a natural girl's/young voice
//   .man        → converts voice to a natural man's voice
//   .reverb     → dense hall/room reverb (bigger, roomier than .echo)
//
// Requires: ffmpeg installed on server (available on Render)
// Install: npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg

const { exec } = require("child_process")
const fs        = require("fs")
const path      = require("path")
const { downloadMediaMessage } = require("@whiskeysockets/baileys")
const Pino      = require("pino")

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

// ── Try to set ffmpeg path from installer ────────────────────────────────────
let ffmpegPath = "ffmpeg" // default — use system ffmpeg
try {
  ffmpegPath = require("@ffmpeg-installer/ffmpeg").path
} catch {}

const TEMP = path.join(__dirname, "..", "temp")
if (!fs.existsSync(TEMP)) fs.mkdirSync(TEMP, { recursive: true })

// ── FFmpeg filter presets ────────────────────────────────────────────────────
const EFFECTS = {
  fast:       { filter: "atempo=2.0",                                                              label: "⚡ FAST",       emoji: "⚡", category: 'soundeffect' },
  slow:       { filter: "atempo=0.5",                                                              label: "🐢 SLOW",       emoji: "🐢", category: 'soundeffect' },
  robot:      { filter: "asetrate=44100*0.8,atempo=1.25,aecho=0.8:0.88:60:0.4",                  label: "🤖 ROBOT",      emoji: "🤖", category: 'soundeffect' },
  cyber:      { filter: "asetrate=44100*1.2,atempo=0.83,flanger=delay=20:depth=5:speed=0.5,aecho=0.6:0.7:40:0.3", label: "⬣ CYBER", emoji: "⬣", category: 'soundeffect' },
  reverse:    { filter: "areverse",                                                                label: "🔄 REVERSE",    emoji: "🔄", category: 'soundeffect' },
  bass:       { filter: "bass=g=20:f=110:w=0.3,aecho=0.8:0.9:20:0.2",                            label: "🔊 BASS",       emoji: "🔊", category: 'soundeffect' },
  helium:     { filter: "asetrate=44100*1.6,atempo=0.625",                                          label: "🎈 HELIUM",     emoji: "🎈", category: 'soundeffect' },
  deep:       { filter: "asetrate=44100*0.6,atempo=1.666",                                          label: "👹 DEEP",       emoji: "👹", category: 'soundeffect' },
  echo:       { filter: "aecho=0.8:0.9:1000|1800:0.3|0.25",                                        label: "🌊 ECHO",       emoji: "🌊", category: 'soundeffect' },
  phone:      { filter: "highpass=f=300,lowpass=f=3400,aecho=0.8:0.9:15:0.1",                      label: "📞 PHONE",      emoji: "📞", category: 'soundeffect' },
  chorus:     { filter: "chorus=0.5:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3",             label: "🎶 CHORUS",     emoji: "🎶", category: 'soundeffect' },
  tremolo:    { filter: "tremolo=f=5:d=0.8",                                                        label: "🌀 TREMOLO",    emoji: "🌀", category: 'soundeffect' },
  vibrato:    { filter: "vibrato=f=6:d=0.5",                                                        label: "📳 VIBRATO",    emoji: "📳", category: 'soundeffect' },
  flanger:    { filter: "flanger=delay=10:depth=6:speed=0.4",                                       label: "🛸 FLANGER",    emoji: "🛸", category: 'soundeffect' },
  phaser:     { filter: "aphaser=in_gain=0.4:out_gain=0.74:delay=3:decay=0.4:speed=0.5",           label: "🌪️ PHASER",    emoji: "🌪️", category: 'soundeffect' },
  nightcore:  { filter: "asetrate=44100*1.25,atempo=1.05,bass=g=5",                                 label: "🌙 NIGHTCORE",  emoji: "🌙", category: 'soundeffect' },
  vaporwave:  { filter: "asetrate=44100*0.8,atempo=0.9,chorus=0.6:0.9:50:0.4:0.25:2",              label: "🌴 VAPORWAVE",  emoji: "🌴", category: 'soundeffect' },
  "8d":       { filter: "apulsator=hz=0.09",                                                        label: "🎧 8D",         emoji: "🎧", category: 'soundeffect' },
  alien:      { filter: "asetrate=44100*1.3,atempo=0.9,vibrato=f=8:d=0.6",                         label: "👽 ALIEN",      emoji: "👽", category: 'soundeffect' },
  underwater: { filter: "lowpass=f=500,aecho=0.8:0.9:40:0.5",                                       label: "🌊 UNDERWATER", emoji: "🌊", category: 'soundeffect' },
  radio:      { filter: "highpass=f=1000,lowpass=f=3000,acrusher=bits=8:mode=log:aa=1",           label: "📻 RADIO",      emoji: "📻", category: 'soundeffect' },
  crush:      { filter: "acrusher=bits=4:mode=log:aa=1",                                            label: "🕹️ CRUSH",     emoji: "🕹️", category: 'soundeffect' },
  giant:      { filter: "asetrate=44100*0.5,atempo=1.8,bass=g=15",                                  label: "🗿 GIANT",      emoji: "🗿", category: 'soundeffect' },
  ghost:      { filter: "aecho=0.9:0.95:1000:0.7,vibrato=f=3:d=0.3",                               label: "👻 GHOST",      emoji: "👻", category: 'soundeffect' },
  drunk:      { filter: "vibrato=f=3:d=0.9,tremolo=f=2:d=0.7",                                     label: "🍺 DRUNK",      emoji: "🍺", category: 'soundeffect' },
  whisper:    { filter: "highpass=f=500,volume=0.5,aecho=0.6:0.6:20:0.2",                          label: "🤫 WHISPER",    emoji: "🤫", category: 'soundeffect' },
  earrape:    { filter: "volume=15,acrusher=bits=4:mode=log",                                       label: "💥 EARRAPE",    emoji: "💥", category: 'soundeffect' },
  woman:      { filter: "asetrate=44100*1.15,atempo=0.87,aecho=0.6:0.6:15:0.15",                   label: "👩 WOMAN",      emoji: "👩", category: 'soundeffect' },
  girl:       { filter: "asetrate=44100*1.35,atempo=0.74,aecho=0.5:0.5:12:0.12",                   label: "👧 GIRL",       emoji: "👧", category: 'soundeffect' },
  man:        { filter: "asetrate=44100*0.85,atempo=1.18,aecho=0.6:0.6:15:0.15",                   label: "👨 MAN",        emoji: "👨", category: 'soundeffect' },
  reverb:     { filter: "aecho=0.8:0.88:60|120|180|250:0.4|0.3|0.2|0.15",                          label: "🏛️ REVERB",    emoji: "🏛️", category: 'soundeffect' },
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
          text: `> ${effect.emoji} *${effect.label} EFFECT*\n>\n> Reply to a voice/audio message to apply this effect!\n>\n${CREDIT}`
        }, { quoted: msg })
      }

      const hasAudio = quoted.audioMessage || quoted.pttMessage
      const hasVideo = quoted.videoMessage
      if (!hasAudio && !hasVideo) {
        return sock.sendMessage(from, {
          text: `> ${effect.emoji} *${effect.label} EFFECT*\n>\n> ❌ Please reply to an *audio* or *voice* message!\n>\n${CREDIT}`
        }, { quoted: msg })
      }

      // ── React to show processing ──────────────────────────────────────────
      await sock.sendMessage(from, { react: { text: effect.emoji, key: msg.key } })

      const timestamp  = Date.now()
      const inputPath  = path.join(TEMP, `sfx_in_${timestamp}.ogg`)
      const outputPath = path.join(TEMP, `sfx_out_${timestamp}.ogg`)

      try {
        // ── Reconstruct the quoted message so we can download it ──────────
        const quotedKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant

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

        // ── Read output and send straight — no follow-up label message ─────
        const outBuffer = fs.readFileSync(outputPath)
        const isPtt     = !!(quoted.audioMessage?.ptt || quoted.pttMessage)

        await sock.sendMessage(from, {
          audio:    outBuffer,
          ptt:      isPtt,
          mimetype: "audio/ogg; codecs=opus",
        }, { quoted: msg })

        // ── React done ─────────────────────────────────────────────────────
        await sock.sendMessage(from, { react: { text: "✅", key: msg.key } })

      } catch (e) {
        console.error(`[SFX:${effectName}] Error:`, e.message)
        await sock.sendMessage(from, { react: { text: "❌", key: msg.key } })
        await sock.sendMessage(from, {
          text: `> ${effect.emoji} *${effect.label} EFFECT*\n>\n> ❌ Failed: ${e.message}\n>\n> Make sure ffmpeg is installed on the server.\n>\n${CREDIT}`
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
