// ─────────────────────────────────────────────────────────────────────────────
// lib/greetListener.js  —  CYBER X
//
// Standalone welcome/goodbye listener. Registers its OWN
// group-participants.update handler directly on sock — does not depend on
// or route through any other hook in index.js (no lib.handleGroupUpdate,
// no shared groupParticipants.js). Self-contained, own storage
// (greetStore.js), own commands (commands/greetwelcome.js,
// commands/greetgoodbye.js).
//
// Baileys' official event payload (confirmed from docs):
//   'group-participants.update': { id: string, participants: string[], action: ParticipantAction }
//
// USAGE — one line in index.js, inside startBot(), near the other
// sock.ev.on(...) calls:
//
//   require("./lib/greetListener").register(sock)
//
// That's it. Nothing else in index.js needs to change.
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

async function handleEvent(sock, event) {
  const { id: from, participants, action } = event

  if (action !== "add" && action !== "remove") return

  const isJoin      = action === "add"
  const enabledKey  = isJoin ? "welcomeEnabled" : "goodbyeEnabled"
  const textKey     = isJoin ? "welcomeText"    : "goodbyeText"
  const defaultText = isJoin ? DEFAULT_WELCOME  : DEFAULT_GOODBYE

  const enabled = greetStore.get(from, enabledKey, false)
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

    try {
      await sock.sendMessage(from, { image: { url: imageUrl }, caption, mentions: [jid] })
    } catch (err) {
      try {
        await sock.sendMessage(from, { text: caption, mentions: [jid] })
      } catch (err2) {
        console.error(`[greetListener] ✗ failed to send for ${jid}: ${err2.message}`)
      }
    }
  }
}

/**
 * register(sock) — call this once per session, right after the socket is
 * created. Registers its own group-participants.update listener directly.
 *
 * NOTE: this is intentionally NOT named setSocket. lib/antilink.js already
 * exports its own setSocket, and index.js's auto-loader merges every lib/
 * file's exports onto one shared object — only one setSocket can survive
 * that merge. Naming this setSocket would either silently break
 * antilink.js's socket reference, or (if renamed to avoid that) never get
 * called at all, since index.js only auto-invokes the literal name
 * "setSocket". One explicit line in index.js is the safe option here.
 */
const _registeredSockets = new WeakSet()

function register(sock) {
  if (_registeredSockets.has(sock)) return   // already registered, skip
  _registeredSockets.add(sock)

  sock.ev.on("group-participants.update", (event) => {
    handleEvent(sock, event).catch(e =>
      console.error(`[greetListener] ✗ handler error: ${e.message}`)
    )
  })
  console.log("[greetListener] ✔ registered on socket")
}

module.exports = { register, DEFAULT_WELCOME, DEFAULT_GOODBYE }
