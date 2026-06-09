// ═══════════════════════════════════════════════════════════════
// lib/welcome.js — CYBER X WELCOME / GOODBYE ENGINE
// Persists settings via lib/store.js
// ═══════════════════════════════════════════════════════════════

const { createStore } = require("./store")

const db = createStore("welcome", {
  groups: {}
  // groups[jid] = {
  //   welcomeEnabled:  bool,
  //   goodbyeEnabled:  bool,
  //   welcomeMsg:      string | null  (null = use default)
  //   goodbyeMsg:      string | null
  // }
})

// ─────────────────────────────────────────────────────────
// DEFAULTS
// Placeholders: {name} {group} {count} {tag}
// ─────────────────────────────────────────────────────────

const DEFAULT_WELCOME =
`🎉 *Welcome to {group}!*

Hey {tag}, we're so happy to have you here! 🌟
Feel free to introduce yourself and join the fun.

📌 *Please read the group rules.*
Enjoy your stay! 💙

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

const DEFAULT_GOODBYE =
`👋 *Goodbye from {group}!*

{tag} has left the group.
We'll miss you! Hope to see you again someday. 💙

> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`

// ─────────────────────────────────────────────────────────
// STATE HELPERS
// ─────────────────────────────────────────────────────────

function getConfig(jid) {
  const groups = db.get("groups")
  return groups[jid] || {
    welcomeEnabled: false,
    goodbyeEnabled: false,
    welcomeMsg:     null,
    goodbyeMsg:     null,
  }
}

function setConfig(jid, patch) {
  db.update("groups", g => {
    g[jid] = { ...getConfig(jid), ...patch }
    return g
  })
}

function isWelcomeEnabled(jid) { return !!getConfig(jid).welcomeEnabled }
function isGoodbyeEnabled(jid) { return !!getConfig(jid).goodbyeEnabled }

function enableWelcome(jid)  { setConfig(jid, { welcomeEnabled: true }) }
function disableWelcome(jid) { setConfig(jid, { welcomeEnabled: false }) }
function enableGoodbye(jid)  { setConfig(jid, { goodbyeEnabled: true }) }
function disableGoodbye(jid) { setConfig(jid, { goodbyeEnabled: false }) }

function setWelcomeMsg(jid, msg) { setConfig(jid, { welcomeMsg: msg }) }
function setGoodbyeMsg(jid, msg) { setConfig(jid, { goodbyeMsg: msg }) }
function resetWelcomeMsg(jid)    { setConfig(jid, { welcomeMsg: null }) }
function resetGoodbyeMsg(jid)    { setConfig(jid, { goodbyeMsg: null }) }

// ─────────────────────────────────────────────────────────
// BUILD MESSAGE — fills in placeholders
// ─────────────────────────────────────────────────────────

function buildMsg(template, { tag, group, count }) {
  return template
    .replace(/{tag}/g,   tag)
    .replace(/{name}/g,  tag)
    .replace(/{group}/g, group)
    .replace(/{count}/g, count)
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER — called from index.js group-participants.update
// ─────────────────────────────────────────────────────────

async function handleGroupUpdate(sock, { id: groupJid, participants, action }) {
  try {
    if (!groupJid?.endsWith("@g.us")) return
    if (!["add", "remove"].includes(action))   return

    const config = getConfig(groupJid)

    if (action === "add"    && !config.welcomeEnabled) return
    if (action === "remove" && !config.goodbyeEnabled) return

    // Get group info
    let groupName  = "the group"
    let memberCount = 0
    try {
      const meta  = await sock.groupMetadata(groupJid)
      groupName   = meta.subject || "the group"
      memberCount = meta.participants?.length || 0
    } catch {}

    for (const participant of participants) {
      const tag    = `@${participant.split("@")[0]}`
      const vars   = { tag, group: groupName, count: memberCount }

      // Get profile picture
      let ppUrl = null
      try {
        ppUrl = await sock.profilePictureUrl(participant, "image")
      } catch {}

      if (action === "add") {
        const template = config.welcomeMsg || DEFAULT_WELCOME
        const text     = buildMsg(template, vars)

        if (ppUrl) {
          await sock.sendMessage(groupJid, {
            image:    { url: ppUrl },
            caption:  text,
            mentions: [participant],
          })
        } else {
          await sock.sendMessage(groupJid, {
            text,
            mentions: [participant],
          })
        }
      }

      if (action === "remove") {
        const template = config.goodbyeMsg || DEFAULT_GOODBYE
        const text     = buildMsg(template, vars)

        if (ppUrl) {
          await sock.sendMessage(groupJid, {
            image:    { url: ppUrl },
            caption:  text,
            mentions: [participant],
          })
        } else {
          await sock.sendMessage(groupJid, {
            text,
            mentions: [participant],
          })
        }
      }
    }

  } catch (err) {
    console.error("[WELCOME]", err.message)
  }
}

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────

module.exports = {
  isWelcomeEnabled,
  isGoodbyeEnabled,
  enableWelcome,
  disableWelcome,
  enableGoodbye,
  disableGoodbye,
  setWelcomeMsg,
  setGoodbyeMsg,
  resetWelcomeMsg,
  resetGoodbyeMsg,
  getWelcomeConfig: getConfig,
  handleGroupUpdate,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
}
