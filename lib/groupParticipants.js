'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// lib/groupParticipants.js  —  CYBER X  |  Welcome / Goodbye Handler
//
// This is the MISSING PIECE that commands/welcome.js and commands/goodbye.js
// depend on but never had — those files only store settings (on/off/text),
// they don't actually listen for anyone joining or leaving. This file does
// that part: it wires into Baileys' group-participants.update event, fetches
// each user's OWN profile picture, and sends the welcome/goodbye message
// with it — falling back to a static image only if the user's photo can't
// be fetched (no photo set, privacy restricted, or a transient rate limit).
//
// WIRING — add this to index.js's existing group-participants.update listener
// (the one that already calls lib.handleGroupUpdate for other things):
//
//   sock.ev.on("group-participants.update", async (update) => {
//     if (typeof lib.handleGroupUpdate === "function") lib.handleGroupUpdate(sock, update).catch(() => {})
//   })
//
// Nothing in index.js needs to change beyond making sure that line exists —
// this file's auto-loaded export becomes lib.handleGroupUpdate automatically
// via your existing loadDir(LIB_DIR, ...) loader.
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb = require('./welcomeDb')

const DEFAULT_WELCOME = 'Welcome to {group}, {mention}! 🎉\nYou are member #{count}.'
const DEFAULT_GOODBYE = 'Goodbye {mention}, we will miss you! 👋'

const FALLBACK_WELCOME_IMAGE = 'https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png'

// ── Optional store hook — some setups call setStore({ groupMetadata }) ──────
let externalStore = null
function setStore(store) { externalStore = store }

// ─────────────────────────────────────────────────────────────────────────────
// Fetch a user's OWN profile picture, safely.
// profilePictureUrl() is known to randomly throw "not-authorized" even for
// valid users (privacy settings, WhatsApp rate limiting, or genuinely no
// photo set) — so this NEVER lets that exception propagate. Returns null
// on any failure so the caller can fall back to a static image instead.
// ─────────────────────────────────────────────────────────────────────────────
async function getProfilePicture(sock, jid) {
  try {
    const url = await sock.profilePictureUrl(jid, 'image')
    return url || null
  } catch {
    return null   // no photo / privacy-restricted / rate-limited — caller falls back
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template variable substitution — {name} {mention} {group} {count} {date}
// ─────────────────────────────────────────────────────────────────────────────
function applyTemplate(template, { name, mention, group, count, date }) {
  return template
    .replace(/\{name\}/g,    name    || '')
    .replace(/\{mention\}/g, mention || '')
    .replace(/\{group\}/g,   group   || '')
    .replace(/\{count\}/g,   String(count ?? ''))
    .replace(/\{date\}/g,    date    || '')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER — called from index.js's group-participants.update listener
// ─────────────────────────────────────────────────────────────────────────────
async function handleGroupUpdate(sock, update) {
  const { id: groupJid, participants, action } = update
  if (!groupJid || !participants?.length) return
  if (action !== 'add' && action !== 'remove') return   // ignore promote/demote here

  const isWelcome = action === 'add'
  const settingKey = isWelcome ? 'welcome' : 'goodbye'
  const enabled = welcomeDb.get(groupJid, settingKey, false)
  if (!enabled) return

  // ── Fetch group metadata for {group} name and {count} ────────────────────────
  let meta
  try {
    meta = externalStore?.groupMetadata?.[groupJid] || await sock.groupMetadata(groupJid)
  } catch (e) {
    console.error(`[${isWelcome ? 'WELCOME' : 'GOODBYE'}] metadata fetch failed:`, e.message)
    return
  }

  const groupName    = meta?.subject || '(group)'
  const memberCount  = meta?.participants?.length ?? participants.length
  const dateStr      = new Date().toLocaleDateString()

  const textKey = isWelcome ? 'welcomeText' : 'goodbyeText'
  const defaultText = isWelcome ? DEFAULT_WELCOME : DEFAULT_GOODBYE
  const template = welcomeDb.get(groupJid, textKey, defaultText)

  // ── Process each joining/leaving member individually ─────────────────────────
  // (group events can batch multiple users in one update — handle each on
  // its own so every person gets THEIR OWN profile picture, not the first
  // person's photo applied to everyone)
  for (const userJid of participants) {
    const userName = userJid.split('@')[0]
    const mention  = `@${userName}`

    const caption = applyTemplate(template, {
      name:    userName,
      mention,
      group:   groupName,
      count:   memberCount,
      date:    dateStr,
    })

    // ── Try the user's OWN profile picture first, fall back if unavailable ─────
    const userPhotoUrl = await getProfilePicture(sock, userJid)
    const imageUrl = userPhotoUrl || FALLBACK_WELCOME_IMAGE

    try {
      await sock.sendMessage(groupJid, {
        image: { url: imageUrl },
        caption,
        mentions: [userJid],
      })
    } catch (e) {
      console.error(`[${isWelcome ? 'WELCOME' : 'GOODBYE'}] send failed for ${userName}:`, e.message)
      // Last-resort fallback — at least send the text if the image itself fails
      try {
        await sock.sendMessage(groupJid, { text: caption, mentions: [userJid] })
      } catch {}
    }
  }
}

module.exports = {
  handleGroupUpdate,
  setStore,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
  getProfilePicture,
}
