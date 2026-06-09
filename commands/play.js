const { downloadAudio, searchTrack } = require("../lib/play");

const CREDIT = "> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™";

function fmtViews(n) {
  if (!n) return "N/A";
  const num = parseInt(n.toString().replace(/,/g, ""));
  if (isNaN(num)) return "N/A";
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B 🔥`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M 🔥`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function fmtDuration(sec) {
  if (!sec) return "N/A";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

module.exports = {
  pattern: "play",

  run: async ({ sock, from, msg, args }) => {
    const query = args.join(" ").trim();

    if (!query) {
      return sock.sendMessage(from, {
        text: "❌ Usage: .play <song name>"
      }, { quoted: msg });
    }

    // ───────── SEARCH MESSAGE ─────────
    const searching = await sock.sendMessage(from, {
      text: `🔎 Searching: *${query}*...`
    }, { quoted: msg });

    try {
      const results = await searchTrack(query);
      if (!results.length) {
        return sock.sendMessage(from, {
          text: "❌ No results found"
        }, { quoted: msg });
      }

      const video = results[0];

      const card =
`┏━━━━━━━━━━━━━━━━━━━━━━━┓
   🎵 *𝘾𝙔𝘽𝙀𝙍 𝙓  𝙈𝙐𝙎𝙄𝘾* 🎵
┗━━━━━━━━━━━━━━━━━━━━━━━┛

🎼 *Title*    » ${video.title}
🎤 *Artist*   » ${video.author?.name || "Unknown"}
⏱️ *Duration* » ${fmtDuration(video.duration?.seconds || video.duration)}
👁️ *Views*    » ${fmtViews(video.views)}
📅 *Uploaded* » ${video.ago || "N/A"}
📺 *Platform* » YouTube
🔗 *Link*     » https://youtu.be/${video.videoId || video.id}

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
⬇️ *Downloading & converting...*
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

${CREDIT}`;

      // ───────── DELETE SEARCH MESSAGE ─────────
      try {
        await sock.sendMessage(from, {
          delete: searching.key
        });
      } catch {}

      // ───────── SEND CARD ─────────
      const infoMsg = await sock.sendMessage(from, {
        text: card
      }, { quoted: msg });

      // ───────── GET AUDIO FROM LIB ─────────
      const audio = await downloadAudio(query);

      // ───────── SEND AUDIO ─────────
      await sock.sendMessage(from, {
        audio,
        mimetype: "audio/ogg; codecs=opus",
        ptt: false
      }, { quoted: infoMsg });

    } catch (e) {
      console.error("[PLAY ERROR]", e.message);

      await sock.sendMessage(from, {
        text: `❌ Error: ${e.message}\n\n${CREDIT}`
      }, { quoted: msg });
    }
  }
};
