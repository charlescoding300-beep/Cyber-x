const yts = require("yt-search");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const TMP = path.join(__dirname, "..", "tmp");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);

async function searchTrack(query) {
  const res = await yts(query);
  return res.videos;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function downloadAudio(id) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const file = path.join(TMP, `${Date.now()}.mp3`);

  await run("yt-dlp", [
    url,
    "-x",
    "--audio-format",
    "mp3",
    "-o",
    file
  ]);

  const buffer = fs.readFileSync(file);
  fs.unlinkSync(file);

  return buffer;
}

module.exports = { searchTrack, downloadAudio };
