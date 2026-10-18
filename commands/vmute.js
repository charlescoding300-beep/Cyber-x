'use strict'

// ════════════════════════════════════════════════════════════════════
//  commands/vmute.js — ZEN X | .vmute  (group owner / admins)
//
//  .vmute                      reply to a member's message (or @mention them) → mute
//  .vmute 2348xxxxxxxxx        mute by number (country code, no +)
//  .vmute off                  unmute (reply / @mention / number also work)
//  .vmute list                 show muted members in this group
//  .vmute check                diagnostics: is the bot an admin, is enforcement on?
//
//  A muted member's messages are deleted for everyone until unmuted.
//  The bot must be a group admin.
// ════════════════════════════════════════════════════════════════════

const vm = require('../core/vmute')

const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

function contextOf(msg) {
  let m = msg?.message
  for (let i = 0; i < 3 && m; i++) {
    const next = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.documentWithCaptionMessage?.message
    if (!next) break
    m = next
  }
  if (!m) return null
  for (const k of Object.keys(m)) {
    const ci = m[k]?.contextInfo
    if (ci) return ci
  }
  return null
}

// who is the command aimed at? reply → @mention → typed number
function targetOf(msg, words) {
  const ctx = contextOf(msg)
  if (ctx?.participant) return vm.bare(ctx.participant)
  if (Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid.length) return vm.bare(ctx.mentionedJid[0])
  const typed = words.map(w => w.replace(/\D/g, '')).find(w => w.length >= 5 && w.length <= 15)
  return typed ? `${typed}@s.whatsapp.net` : null
}

async function freshMeta(sock, groupJid, cache) {
  const cached = cache?.[groupJid]
  const cachedAt = Number(cached?._cachedAt) || 0
  if (
    Array.isArray(cached?.participants) && cached.participants.length &&
    cachedAt > 0 && Date.now() - cachedAt <= 60_000
  ) return cached

  try {
    const meta = await sock.groupMetadata(groupJid)
    if (!Array.isArray(meta?.participants) || !meta.participants.length) return null
    if (cache) cache[groupJid] = { ...meta, _cachedAt: Date.now() }
    return cache?.[groupJid] || meta
  } catch {
    return null
  }
}

module.exports = {
  name: 'vmute',
  aliases: [],
  desc: 'Mute a group member: the bot deletes everything they send until unmuted',
  usage: '.vmute (reply / @mention / number) | .vmute off | .vmute list | .vmute check',
  category: 'group',

  run: async ({ sock, from, msg, args, text, isOwner, isGroup, isAdmin, groupCache }) => {
    const reply = (t, extra = {}) => sock.sendMessage(from, { text: `${t}\n\n${CREDIT}`, ...extra }, { quoted: msg })

    if (!isGroup) return reply('❌ This command only works in groups.')
    if (!isOwner && !isAdmin) return reply('❌ Only group admins can use this command.')

    const phone = sock.__zenxVmutePhone || vm.digits(sock.user?.id)
    const words = (Array.isArray(args) ? args : String(text || '').split(/\s+/)).filter(Boolean)
    const sub = (words[0] || '').toLowerCase()
    const rest = words.slice(1)

    // ── list ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const muted = vm.listMuted(phone, from)
      if (!muted.length) return reply('🔈 Nobody is muted in this group.')
      const lines = muted.map((u, i) => `${i + 1}. @${vm.digits(u.jid)}`)
      return reply(`🔇 *Muted members (${muted.length})*\n\n${lines.join('\n')}`, { mentions: muted.map(u => u.jid) })
    }

    // ── check ───────────────────────────────────────────────────────────────
    if (sub === 'check') {
      const meta = await freshMeta(sock, from, groupCache)
      if (!meta) return reply('⚠️ I could not load the current group information. Please try again.')
      const botP = vm.findParticipant(meta, [sock.user?.id, sock.user?.lid])
      const botAdmin = vm.isAdminP(botP)
      return reply(
        `🔎 *Mute check*\n\n` +
        `• Bot is group admin: ${botAdmin ? '✅ yes' : '❌ no — make the bot an admin'}\n` +
        `• Enforcement active: ${sock.__zenxVmutePhone ? '✅ yes' : '❌ no — restart the bot'}\n` +
        `• Muted in this group: ${vm.listMuted(phone, from).length}`
      )
    }

    // ── resolve the member ──────────────────────────────────────────────────
    const jid = targetOf(msg, sub === 'off' ? rest : words)
    if (!jid) {
      return reply('ℹ️ Reply to the member\'s message with *.vmute* (or *.vunmute* to unmute).\nYou can also @mention them, type their number, or use *.vmute list*.')
    }

    const meta = await freshMeta(sock, from, groupCache)
    if (!meta) return reply('⚠️ I could not load the current group information. Please try again.')
    const memberP = vm.findParticipant(meta, [jid])
    const ids = [...new Set([vm.bare(jid), ...(memberP ? vm.participantIds(memberP) : [])])]
    const mentionJid = ids.find(i => i.endsWith('@s.whatsapp.net')) || vm.bare(jid)
    const label = `@${vm.digits(mentionJid)}`

    // ── unmute ──────────────────────────────────────────────────────────────
    if (sub === 'off' || sub === 'unmute' || sub === 'remove') {
      const done = vm.unmute(phone, from, ids)
      return reply(done ? `🔊 ${label} has been unmuted.` : `ℹ️ ${label} isn't muted.`, { mentions: [mentionJid] })
    }

    // ── mute ────────────────────────────────────────────────────────────────
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(vm.bare)
    if (ids.some(i => botIds.includes(i))) return reply('😅 I can\'t mute myself.')
    if (msg.key?.participant && ids.includes(vm.bare(msg.key.participant))) return reply('😅 You can\'t mute yourself.')
    if (vm.isAdminP(memberP)) return reply('I can\'t mute an admin 😕')

    const botP = vm.findParticipant(meta, botIds)
    if (botP && !vm.isAdminP(botP)) {
      return reply('⚠️ I need to be a group admin to delete messages. Make me admin, then run *.vmute* again.')
    }

    const added = vm.mute(phone, from, ids, msg.key?.participant || '')
    if (!added) return reply(`ℹ️ ${label} is already muted.`, { mentions: [mentionJid] })

    return reply(
      `🔇 ${label} has been muted.\nEverything they send in this group will be deleted until they are unmuted.`,
      { mentions: [mentionJid] }
    )
  },
}
