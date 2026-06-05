// lib/say.js — CYBER X EDGE TTS ENGINE (STABLE)

const fs = require("fs")
const path = require("path")
const { exec } = require("child_process")
const util = require("util")

const execAsync = util.promisify(exec)

const TMP = path.join(process.cwd(), "tmp", "cyberx")

if (!fs.existsSync(TMP)) {
  fs.mkdirSync(TMP, { recursive: true })
}

// USA FEMALE VOICE (CYBER DEFAULT)
const VOICE = "en-US-JennyNeural"

async function say(text) {
  if (!text || !text.trim()) throw new Error("No text provided")

  const file = path.join(TMP, `${Date.now()}.mp3`)

  try {
    await execAsync(
      `npx edge-tts --text "${text.replace(/"/g, "'")}" --voice ${VOICE} --write-media "${file}"`
    )

    if (!fs.existsSync(file)) {
      throw new Error("Audio file not created")
    }

    return file
  } catch (err) {
    console.log("SAY ENGINE ERROR:", err.message)
    throw err
  }
}

module.exports = { say }
