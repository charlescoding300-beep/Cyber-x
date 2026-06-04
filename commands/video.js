// commands/video.js — CYBER X AI (Video Only | Render Stable)

const { exec } = require("child_process")
const fs       = require("fs")
const path     = require("path")
const axios    = require("axios")
const util     = require("util")

const execAsync = util.promisify(exec)

const CREDIT = "© 𝕮𝖄𝕭𝕰𝕽 𝖃"

// ─────────────────────────────────────────────────────────
// Render-safe temp directory (DO NOT use /tmp unicode folders)
// ─────────────────────────────────────────────────────────

const TMP = path.join(process.cwd(), "tmp", "cyberx")

if (!fs.existsSync(TMP)) {
  fs.mkdirSync(TMP, { recursive: true })
}

// ─────────────────────────────────────────────────────────

function cleanName(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

// ─────────────────────────────────────────────────────────
// YouTube search (yt-dlp required on Render)
// ─────────────────────────────────────────────────────────

async function searchYouTube(query) {
  const { stdout } = await execAsync(
    `yt-dlp "ytsearch1:${query}" --dump-json --no-playlist --no-warnings`
  )
  return JSON.parse(stdout.trim())
}

// ─────────────────────────────────────────────────────────

async function getThumbnail(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000
    })
    return Buffer.from(res.data)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────

module.exports = {
  pattern: "video",

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(" ").trim()

    if (!query) {
      return sock.sendMessage(from, {
        text:
          `🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓  VIDEO — Usage*\n\n` +
          `*.video <video name>*\n\n` +
          `*Examples:*\n` +
          `• .video Burna Boy Last Last\n` +
          `• .video Funny cats compilation\n` +
          `• .video Ronaldo skills 2024\n\n` +
          `⚠️ Max duration: *5 minutes*\n\n` +
          `> ${CREDIT}`
      }, { quoted: msg })
    }

    await sock.sendMessage(from, {
      text:
        `🔍 *𝘾𝙔𝘽𝙀𝙍 𝙓  AI*\n\n` +
        `🎬 Searching: _${query}_\nPlease wait...\n\n` +
        `> ${CREDIT}`
    }, { quoted: msg })

    await sock.sendPresenceUpdate("recording", from)

    const fileId   = `${Date.now()}_${cleanName(query)}`
    const videoOut = path.join(TMP, `${fileId}.mp4`)

    try {
      // ── Search YouTube ─────────────────────────────────────────────
      const info = await searchYouTube(query)

      const title    = info.title || query
      const uploader = info.uploader || "Unknown"
      const duration = info.duration ? formatDuration(info.duration) : "?"
      const vidUrl   = info.webpage_url || info.url
      const thumbUrl = info.thumbnail || null
      const views    = info.view_count
        ? Number(info.view_count).toLocaleString()
        : "?"

      // ── Duration Guard (Render-safe) ───────────────────────────────
      if (info.duration > 300) {
        return sock.sendMessage(from, {
          text:
            `❌ Video too long (max 5 mins)\n` +
            `Found: _${title}_ (${formatDuration(info.duration)})\n\n` +
            `> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Thumbnail ───────────────────────────────────────────────────
      const thumb = thumbUrl ? await getThumbnail(thumbUrl) : null

      if (thumb) {
        await sock.sendMessage(from, {
          image: thumb,
          caption:
            `╔═══════════════════╗\n` +
            `║  🎬 *𝘾𝙔𝘽𝙀𝙍 𝙓  VIDEO*  ║\n` +
            `╚═══════════════════╝\n\n` +
            `🎬 *${title}*\n` +
            `👤 *Channel:* ${uploader}\n` +
            `⏱️ *Duration:* ${duration}\n` +
            `👁️ *Views:* ${views}\n\n` +
            `⏳ _Downloading video..._\n\n` +
            `> ${CREDIT}`
        }, { quoted: msg })
      }

      // ── Download (Render-safe yt-dlp) ──────────────────────────────
      await execAsync(
        `yt-dlp -f "bv*+ba/best" --merge-output-format mp4 ` +
        `--no-playlist --no-warnings ` +
        `-o "${videoOut}" "ytsearch1:${query}"`
      )

      if (!fs.existsSync(videoOut)) {
        throw new Error("Download failed or file missing")
      }

      const videoBuf = fs.readFileSync(videoOut)

      // ── Send video (safe for Render memory) ────────────────────────
      await sock.sendMessage(from, {
        video: videoBuf,
        mimetype: "video/mp4",
        caption:
          `🎬 *${title}*\n\n` +
          `👤 ${uploader}\n` +
          `⏱️ ${duration}\n\n` +
          `> ${CREDIT}`
      }, { quoted: msg })

      // ── Cleanup ────────────────────────────────────────────────────
      try {
        fs.unlinkSync(videoOut)
      } catch {}

    } catch (e) {
      console.error("VIDEO ERROR:", e.message)

      try {
        if (fs.existsSync(videoOut)) fs.unlinkSync(videoOut)
      } catch {}

      await sock.sendMessage(from, {
        text:
          `⚠️ Could not download video\n` +
          `Try a shorter or different query.\n\n` +
          `> ${CREDIT}`
      }, { quoted: msg })
    }
  }
}
