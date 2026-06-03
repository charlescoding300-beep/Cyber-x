// ─────────────────────────────
// BOT SETTINGS MODULE
// ─────────────────────────────

const settings = {
  // ───── BRAND ─────
  botName: "𝘾𝙔𝘽𝙀𝙍 𝙓",
  prefix: ".",

  owner: process.env.OWNER_NUMBER || "",

  // ───── FEATURES (DEFAULTS) ─────
  autoRead: true,
  autoTyping: true,
  antiLink: false,
  welcome: true,
  goodbye: true,

  // ───── SHIVAN AI SYSTEM ─────
  shivanAI: true,
  shivanTrigger: "?", // AI activates only when ? exists
  shivanVoice: "en-US-JennyNeural",

  // ───── SYSTEM ─────
  version: "2.0.0",
  mode: "public" // public | private
}

// ───────── TOGGLE SYSTEM ─────────
function toggleSetting(key) {
  if (settings[key] === undefined) return null
  settings[key] = !settings[key]
  return settings[key]
}

// ───────── GET SETTINGS ─────────
function getSettings() {
  return settings
}

module.exports = {
  settings,
  toggleSetting,
  getSettings
}
