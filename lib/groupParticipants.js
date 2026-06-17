// ─────────────────────────────────────────────────────────────────────────────
// lib/groupParticipants.js  —  CYBER X  |  Welcome & Goodbye Event Handler
//
// Runs as a SEPARATE listener alongside index.js — zero conflicts.
// index.js already has its own group-participants.update for cache refresh.
// This one ONLY handles welcome/goodbye messages.
//
// Wire up ONCE in index.js after sock is created:
//   try { require("./lib/groupParticipants").init(sock) } catch (e) { console.error("[WELCOME] ✗", e.message) }
//
// Template variables in messages:
//   {name}    → member's display name or number
//   {mention} → @mention the member
//   {group}   → group name
//   {count}   → current member count
//   {date}    → today's date
// ─────────────────────────────────────────────────────────────────────────────

const welcomeDb = require("./welcomeDb")

// ── Images ────────────────────────────────────────────────────────────────────
const WELCOME_IMAGE = "https://i.ibb.co/BK2SW9RP/file-00000000c748720c9fd1c812931ae6f7.png"
const GOODBYE_IMAGE = "https://i.ibb.co/HTv1zhnS/file-000000003d24720c970bb4edcd49d1ef.png"

// ── Default messages ──────────────────────────────────────────────────────────
const DEFAULT_WELCOME =
  `╔══════════════════╗\n` +
  `║  𝗪𝗘𝗟𝗖𝗢𝗠𝗘 𝗧𝗢 𝗧𝗛𝗘 𝗚𝗥𝗢𝗨𝗣  ║\n` +
  `╚══════════════════╝\n\n` +
  `👾 Hey {mention}!\n\n` +
  `You just joined *{group}* 🎉\n` +
  `We now have *{count}* members.\n\n` +
  `📌 Read the group rules and enjoy your stay!\n` +
  `━━━━━━━━━━━━━━━━━━━━\n` +
  `🤖 _CYBER X_`

const DEFAULT_GOODBYE =
  `╔══════════════════╗\n` +
  `║   𝗚𝗢𝗢𝗗𝗕𝗬𝗘 𝗠𝗘𝗦𝗦𝗔𝗚𝗘   ║\n` +
  `╚══════════════════╝\n\n` +
  `😢 *{name}* has left the group.\n\n` +
  `We now have *{count}* members remaining.\n` +
  `━━━━━━━━━━━━━━━━━━━━\n` +
  `🤖 _CYBER X_`

// ── Fill template variables ───────────────────────────────────────────────────
function fillTemplate(template, vars) {
  return template
    .replace(/\{name\}/g,    vars.name    || "Member")
    .replace(/\{mention\}/g, vars.mention || vars.name || "Member")
    .replace(/\{group\}/g,   vars.group   || "this group")
    .replace(/\{count\}/g,   String(vars.count ?? "?"))
    .replace(/\{date\}/g,    new Date().toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    }))
}

// ── Normalise JID — Baileys sometimes fires @lid instead of @s.whatsapp.net ──
function normaliseJid(jid) {
  if (!jid) return ""
  if (jid.endsWith("@s.whatsapp.net")) return jid
  const num = jid.split("@")[0].replace(/\D/g, "")
  return num ? `${num}@s.whatsapp.net` : jid
}

// ── Send welcome with image ───────────────────────────────────────────────────
async function sendWelcome(sock, groupId, cleanJid, vars, cfg) {
  const caption = fillTemplate(cfg.welcomeText || DEFAULT_WELCOME, vars)
  await sock.sendMessage(groupId, {
    image:    { url: WELCOME_IMAGE },
    caption,
    mentions: [cleanJid],
  })
}

// ── Send goodbye with image ───────────────────────────────────────────────────
async function sendGoodbye(sock, groupId, cleanJid, vars, cfg) {
  const caption = fillTemplate(cfg.goodbyeText || DEFAULT_GOODBYE, vars)
  const image   = cfg.goodbyeImage || GOODBYE_IMAGE
  await sock.sendMessage(groupId, {
    image:    { url: image },
    caption,
    mentions: [cleanJid],
  })
}

// ── Init — attaches listener to sock ─────────────────────────────────────────
function init(sock) {
  sock.ev.on("group-participants.update", async ({ id: groupId, participants, action }) => {
    try {
      const cfg = welcomeDb.getGroup(groupId)

      const doWelcome = cfg.welcome  && (action === "add"    || action === "invite")
      const doGoodbye = cfg.goodbye  && (action === "remove" || action === "leave")

      if (!doWelcome && !doGoodbye) return

      // ── Fetch group metadata ──────────────────────────────────────────────
      let groupName   = "this group"
      let memberCount = "?"
      try {
        const meta  = await sock.groupMetadata(groupId)
        groupName   = meta.subject            || groupName
        memberCount = meta.participants?.length ?? memberCount
      } catch {}

      // ── Loop each participant in the event ────────────────────────────────
      for (const rawJid of participants) {
        const cleanJid = normaliseJid(rawJid)
        if (!cleanJid) continue

        const num = cleanJid.split("@")[0]

        // Try to resolve display name
        let name = num
        try {
          const res = await sock.onWhatsApp(cleanJid)
          if (res?.[0]?.notify) name = res[0].notify
        } catch {}

        const vars = {
          name,
          mention: `@${num}`,
          group:   groupName,
          count:   memberCount,
        }

        if (doWelcome) await sendWelcome(sock, groupId, cleanJid, vars, cfg)
        if (doGoodbye) await sendGoodbye(sock, groupId, cleanJid, vars, cfg)
      }
    } catch (err) {
      console.error("[GROUP-PARTICIPANTS] Error:", err.message)
    }
  })

  console.log("[GROUP-PARTICIPANTS] ✔ Welcome/Goodbye listener active — running alongside index.js cache listener")
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  init,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
  WELCOME_IMAGE,
  GOODBYE_IMAGE,
  fillTemplate,
}
