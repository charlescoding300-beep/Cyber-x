// ─────────────────────────────────────────────────────────────────────────────
// lib/groupParticipants.js  —  CYBER X
//
// Listens for group-participants.update (join/leave) and sends the
// welcome/goodbye message configured via commands/welcome.js / commands/goodbye.js
// (settings stored in welcomeDb).
//
// Profile picture logic:
//   1. Try to fetch the JOINING/LEAVING USER's own WhatsApp profile picture.
//   2. If that fails for any reason (no photo set, privacy setting blocks it,
//      rate limited, network error) — fall back to:
//        - WELCOME_IMAGE  for joins
//        - goodbyeImage in welcomeDb (set by commands/goodbye.js) for leaves,
//          falling back further to GOODBYE_IMAGE if that key isn't set.
//
// Exports DEFAULT_WELCOME / DEFAULT_GOODBYE — both commands/welcome.js and
// commands/goodbye.js already import these from this file.
//
// Wire-up: index.js already has a group-participants.update listener (it
// refreshes state.groupCache). Add ONE line inside that existing handler —
// do not register a second sock.ev.on for the same event, since that means
// two parallel sock.groupMetadata() calls per join/leave instead of one:
//
//   sock.ev.on("group-participants.update", async (update) => {
//     try { state.groupCache[update.id] = { ...(await sock.groupMetadata(update.id)), _cachedAt: Date.now() } } catch {}
//     lib.groupParticipants.handleGroupParticipants(sock, update, lib).catch(e => console.error("[welcome/goodbye]", e.message))
//   })
//
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb = require("./welcomeDb")

const WELCOME_IMAGE = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const GOODBYE_IMAGE = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

const DEFAULT_WELCOME = "Welcome to {group}, {mention}! 🎉"
const DEFAULT_GOODBYE = "Goodbye {mention}, we'll miss you! 😢"

// ── Template variable substitution ──────────────────────────────────────────
function applyTemplate(template, { name, mention, group, count, date }) {
  return template
    .replace(/{name}/g, name)
    .replace(/{mention}/g, mention)
    .replace(/{group}/g, group)
    .replace(/{count}/g, count)
    .replace(/{date}/g, date)
}

// ── Fetch a participant's own profile picture, with safe fallback ──────────
async function getProfilePicOrFallback(sock, jid, fallbackUrl) {
  try {
    const url = await sock.profilePictureUrl(jid, "image")
    if (url) return url
  } catch (err) {
    // No photo set, privacy blocks it, rate-limited, or network error —
    // all expected/normal, so we just fall through to the fallback silently.
  }
  return fallbackUrl
}

// ── Main handler ─────────────────────────────────────────────────────────────
async function handleGroupParticipants(sock, update, lib) {
  const { id: from, participants, action } = update

  if (action !== "add" && action !== "remove") return // ignore promote/demote etc.

  const isJoin      = action === "add"
  const enabledKey  = isJoin ? "welcome"     : "goodbye"
  const textKey     = isJoin ? "welcomeText" : "goodbyeText"
  const defaultText = isJoin ? DEFAULT_WELCOME : DEFAULT_GOODBYE

  const enabled = welcomeDb.get(from, enabledKey, false)
  if (!enabled) return

  const template = welcomeDb.get(from, textKey, defaultText)

  // goodbye.js stores its own image per-group; welcome.js uses the fixed WELCOME_IMAGE
  const fallbackImage = isJoin
    ? WELCOME_IMAGE
    : welcomeDb.get(from, "goodbyeImage", GOODBYE_IMAGE)

  // Group metadata for {group} and {count} — use existing groupCache if available
  let groupName   = "this group"
  let memberCount = participants.length
  try {
    const metadata = lib?.groupCache
      ? await lib.groupCache.get(sock, from)
      : await sock.groupMetadata(from)
    groupName   = metadata.subject
    memberCount = metadata.participants.length
  } catch (err) {
    // keep defaults above
  }

  const date = new Date().toLocaleDateString()

  for (const jid of participants) {
    const name    = jid.split("@")[0]
    const mention = `@${name}`

    const caption = applyTemplate(template, {
      name,
      mention,
      group: groupName,
      count: String(memberCount),
      date,
    })

    const imageUrl = await getProfilePicOrFallback(sock, jid, fallbackImage)

    try {
      await sock.sendMessage(from, {
        image:    { url: imageUrl },
        caption,
        mentions: [jid],
      })
    } catch (err) {
      // Image send failed — fall back to plain text so the group still
      // gets notified even if the image step breaks.
      try {
        await sock.sendMessage(from, { text: caption, mentions: [jid] })
      } catch (err2) {
        console.error("[groupParticipants] failed to send welcome/goodbye message:", err2)
      }
    }
  }
}

// index.js (line 495) already has a listener wired for this exact event,
// calling lib.handleGroupUpdate(sock, update) if it exists — it currently
// doesn't, so that listener is a no-op. Exporting handleGroupUpdate here
// (same signature: sock, update) makes that existing hook start working
// with ZERO index.js edits required. lib's auto-loader merges every export
// from this file onto the shared `lib` object, so `lib.handleGroupUpdate`
// becomes available automatically.
//
// No `lib` is passed through here (index.js's hook only gives us sock and
// update) — that's fine, handleGroupParticipants already falls back to
// sock.groupMetadata() when lib.groupCache isn't available.
function handleGroupUpdate(sock, update) {
  return handleGroupParticipants(sock, update)
}

module.exports = { handleGroupParticipants, handleGroupUpdate, DEFAULT_WELCOME, DEFAULT_GOODBYE }
