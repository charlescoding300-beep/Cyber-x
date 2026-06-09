const axios = require("axios");

const TERMUX_URL = process.env.TERMUX_URL;

async function downloadAudio(query) {
  const res = await axios.get(
    `${TERMUX_URL}/play?q=${encodeURIComponent(query)}`,
    { responseType: "arraybuffer" }
  );

  return Buffer.from(res.data);
}

module.exports = { downloadAudio };
