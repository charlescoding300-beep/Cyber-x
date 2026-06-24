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
//
// DEBUG: [greetListener] console.log lines below trace the event path.
// Remove once confirmed working in production.
// ─────────────────────────────────────────────────────────────────────────────

const greetStore = require("./greetStore")

const WELCOME_IMAGE = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const GOODBYE_IMAGE = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

const DEFAULT_WELCOME = "Welcome to {group}, {mention}! 🎉"
const DEFAULT_GOODBYE = "Goodbye {mention}, we'll miss you! 😢"

function applyTemplate(template, { name, mention, group, count, date }) {
  return template
    .replace(/{name}/g, name)
    .replace(/{mention}/g, mention)
    .replace(/{group}/g, group)
    .replace(/{count}/g, count)
    .replace(/{date}/g, date)
}

async function getProfilePicOrFallback(sock, jid, fallbackUrl) {
  try {
    const url = await sock.profilePictureUrl(jid, "image")
    if (url) return url
  } catch (err) {
    // No photo, privacy block, rate limit — expected, fall through
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
  try {
    const metadata = await sock.groupMetadata(from)
    groupName   = metadata.subject
    memberCount = metadata.participants.length
  } catch (err) {
    console.log("[greetListener] groupMetadata fetch failed:", err.message)
    // use defaults above
  }

  const date = new Date().toLocaleDateString()

  for (const jid of participants) {
    const name    = jid.split("@")[0]
    const mention = `@${name}`

    const caption = applyTemplate(template, {
      name, mention, group: groupName, count: String(memberCount), date,
    })

    const imageUrl = await getProfilePicOrFallback(sock, jid, fallbackImage)

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
