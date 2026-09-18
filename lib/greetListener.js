// ─────────────────────────────────────────────────────────────────────────────
// lib/greetListener.js  —  CYBER X
//
// Welcome/goodbye handler — now wired through the shared `lib` bucket the
// same way lib.handleBadword / lib.handleAntilink work, instead of using
// its own direct sock.ev.on(...) registration.
//
// Exports handleGreetEvent(sock, update) — index.js's existing
// group-participants.update listener calls this automatically once it's
// merged onto `lib` by the lib/ auto-loader, via:
//
//   if (typeof lib.handleGreetEvent === "function") lib.handleGreetEvent(sock, update).catch(...)
//
// NOTE ON NAMING: deliberately NOT named handleGroupUpdate. That name is
// already used by lib/groupParticipants.js (and/or lib/goodbye.js) in this
// project. loadDir() merges every lib/ file's exports onto one shared
// object in alphabetical load order, so two files exporting the same
// function name means whichever loads last silently overwrites the
// other, with no error. groupParticipants.js loads after greetListener.js
// alphabetically, so it would always win that collision. handleGreetEvent
// is a unique name chosen to avoid that entirely.
//
// Storage: own file, lib/greetStore.js. Independent of welcomeDb.js or any
// other storage system in this project.
//
// Variables in templates: {name} {mention} {group} {count} {date}
//   EXTENDED: {tag} {number} {bio} {time} {day} {role}
//   (tag is the same as mention; number is the same as name — both kept
//   for readability inside templates)
//
// Final send text is ALWAYS rendered WhatsApp gray-quote + bold, applied
// after template substitution — so both the built-in defaults below and
// any custom text a group has saved via greetwelcome.js/greetgoodbye.js
// come out styled the same way, with no need to re-save anything.
//
// DEBUG: [greetListener] console.log lines below trace the event path.
// Remove once confirmed working in production.
// ─────────────────────────────────────────────────────────────────────────────

const greetStore = require("./greetStore")

const WELCOME_IMAGE = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const GOODBYE_IMAGE = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

const DEFAULT_WELCOME =
`╭━━━〔 𓃦 ZΞN X 〕━━━╮
┃  👋 WELCOME NEW MEMBER
╰━━━━━━━━━━━━━━━━━━╯

👤 Name    : {mention}
🏷️ Tag     : {tag}
📝 Bio     : {bio}
📱 Number  : +{number}

📅 Joined  : {date}
⏰ Time    : {time}
📆 Day     : {day}

👥 Group   : {group}
🔢 Members : {count}
🛡️ Role    : {role}

━━━━━━━━━━━━━━━━━━━━
✨ Welcome to the group!

© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

const DEFAULT_GOODBYE =
`╭━━━〔 𓃦 ZΞN X 〕━━━╮
┃  👋 GOODBYE MEMBER
╰━━━━━━━━━━━━━━━━━━╯

👤 Name    : {mention}
🏷️ Tag     : {tag}
📝 Bio     : {bio}
📱 Number  : +{number}

📅 Left    : {date}
⏰ Time    : {time}
📆 Day     : {day}

👥 Group   : {group}
🔢 Members : {count}
🛡️ Role    : {role}

━━━━━━━━━━━━━━━━━━━━
👋 Goodbye, {mention}!
💙 We wish you all the best.

© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦`

function applyTemplate(template, { name, mention, group, count, date, tag, number, bio, time, day, role }) {
  return template
    .replace(/{name}/g, name)
    .replace(/{mention}/g, mention)
    .replace(/{group}/g, group)
    .replace(/{count}/g, count)
    .replace(/{date}/g, date)
    .replace(/{tag}/g, tag)
    .replace(/{number}/g, number)
    .replace(/{bio}/g, bio)
    .replace(/{time}/g, time)
    .replace(/{day}/g, day)
    .replace(/{role}/g, role)
}

// WhatsApp gray-quote + bold, every line, applied after template substitution
// so custom-saved text gets styled the same way as the defaults.
function grayBold(raw) {
  return raw
    .split("\n")
    .map(line => (line.length ? `> *${line}*` : ">"))
    .join("\n")
}

// ── Read-more truncation (same technique used in .menu) ────────────────
// A short visible head, then a wall of invisible zero-width spaces, forces
// WhatsApp's native "Read more" to appear. Tapping it reveals the rest.
const READMORE_PAD = "\u200B".repeat(4000)
const GREET_HEAD_LINES = 5 // box-top, title, box-bottom, blank line, Name line

function splitForReadMore(rawText, headLineCount) {
  const lines = rawText.split("\n")
  const head = lines.slice(0, headLineCount).join("\n")
  const rest = lines.slice(headLineCount).join("\n")
  return { head, rest }
}

async function getBio(sock, jid) {
  try {
    const res = await sock.fetchStatus(jid)
    if (res?.status) return res.status
  } catch {}
  return "No bio set"
}

function getDateTimeParts() {
  const now = new Date()
  const tz = { timeZone: "Africa/Lagos" }
  return {
    date: now.toLocaleDateString("en-GB", tz),
    time: now.toLocaleTimeString("en-US", { ...tz, hour: "2-digit", minute: "2-digit", hour12: true }),
    day:  now.toLocaleDateString("en-US", { ...tz, weekday: "long" }),
  }
}

function getRole(metadata, jid) {
  const p = metadata?.participants?.find(pt => pt.id === jid)
  if (p?.admin === "superadmin") return "Super Admin"
  if (p?.admin === "admin") return "Admin"
  return "Member"
}

async function getProfilePicOrFallback(sock, jid, fallbackUrl) {
  const delays = [0, 150, 300, 600] // immediate, then 3 quick retries
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]))
    try {
      const url = await sock.profilePictureUrl(jid, "image")
      if (url) return url
    } catch (err) {
      if (i === delays.length - 1) {
        console.log(`[greetListener] profilePictureUrl FAILED for ${jid} after ${delays.length} attempts: ${err.message} — using fallback`)
      }
    }
  }
  return fallbackUrl
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER — called from index.js's group-participants.update listener
// as lib.handleGreetEvent(sock, update).
// ─────────────────────────────────────────────────────────────────────────────
async function handleGreetEvent(sock, event) {
  const { id: from, participants, action } = event

  console.log("[greetListener] event received:", { from, action, participants })

  if (action !== "add" && action !== "remove") {
    console.log("[greetListener] skipped — action not add/remove:", action)
    return
  }

  const isJoin      = action === "add"
  const enabledKey  = isJoin ? "welcomeEnabled" : "goodbyeEnabled"
  const textKey     = isJoin ? "welcomeText"    : "goodbyeText"
  const defaultText = isJoin ? DEFAULT_WELCOME  : DEFAULT_GOODBYE

  const enabled = greetStore.get(from, enabledKey, false)
  console.log("[greetListener] enabled check:", { from, enabledKey, enabled })
  if (!enabled) return

  const template = greetStore.get(from, textKey, defaultText)
  const fallbackImage = isJoin ? WELCOME_IMAGE : GOODBYE_IMAGE

  let groupName   = "this group"
  let memberCount = participants.length
  let metadata    = null
  try {
    metadata    = await sock.groupMetadata(from)
    groupName   = metadata.subject
    memberCount = metadata.participants.length
  } catch (err) {
    console.log("[greetListener] groupMetadata fetch failed:", err.message)
    // use defaults above
  }

  const { date, time, day } = getDateTimeParts()

  for (const jid of participants) {
    const name    = jid.split("@")[0]
    const mention = `@${name}`
    const role    = getRole(metadata, jid)

    // Fire both network calls at once — no reason to wait on bio before
    // starting the picture fetch, they're independent.
    const [bio, imageUrl] = await Promise.all([
      getBio(sock, jid),
      getProfilePicOrFallback(sock, jid, fallbackImage),
    ])

    const rawCaption = applyTemplate(template, {
      name, mention, group: groupName, count: String(memberCount), date,
      tag: mention, number: name, bio, time, day, role,
    })

    const { head, rest } = splitForReadMore(rawCaption, GREET_HEAD_LINES)
    const caption = `${grayBold(head)}\n${READMORE_PAD}\n${grayBold(rest)}`

    console.log("[greetListener] sending for:", jid)

    try {
      await sock.sendMessage(from, { image: { url: imageUrl }, caption, mentions: [jid] })
      console.log("[greetListener] ✔ image message sent for", jid)
    } catch (err) {
      console.log("[greetListener] ✗ image send failed, trying text fallback:", err.message)
      try {
        await sock.sendMessage(from, { text: caption, mentions: [jid] })
        console.log("[greetListener] ✔ text fallback sent for", jid)
      } catch (err2) {
        console.error(`[greetListener] ✗ failed to send for ${jid}: ${err2.message}`)
      }
    }
  }
}

module.exports = { handleGreetEvent, DEFAULT_WELCOME, DEFAULT_GOODBYE }
