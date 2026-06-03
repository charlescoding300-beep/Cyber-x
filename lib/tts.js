const fs = require("fs")
const path = require("path")
const axios = require("axios")

const tempDir = path.join(__dirname, "../temp")

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true })
}

async function speak(text, voice = "en-US-JennyNeural") {
  try {
    if (!text || text.trim().length === 0) return null

    const filePath = path.join(tempDir, "cyberx.mp3")

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    const res = await axios({
      method: "GET",
      url: "https://api.streamelements.com/kappa/v2/speech",
      params: { voice, text },
      responseType: "arraybuffer"
    })

    fs.writeFileSync(filePath, res.data)

    return filePath

  } catch (err) {
    console.log("TTS ERROR:", err.message)
    return null
  }
}

module.exports = { speak }
