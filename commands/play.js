// commands/play.js — CYBER X AI (Audio Only)
const { exec } = require("child_process")
const fs       = require("fs")
const path     = require("path")
const axios    = require("axios")
const util     = require("util")

const execAsync = util.promisify(exec)
const CREDIT    = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"
const TMP       = "/tmp/𝘾𝙔𝘽𝙀𝙍 𝙓"

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

function cleanName(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

async function searchYouTube(query) {
  const { stdout } = await execAsync(
    `yt-dlp "ytsearch1:${query}" --dump-json --no-playlist --no-warnings`
  )
  return JSON.parse(stdout.trim())
}

async function getThumbnail(url) {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer" })
    return Buffer.from(res.data)
  } catch {
    return null
  }
}

module.exports = {
  pattern: /^\.(play|song)$/,

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(" ").trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
          `🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  PLAY — Usage*\n\n` +
          `*.play <song name>*\n` +
          `*.song <song name>*\n\n` +
          `*Examples:*\n` +
          `• .play Burna Boy Last Last\n` +
          `• .song Afrobeats mix 2024\n` +
          `• .play Weeknd Blinding Lights\n\n` +
          `> ${CREDIT}`
      }, { quoted: msg })
    }

    // ── Searching notice ──────────────────────────────────────────────────────
    await sock.sendMessage(from, {
      text: `🔍 *𝘾𝙔𝘽𝙀𝙍 𝙓  AI*\n\n🎵 Searching: _${query}_\nPlease wait...\n\n> ${CREDIT}`
    }, { quoted: msg })

    await sock.sendPresenceUpdate("recording", from)

    const fileId   = `${Date.now()}_${cleanName(query)}`
    const audioOut = path.join(TMP, `${fileId}.mp3`)

    try {
      // ── Search YouTube ──────────────────────────────────────────────────────
      const info = await searchYouTube(query)

      const title    = info.title      || query
      const uploader = info.uploader   || "Unknown Artist"
      const duration = info.duration   ? formatDuration(info.duration) : "?"
      const vidUrl   = info.webpage_url || info.url
      const thumbUrl = info.thumbnail  || null
      const views    = info.view_count
        ? Number(info.view_count).toLocaleString()
        : "?"

      // ── Duration guard ──────────────────────────────────────────────────────
      if (info.duration > 600) {
        return sock.sendMessage(from, {
          text:
            `❌ Song too long (max 10 mins).\n` +
            `Found: _${title}_ (${formatDuration(info.duration)})\n\n` +
            `> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Download audio ──────────────────────────────────────────────────────
      await execAsync(
        `yt-dlp -x --audio-format mp3 --audio-quality 0 ` +
        `--no-playlist --no-warnings ` +
        `-o "${audioOut}" "${vidUrl}"`
      )

      const audioBuf = fs.readFileSync(audioOut)

      // ── Send thumbnail + info ───────────────────────────────────────────────
      const thumb = thumbUrl ? await getThumbnail(thumbUrl) : null

      if (thumb) {
        await sock.sendMessage(from, {
          image: thumb,
          caption:
            `╔═══════════════════╗\n` +
            `║   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  PLAY*  ║\n` +
            `╚═══════════════════╝\n\n` +
            `🎵 *${title}*\n` +
            `👤 *Artist:* ${uploader}\n` +
            `⏱️ *Duration:* ${duration}\n` +
            `👁️ *Views:* ${views}\n\n` +
            `> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Send audio ──────────────────────────────────────────────────────────
      await sock.sendMessage(from, {
        audio: audioBuf,
        mimetype: "audio/mpeg",
        ptt: false
      })

      // ── Cleanup ─────────────────────────────────────────────────────────────
      fs.unlinkSync(audioOut)

    } catch (e) {
      console.error("PLAY ERROR:", e.message)
      try { if (fs.existsSync(audioOut)) fs.unlinkSync(audioOut) } catch {}
      await sock.sendMessage(from, {
        text: `⚠️ Could not download: _${query}_\nTry a different search.\n\n> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}
