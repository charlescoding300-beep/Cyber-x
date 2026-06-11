// ════════════════════════════════════════════════════════════════════
//  lib/welcome.js  —  CYBER X  |  Welcome & Goodbye
//
//  ⚡ Fires in < 0.5s — 400ms PP timeout hard cap
//  💾 Config → session/welcome-cfg.json  (survives Render restarts)
//  👁️ Catches every join:  add by admin, invite link
//  👁️ Catches every leave: kicked (remove), left on own (leave)
// ════════════════════════════════════════════════════════════════════

"use strict"

const fs   = require("fs")
const path = require("path")

// ── Config file lives inside session/ (persistent disk on Render) ──
const CFG_FILE = path.join(__dirname, "..", "session", "welcome-cfg.json")

// ── Load config once at startup ───────────────────────────────────
let cfg = {}
try {
  if (fs.existsSync(CFG_FILE)) {
    cfg = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"))
    const n = Object.keys(cfg).length
    console.log(`[WELCOME] ✔ Loaded config — ${n} group(s)`)
  }
} catch (e) {
  console.error("[WELCOME] Config load error:", e.message)
  cfg = {}
}

// ── Save (debounced 300ms) ────────────────────────────────────────
let _st = null
function save() {
  clearTimeout(_st)
  _st = setTimeout(() => {
    try { fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)) }
    catch (e) { console.error("[WELCOME] Save error:", e.message) }
  }, 300)
}

// ── Per-group config helpers ──────────────────────────────────────
function getCfg(gid) {
  if (!cfg[gid]) {
    cfg[gid] = {
      welcomeOn:  false,
      goodbyeOn:  false,
      welcomeMsg: "",   // empty = use default
      goodbyeMsg: "",
    }
  }
  return cfg[gid]
}

function setCfg(gid, patch) {
  Object.assign(getCfg(gid), patch)
  save()
  return cfg[gid]
}

// ── Profile picture — hard 400ms cap ─────────────────────────────
async function getPP(sock, jid) {
  try {
    return await Promise.race([
      sock.profilePictureUrl(jid, "image"),
      new Promise((_, rej) => setTimeout(() => rej(), 400)),
    ])
  } catch {
    return null  // null = fall back to text-only
  }
}

// ── Placeholder replace ───────────────────────────────────────────
function format(tpl, user) {
  const tag = `@${user.split("@")[0]}`
  const num = user.split("@")[0]
  return tpl
    .replace(/{tag}/gi,  tag)
    .replace(/{user}/gi, num)
}

// ── Default messages ──────────────────────────────────────────────
const DEFAULT_WELCOME =
  "╔══════════════════════════╗\n" +
  "║  👋  WELCOME!            ║\n" +
  "╚══════════════════════════╝\n\n" +
  "Hey {tag}, welcome to the group! 🎉\n\n" +
  "> © 𝕮𝖄𝕭𝙀𝙍 𝖃"

const DEFAULT_GOODBYE =
  "╔══════════════════════════╗\n" +
  "║  🚪  FAREWELL!           ║\n" +
  "╚══════════════════════════╝\n\n" +
  "{tag} has left the group. 👋\n\n" +
  "> © 𝕮𝖄𝕭𝙀𝙍 𝖃"

// ════════════════════════════════════════════════════════════════════
//  MAIN HANDLER — called by index automatically via lib.handleGroupUpdate
// ════════════════════════════════════════════════════════════════════
async function handleGroupUpdate(sock, update) {
  const { id, participants, action } = update || {}
  if (!id || !participants?.length) return

  const c = getCfg(id)

  // ── WELCOME — user joined ───────────────────────────────────────
  // action "add" covers: added by admin AND joined via invite link
  if (action === "add" && c.welcomeOn) {
    const tpl = c.welcomeMsg || DEFAULT_WELCOME

    for (const user of participants) {
      try {
        const text = format(tpl, user)
        const pp   = await getPP(sock, user)

        if (pp) {
          await sock.sendMessage(id, {
            image:    { url: pp },
            caption:  text,
            mentions: [user],
          })
        } else {
          await sock.sendMessage(id, {
            text,
            mentions: [user],
          })
        }
      } catch (e) {
        console.error("[WELCOME] Error:", e.message)
      }
    }
  }

  // ── GOODBYE — user left or was kicked ──────────────────────────
  // action "remove" = kicked by admin
  // action "leave"  = left voluntarily
  if ((action === "remove" || action === "leave") && c.goodbyeOn) {
    const tpl = c.goodbyeMsg || DEFAULT_GOODBYE

    for (const user of participants) {
      try {
        const text = format(tpl, user)
        // Text only — user already gone, PP fetch would 403
        await sock.sendMessage(id, {
          text,
          mentions: [user],
        })
      } catch (e) {
        console.error("[GOODBYE] Error:", e.message)
      }
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────
module.exports = { handleGroupUpdate, getCfg, setCfg }
