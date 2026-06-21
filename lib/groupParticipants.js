// ─────────────────────────────────────────────────────────────────────────────
// lib/groupParticipants.js  —  CYBER X  (DEBUG BUILD)
//
// Same logic as before, but every step now logs to console so the next
// join/leave event shows EXACTLY where it succeeds or stops — no more
// silent failures.
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb = require("./welcomeDb")

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
    console.log(`[groupParticipants] profilePictureUrl failed for ${jid}: ${err.message} — using fallback`)
  }
  return fallbackUrl
}

async function handleGroupParticipants(sock, update, lib) {
  console.log("[groupParticipants] ▶ handler fired, raw update:", JSON.stringify(update))

  const { id: from, participants, action } = update
  console.log(`[groupParticipants] from=${from} action=${action} participants=${JSON.stringify(participants)}`)

  if (action !== "add" && action !== "remove") {
    console.log(`[groupParticipants] ✗ ignoring action "${action}" (not add/remove)`)
    return
  }

  const isJoin      = action === "add"
  const enabledKey  = isJoin ? "welcome"     : "goodbye"
  const textKey     = isJoin ? "welcomeText" : "goodbyeText"
  const defaultText = isJoin ? DEFAULT_WELCOME : DEFAULT_GOODBYE

  const enabled = welcomeDb.get(from, enabledKey, false)
  console.log(`[groupParticipants] welcomeDb.get(${from}, "${enabledKey}", false) = ${enabled}`)

  if (!enabled) {
    console.log(`[groupParticipants] ✗ ${enabledKey} is OFF for this group — stopping here`)
    return
  }

  const template = welcomeDb.get(from, textKey, defaultText)
  console.log(`[groupParticipants] template = "${template}"`)

  const fallbackImage = isJoin
    ? WELCOME_IMAGE
    : welcomeDb.get(from, "goodbyeImage", GOODBYE_IMAGE)

  let groupName   = "this group"
  let memberCount = participants.length
  try {
    const metadata = lib?.groupCache
      ? await lib.groupCache.get(sock, from)
      : await sock.groupMetadata(from)
    groupName   = metadata.subject
    memberCount = metadata.participants.length
    console.log(`[groupParticipants] groupMetadata OK — name="${groupName}" count=${memberCount}`)
  } catch (err) {
    console.log(`[groupParticipants] groupMetadata FAILED: ${err.message} — using defaults`)
  }

  const date = new Date().toLocaleDateString()

  for (const jid of participants) {
    const name    = jid.split("@")[0]
    const mention = `@${name}`

    const caption = applyTemplate(template, {
      name, mention, group: groupName, count: String(memberCount), date,
    })
    console.log(`[groupParticipants] caption for ${jid}: "${caption}"`)

    const imageUrl = await getProfilePicOrFallback(sock, jid, fallbackImage)
    console.log(`[groupParticipants] imageUrl for ${jid}: ${imageUrl}`)

    try {
      console.log(`[groupParticipants] → calling sock.sendMessage(${from}, {image, caption})...`)
      await sock.sendMessage(from, {
        image:    { url: imageUrl },
        caption,
        mentions: [jid],
      })
      console.log(`[groupParticipants] ✔ sendMessage (image) SUCCEEDED for ${jid}`)
    } catch (err) {
      console.error(`[groupParticipants] ✗ sendMessage (image) FAILED for ${jid}: ${err.message}`)
      try {
        console.log(`[groupParticipants] → falling back to text-only sendMessage...`)
        await sock.sendMessage(from, { text: caption, mentions: [jid] })
        console.log(`[groupParticipants] ✔ sendMessage (text fallback) SUCCEEDED for ${jid}`)
      } catch (err2) {
        console.error(`[groupParticipants] ✗ sendMessage (text fallback) ALSO FAILED for ${jid}: ${err2.message}`)
      }
    }
  }

  console.log("[groupParticipants] ◀ handler finished")
}

function handleGroupUpdate(sock, update) {
  console.log("[groupParticipants] handleGroupUpdate() called from index.js hook")
  return handleGroupParticipants(sock, update)
}

module.exports = { handleGroupParticipants, handleGroupUpdate, DEFAULT_WELCOME, DEFAULT_GOODBYE }
