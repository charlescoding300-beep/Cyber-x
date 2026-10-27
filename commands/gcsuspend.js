// ─────────────────────────────────────────────────────────
// commands/gcsuspend.js — ZENX | reversible group suspension
//
// Suspends a group by freezing it, not by removing people:
//   • announcement-only messaging
//   • locked group settings
//   • admin-only member adds
//   • subject + description marked as suspended
//   • pinned notice explaining why
//
// Everything is attempted in 10 redundant layers with retries. The previous
// subject/description/add-mode are saved, so .gcunsuspend restores them.
//
// Usage:
//   .gcsuspend            → suspend this group
//   .gcsuspend 1h         → suspend for 1 hour, then auto-reopen
//   .gcsuspend <jid>      → owner only: suspend another group by JID
//   .gcsuspend <jid> 30m  → owner only: suspend another group for 30 minutes
// ─────────────────────────────────────────────────────────

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin, sendOwnerRestricted } = require('../lib/groupAdminNotice')
const {
  suspendGroup,
  sweepExpired,
  listStates,
  toGroupJid,
  isGroupJid,
  isBusy,
  norm,
  parseDuration,
  formatDuration,
} = require('../lib/gcSuspend')

const ADMIN_REQUIRED_NOTICE =
  '*❌ 𝙶𝚁𝙾𝚄𝙿 𝙰𝙳𝙼𝙸𝙽 𝚁𝙴𝚀𝚄𝙸𝚁𝙴𝙳.*\n' +
  '*— 𝙾𝙽𝙻𝚈 𝙰𝙽 𝙰𝙳𝙼𝙸𝙽 𝙾𝙵 𝚃𝙷𝙸𝚂 𝙶𝚁𝙾𝚄𝙿 𝙲𝙰𝙽 𝚂𝚄𝚂𝙿𝙴𝙽𝙳 𝙸𝚃.*'

function layerReport(results) {
  return results
    .map(r => `${r.ok ? '✅' : '⚠️'} L${r.id} · ${r.name}${r.ok ? '' : ` — ${r.error || 'failed'}`}`)
    .join('\n')
}

module.exports = {
  pattern: 'gcsuspend',
  desc: 'Suspend a group (announcement-only + locked). Reversible with .gcunsuspend',
  usage: '.gcsuspend [duration] | .gcsuspend <group-jid> [duration]',
  category: 'owner',
  independent: true,

  async run({ sock, from, msg, sender, args, isOwner, isGroup }) {
    const rawArgs = [...(args || [])]

    // ── resolve target group ───────────────────────────────
    let target = from
    if (rawArgs[0] && /@g\.us$/i.test(norm(rawArgs[0]))) {
      target = toGroupJid(rawArgs.shift())
    }

    if (!isGroupJid(target)) {
      return sock.sendMessage(from, {
        text:
          `> ❌ *This command needs a group.*\n` +
          `> Run it inside the group, or pass a group JID:\n` +
          `> *.gcsuspend 1203630xxxxxxx@g.us*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }

    // ── optional duration ──────────────────────────────────
    let durationMs = null
    if (rawArgs[0]) {
      durationMs = parseDuration(rawArgs[0])
      if (!durationMs) {
        return sock.sendMessage(from, {
          text:
            `> ❌ *Invalid duration:* ${rawArgs[0]}\n` +
            `> Examples: *30m*, *1h*, *2h30m*\n>\n${CREDIT}`,
          quoted: msg,
        })
      }
    }

    // ── permissions ────────────────────────────────────────
    const senderAlt =
      msg?.key?.participantPn || msg?.key?.participantAlt ||
      msg?.participantPn || msg?.participantAlt

    let adminContext
    try {
      adminContext = await adminLib.getGroupAdminContext(sock, target, sender, senderAlt)
    } catch (e) {
      console.error('[GCSUSPEND] permission check failed:', e.message)
    }
    if (!adminContext?.available) {
      return sock.sendMessage(from, {
        text: `> ⚠️ *Could not verify group permissions. Try again in a moment.*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }
    if (!adminContext.botAdmin) return sendBotNotAdmin(sock, from, msg)

    if (target === from) {
      if (!isOwner && !adminContext.senderAdmin) {
        return sock.sendMessage(from, { text: ADMIN_REQUIRED_NOTICE, quoted: msg })
      }
    } else if (!isOwner) {
      return sendOwnerRestricted(sock, from, msg)
    }

    if (isBusy(target)) {
      return sock.sendMessage(from, {
        text: `> ⏳ *A suspension/resume is already running for that group.*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }

    // Clean up anything whose timer expired while the bot was offline.
    if (listStates().some(s => s.endsAt && s.endsAt <= Date.now())) {
      await sweepExpired(sock).catch(e => console.error('[GCSUSPEND] sweep failed:', e.message))
    }

    const label = durationMs ? formatDuration(durationMs) : 'forever'

    await sock.sendMessage(from, {
      text:
        `> ⛔ *Suspending group…*\n` +
        `> 🆔 ${target}\n` +
        `> ⏱️ Duration: *${label}*\n>\n${CREDIT}`,
      quoted: msg,
    }).catch(() => {})

    let result
    try {
      result = await suspendGroup(sock, target, { durationMs, actor: sender })
    } catch (e) {
      console.error('[GCSUSPEND] suspend failed:', e.message)
      return sock.sendMessage(from, {
        text: `> ❌ *Suspension failed:* ${e.message}\n>\n${CREDIT}`,
        quoted: msg,
      })
    }

    const okCount = result.results.filter(r => r.ok).length
    const header = result.coreOk
      ? '⛔ *GROUP SUSPENDED*'
      : '⚠️ *GROUP PARTIALLY SUSPENDED*'

    const footer = result.coreOk
      ? durationMs
        ? `🔓 Auto-reopen in *${formatDuration(durationMs)}*\n💡 Or use *.gcunsuspend* now`
        : `💡 Use *.gcunsuspend* to reopen`
      : `⚠️ Core lockdown could not be fully confirmed.\n💡 Check that the bot is still an admin, then retry.`

    return sock.sendMessage(from, {
      text:
        `${header}\n\n` +
        `📌 Group: *${result.meta?.subject || 'this group'}*\n` +
        `🆔 ${target}\n\n` +
        `📊 *Layers: ${okCount}/10 passed*\n` +
        `${layerReport(result.results)}\n\n` +
        `${footer}\n\n${CREDIT}`,
      quoted: msg,
    })
  },
}
