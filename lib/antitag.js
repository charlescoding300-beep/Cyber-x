// ════════════════════════════════════════════════════════════════════
//  lib/antitag.js  —  CYBER X  |  🏷️ Anti-Tag Engine
//
//  ⚡ SPEED: delete fires instantly (no await)
//  ⚡ SPEED: kick + bye message fire in parallel (Promise.all)
//  ⚡ SPEED: warn fires before kick (fire-and-forget), then kick hits
//  💬 Sassy messages activate when adminExempt = false (admin mode)
//  🔗 Connects to your existing isAdmin from index.js context
//
//  HOOK in index.js (before command router):
//  ─────────────────────────────────────────
//  const { handleAntitag } = require('./lib/antitag')
//
//  // inside messages.upsert, before router:
//  if (from.endsWith('@g.us')) {
//    const meta = await getGroupMeta(from)
//    handleAntitag(sock, msg, meta)   // no await — fire and forget
//  }
// ════════════════════════════════════════════════════════════════════

const fs   = require('fs')
const path = require('path')

const DB_PATH = path.join(__dirname, '../data/antitag.json')

// ── DB (sync read/write — fast, no async overhead) ────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) } catch { return {} }
}
function saveDB(db) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
  } catch { /* silent */ }
}

let db = loadDB()

function getSettings(group) {
  return db[group] || { enabled: false, actions: ['delete'], adminExempt: true, warns: {} }
}
function saveSettings(group, s) {
  db[group] = s
  saveDB(db)
}

// ── Styled box (for non-admin / regular member messages) ──────────
function box(title, lines = []) {
  return (
    `╔══════════════════════╗\n` +
    `║  ${title}\n` +
    `╠══════════════════════╣\n` +
    lines.map(l => `║  ${l}`).join('\n') + '\n' +
    `╚══════════════════════╝\n` +
    `> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`
  )
}

// ════════════════════════════════════════════════════════════════════
//  MAIN HANDLER — plug into index.js (no await needed on caller side)
// ════════════════════════════════════════════════════════════════════
async function handleAntitag(sock, msg, groupMeta) {
  try {
    const from   = msg.key.remoteJid
    const sender = msg.key.participant || msg.key.remoteJid
    if (!from?.endsWith('@g.us')) return

    const s = getSettings(from)
    if (!s.enabled) return

    // ── Pull mentions from every possible message type ────────────
    const ctx =
      msg.message?.extendedTextMessage?.contextInfo   ||
      msg.message?.imageMessage?.contextInfo          ||
      msg.message?.videoMessage?.contextInfo          ||
      msg.message?.stickerMessage?.contextInfo        ||
      msg.message?.documentMessage?.contextInfo       ||
      msg.message?.audioMessage?.contextInfo          ||
      msg.message?.buttonsMessage?.contextInfo        ||
      {}

    const mentions = ctx.mentionedJid || []
    if (!mentions.length) return

    // ── Sender admin check (uses groupMeta from your cache) ───────
    const participants = groupMeta?.participants || []
    const senderData   = participants.find(p => p.id === sender)
    const isAdmin      = ['admin', 'superadmin'].includes(senderData?.admin)

    // Admins exempt in normal mode → skip
    if (isAdmin && s.adminExempt) return

    const actions   = s.actions || ['delete']
    const tag       = sender.replace(/@.+/, '')
    const grpName   = groupMeta?.subject || 'this group'

    // adminMode = true means .antitag admin on/delete/warn/kick was set
    // → sassy custom messages activate
    const adminMode = !s.adminExempt

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  ⚡ STEP 1 — DELETE: fire instantly, no await, never blocks
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (actions.includes('delete')) {
      sock.sendMessage(from, { delete: msg.key }).catch(() => {})
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  ⚡ STEP 2 — WARN (auto-kick at 3)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (actions.includes('warn')) {
      if (!s.warns) s.warns = {}
      s.warns[sender] = (s.warns[sender] || 0) + 1
      const count = s.warns[sender]
      saveSettings(from, s)   // sync write — fast

      if (count >= 3) {
        // ── 3rd warn → warn msg fires first, then kick + bye PARALLEL
        // warn fires as fire-and-forget (no await)
        sock.sendMessage(from, {
          text: adminMode
            ? `Be warned 🧏🏻 no tagging all in this ${grpName}`
            : box('⚠️ *FINAL WARNING*', [
                `👤 @${tag}`,
                `🚨 Warns: *3/3*`,
                `🦵 You're being removed!`,
              ]),
          mentions: [sender],
        }).catch(() => {})

        // bye + kick fire together in true parallel
        await Promise.all([
          sock.sendMessage(from, {
            text: adminMode
              ? `Bye bye 😂, you don't hear word no tagging @${tag}`
              : box('🦵 *KICKED — ANTI-TAG*', [
                  `👤 @${tag}`,
                  `🚨 Warns: *3/3 — Removed!*`,
                ]),
            mentions: [sender],
          }).catch(() => {}),
          sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {}),
        ])

        delete s.warns[sender]
        saveSettings(from, s)
        return
      }

      // ── Regular warn (1st / 2nd) ──────────────────────────────
      const warnText = adminMode
        ? `Be warned 🧏🏻 no tagging all in this ${grpName}`
        : box('⚠️ *ANTI-TAG WARNING*', [
            `👤 @${tag}`,
            `🚨 Warns: *${count}/3*`,
            `🚫 No tagging allowed!`,
            count === 2 ? `❗ *Next offense = KICK*` : `⚠️ Watch yourself!`,
          ])

      sock.sendMessage(from, {
        text:     warnText,
        mentions: [sender],
      }).catch(() => {})
      return
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  ⚡ STEP 3 — INSTANT KICK (no warn action, direct kick)
    //  warn message fires first (fire-and-forget), then kick + bye PARALLEL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (actions.includes('kick')) {
      // warn fires first so they see why (no await = doesn't slow kick)
      sock.sendMessage(from, {
        text: adminMode
          ? `Be warned 🧏🏻 no tagging all in this ${grpName}`
          : box('🚨 *ANTI-TAG*', [`👤 @${tag}`, `🚫 Tagging is not allowed!`]),
        mentions: [sender],
      }).catch(() => {})

      // bye + kick fire in parallel immediately after
      await Promise.all([
        sock.sendMessage(from, {
          text: adminMode
            ? `Bye bye 😂, you don't hear word no tagging @${tag}`
            : box('🦵 *KICKED — ANTI-TAG*', [
                `👤 @${tag}`,
                `🚫 Reason: Tagging members`,
              ]),
          mentions: [sender],
        }).catch(() => {}),
        sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {}),
      ])
      return
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //  DELETE ONLY — send feedback in admin mode, silent in normal
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (adminMode) {
      sock.sendMessage(from, {
        text: `Admin stop tagging the group 🫠😂...`,
      }).catch(() => {})
    }
    // normal mode delete-only = silent (message already gone)

  } catch { /* never crash the router */ }
}

module.exports = { handleAntitag, getSettings, saveSettings }

