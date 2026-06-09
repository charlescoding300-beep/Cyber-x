const express = require("express");
const { searchTrack, downloadAudio } = require("./lib/play");

const app = express();

app.get("/play", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).send("Missing query");

    const results = await searchTrack(q);
    if (!results.length) return res.status(404).send("No results");

    const video = results[0];
    const id = video.videoId || video.id;

    const audio = await downloadAudio(id);

    res.setHeader("Content-Type", "audio/ogg");
    res.send(audio);

  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.listen(3000, () => {
  console.log("🔥 CYBER X TERMUX MUSIC API LIVE");
});
