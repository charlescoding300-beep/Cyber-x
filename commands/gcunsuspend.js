// ─────────────────────────────────────────────────────────
// commands/gcunsuspend.js — ZENX | undo .gcsuspend
//
// Reopens a suspended group:
//   • announcement-only off
//   • settings unlocked
//   • previous add-mode / subject / description restored
//   • suspension notice unpinned
//
// Usage:
//   .gcunsuspend             → reopen this group
//   .gcunsuspend <group-jid> → owner only: reopen another group
// ─────────────────────────────────────────────────────────

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin, sendOwnerRestricted } = require('../lib/groupAdminNotice')
const {
  resumeGroup,
  sweepExpired,
  listStates,
  getState,
  toGroupJid,
  isGroupJid,
  isBusy,
  norm,
} = require('../lib/gcSuspend')

const ADMIN_REQUIRED_NOTICE =
  '*❌ 𝙶𝚁𝙾𝚄𝙿 𝙰𝙳𝙼𝙸𝙽 𝚁𝙴𝚀𝚄𝙸𝚁𝙴𝙳.*\n' +
  '*— 𝙾𝙽𝙻𝚈 𝙰𝙽 𝙰𝙳𝙼𝙸𝙽 𝙾𝙵 𝚃𝙷𝙸𝚂 𝙶𝚁𝙾𝚄𝙿 𝙲𝙰𝙽 𝚁𝙴𝙾𝙿𝙴𝙽 𝙸𝚃.*'

function layerReport(results) {
  return results
    .map(r => `${r.ok ? '✅' : '⚠️'} L${r.id} · ${r.name}${r.ok ? '' : ` — ${r.error || 'failed'}`}`)
    .join('\n')
}

module.exports = {
  pattern: 'gcunsuspend',
  desc: 'Reopen a group suspended with .gcsuspend',
  usage: '.gcunsuspend | .gcunsuspend <group-jid>',
  category: 'owner',
  independent: true,

  async run({ sock, from, msg, sender, args, isOwner, isGroup }) {
    const rawArgs = [...(args || [])]

    let target = from
    if (rawArgs[0] && /@g\.us$/i.test(norm(rawArgs[0]))) {
      target = toGroupJid(rawArgs.shift())
    }

    if (!isGroupJid(target)) {
      return sock.sendMessage(from, {
        text:
          `> ❌ *This command needs a group.*\n` +
          `> Run it inside the group, or pass a group JID:\n` +
          `> *.gcunsuspend 1203630xxxxxxx@g.us*\n>\n${CREDIT}`,
        quoted: msg,
      })
    }

    const senderAlt =
      msg?.key?.participantPn || msg?.key?.participantAlt ||
      msg?.participantPn || msg?.participantAlt

    let adminContext
    try {
      adminContext = await adminLib.getGroupAdminContext(sock, target, sender, senderAlt)
    } catch (e) {
      console.error('[GCUNSUSPEND] permission check failed:', e.message)
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

    const saved = getState(target)

    // Anything else whose timer expired can be cleaned up too.
    if (listStates().some(s => s.endsAt && s.endsAt <= Date.now())) {
      await sweepExpired(sock).catch(e => console.error('[GCUNSUSPEND] sweep failed:', e.message))
    }

    let result
    try {
      result = await resumeGroup(sock, target, { reason: 'manual' })
    } catch (e) {
      console.error('[GCUNSUSPEND] resume failed:', e.message)
      return sock.sendMessage(from, {
        text: `> ❌ *Could not reopen group:* ${e.message}\n>\n${CREDIT}`,
        quoted: msg,
      })
    }

    const okCount = result.results.filter(r => r.ok).length
    const header = result.coreOk ? '🔓 *GROUP REOPENED*' : '⚠️ *GROUP PARTIALLY REOPENED*'

    const restoreNote = saved
      ? `🩹 Saved subject/description restored where unchanged`
      : `ℹ️ No saved suspension record — unlocked without touching subject/description`

    const footer = result.coreOk
      ? result.fullyRestored
        ? `${restoreNote}\n💡 Use *.gcsuspend* to lock it again`
        : `⚠️ Group is open, but some saved values could not be restored.\n💡 Run *.gcunsuspend* again to retry the rest.`
      : `⚠️ Announcement/lock could not be fully cleared.\n💡 Check that the bot is still an admin, then retry.`

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
