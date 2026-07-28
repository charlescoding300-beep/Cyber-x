const fs   = require("fs")
const path = require("path")

// ─────────────────────────────────────────────────────────────────────────────
// Shared greet store: data/greet/<phone>.json
//   { groups: { <groupId>: { welcome: {enabled, message}, goodbye: {enabled, message} } } }
// welcome.js and goodbye.js both read/write this same file so index.js's
// single loadGreet(phone, groupId) call returns a consistent view either way.
// ─────────────────────────────────────────────────────────────────────────────
const GREET_DIR = path.join(__dirname, "..", "data", "greet")
if (!fs.existsSync(GREET_DIR)) fs.mkdirSync(GREET_DIR, { recursive: true })

function safePhone(phone) {
  return (phone || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")
}
function filePath(phone) {
  return path.join(GREET_DIR, `${safePhone(phone)}.json`)
}
function loadRaw(phone) {
  const file = filePath(phone)
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    console.error(`[GREET] load error for ${phone}:`, e.message)
  }
  return { groups: {} }
}
function saveRaw(phone, data) {
  try {
    fs.writeFileSync(filePath(phone), JSON.stringify(data, null, 2))
  } catch (e) {
    console.error(`[GREET] save error for ${phone}:`, e.message)
  }
}

// ── Defaults — ON by default, your exact box design ──────────────────────────
const DEFAULT_WELCOME_MSG =
`╭━━❰ 🎊 *WELCOME* 🎊 ❱━━╮

「 @{tag} 」

✨ A new legend has joined *{group}*!

────────────────────
📖 Read the group description.
🤝 Respect every member.
💬 Stay active and have fun.
🚫 No spam or unnecessary links.
────────────────────

👥 *Total Members:* {members}

🌟 We hope you enjoy your stay.
🔥 Let's make unforgettable memories together!

╰━━❰ ❤️ *ENJOY YOUR STAY* ❤️ ❱━━╯

© 𝕮𝖄𝕭𝙴𝚁 𝖃 ™`

const DEFAULT_GOODBYE_MSG =
`╭━━❰ 👋 *GOODBYE* ❱━━╮

@{tag} has left *{group}*.

🥀 Every goodbye marks the start of a new journey.

━━━━━━━━━━━━━━━━━━
💙 Thanks for being part of our community.
🌟 We wish you success and happiness.
🚪 You'll always be welcome back.
━━━━━━━━━━━━━━━━━━

👥 *Members Remaining:* {members}

👋 Farewell & take care!

╰━━━━━━━━━━━━━━━━━━╯

© 𝕮𝖄𝕭𝙴𝚁 𝖃 ™`

function ensureGroupDefaults(data, groupId) {
  if (!data.groups[groupId]) data.groups[groupId] = {}
  if (!data.groups[groupId].welcome) {
    data.groups[groupId].welcome = { enabled: true, message: DEFAULT_WELCOME_MSG }
  }
  if (!data.groups[groupId].goodbye) {
    data.groups[groupId].goodbye = { enabled: true, message: DEFAULT_GOODBYE_MSG }
  }
  return data
}

// The bot's own session number, cleaned of the ":device" suffix — this is
// the correct storage key. Using the group JID here (a past bug) meant
// toggles wrote to the wrong file entirely and never took effect.
function getSessionPhone(sock) {
  const raw = sock?.user?.id || ""
  return raw.split("@")[0].split(":")[0]
}

// Called by index.js: cmdModule.loadGreet(phone, groupId) -> { welcome, goodbye }
// Auto-provisions defaults (enabled: true) the first time a group is seen,
// so welcome/goodbye work out of the box with no setup command required.
function loadGreet(phone, groupId) {
  let data = loadRaw(phone)
  const before = JSON.stringify(data.groups[groupId] || null)
  data = ensureGroupDefaults(data, groupId)
  const after = JSON.stringify(data.groups[groupId])
  if (before !== after) saveRaw(phone, data) // persist auto-provisioned defaults
  return {
    welcome: data.groups[groupId].welcome,
    goodbye: data.groups[groupId].goodbye,
  }
}

function setWelcome(phone, groupId, patch) {
  let data = loadRaw(phone)
  data = ensureGroupDefaults(data, groupId)
  Object.assign(data.groups[groupId].welcome, patch)
  saveRaw(phone, data)
  return data.groups[groupId].welcome
}

module.exports = {
  name:     "welcome",
  aliases:  ["welcomemsg"],
  desc:     "Toggle the welcome message on/off. ON by default.",
  usage:    ".welcome on | .welcome off | .welcome (status)",
  category: "group",
  loadGreet,

  async run({ sock, from, msg, args, isGroup, isOwner, isAdmin, helper }) {
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works inside a group.")
    if (!isOwner && !isAdmin) return helper.reply(sock, msg, "❌ Only group admins or the bot owner can change this.")

    const phone = getSessionPhone(sock)
    const sub = (args[0] || "").toLowerCase()

    if (sub === "on") {
      setWelcome(phone, from, { enabled: true })
      return helper.reply(sock, msg, helper.box("🎊 WELCOME — ENABLED", [
        "Welcome messages are now ON for this group.",
        "New members will get the welcome card automatically.",
      ]))
    }

    if (sub === "off") {
      setWelcome(phone, from, { enabled: false })
      return helper.reply(sock, msg, helper.box("🎊 WELCOME — DISABLED", [
        "Welcome messages are now OFF for this group.",
      ]))
    }

    // No args → show current status
    const current = loadGreet(phone, from).welcome
    return helper.reply(sock, msg, helper.box("🎊 WELCOME STATUS", [
      `Status: ${current.enabled ? "✅ ON" : "❌ OFF"}`,
      "",
      "Commands:",
      ".welcome on / .welcome off",
    ]))
  },
}
