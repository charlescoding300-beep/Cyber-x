const fs   = require("fs")
const path = require("path")

// Shares the exact same data/greet/<phone>.json store as welcome.js —
// see welcome.js for the file format. Duplicated small helpers here on
// purpose so this file has zero cross-require dependency on welcome.js;
// index.js expects each module to independently expose loadGreet().
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

function loadGreet(phone, groupId) {
  let data = loadRaw(phone)
  const before = JSON.stringify(data.groups[groupId] || null)
  data = ensureGroupDefaults(data, groupId)
  const after = JSON.stringify(data.groups[groupId])
  if (before !== after) saveRaw(phone, data)
  return {
    welcome: data.groups[groupId].welcome,
    goodbye: data.groups[groupId].goodbye,
  }
}

function setGoodbye(phone, groupId, patch) {
  let data = loadRaw(phone)
  data = ensureGroupDefaults(data, groupId)
  Object.assign(data.groups[groupId].goodbye, patch)
  saveRaw(phone, data)
  return data.groups[groupId].goodbye
}

module.exports = {
  name:     "goodbye",
  aliases:  ["goodbyemsg", "leave"],
  desc:     "Toggle the goodbye message on/off. ON by default.",
  usage:    ".goodbye on | .goodbye off | .goodbye (status)",
  category: "group",
  loadGreet,

  async run({ sock, from, msg, args, isGroup, isOwner, isAdmin, helper }) {
    if (!isGroup) return helper.reply(sock, msg, "❌ This command only works inside a group.")
    if (!isOwner && !isAdmin) return helper.reply(sock, msg, "❌ Only group admins or the bot owner can change this.")

    const phone = getSessionPhone(sock)
    const sub = (args[0] || "").toLowerCase()

    if (sub === "on") {
      setGoodbye(phone, from, { enabled: true })
      return helper.reply(sock, msg, helper.box("👋 GOODBYE — ENABLED", [
        "Goodbye messages are now ON for this group.",
        "Members who leave will get the goodbye card automatically.",
      ]))
    }

    if (sub === "off") {
      setGoodbye(phone, from, { enabled: false })
      return helper.reply(sock, msg, helper.box("👋 GOODBYE — DISABLED", [
        "Goodbye messages are now OFF for this group.",
      ]))
    }

    const current = loadGreet(phone, from).goodbye
    return helper.reply(sock, msg, helper.box("👋 GOODBYE STATUS", [
      `Status: ${current.enabled ? "✅ ON" : "❌ OFF"}`,
      "",
      "Commands:",
      ".goodbye on / .goodbye off",
    ]))
  },
}
