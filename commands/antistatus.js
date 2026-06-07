"use strict"

/**
 * commands/antistatus.js
 * Uses your bot's exact pattern + run format.
 * No ./store, no external deps except lib/antiStatusMention.
 */

const { getGroup, clearWarn, countWarn } = require("../lib/antiStatusMention")

module.exports = {
  pattern : "antistatus",
  desc    : "Prevent members/admins from mentioning this group in their WhatsApp status",
  category: "group",

  run: async ({ sock, from, msg, sender, args, isAdmin, isOwner, isBotAdmin }) => {
    const reply = t => sock.sendMessage(from, { text: t }, { quoted: msg })

    // ── Permission gate ────────────────────────────────────────
    if (!isAdmin && !isOwner) {
      return reply(
        `❌ *Permission Denied*\n` +
        `Only group admins or the bot owner can use .antistatus`
      )
    }

    const cfg  = getGroup(from)
    const sub  = (args[0] || "").toLowerCase()
    const val  = (args[1] || "").toLowerCase()

    // ── .antistatus admin on/off ───────────────────────────────
    if (sub === "admin") {
      if (val === "on") {
        cfg.admin.enabled = true
        return reply(
          `✅ *Admin Anti-Status — ON*\n\n` +
          `Even group admins who mention this group in their status will have their message *deleted* immediately.\n\n` +
          `_Note: Admins are never kicked — message deletion only._`
        )
      }
      if (val === "off") {
        cfg.admin.enabled = false
        return reply(
          `🔕 *Admin Anti-Status — OFF*\n` +
          `Admins are no longer monitored.`
        )
      }
      return reply(
        `📖 *Admin Mode*\n\n` +
        `.antistatus admin on  — enable\n` +
        `.antistatus admin off — disable`
      )
    }

    // ── .antistatus on ─────────────────────────────────────────
    if (sub === "on") {
      cfg.members.enabled = true
      return reply(
        `✅ *Anti-Status Mention — ON*\n\n` +
        `Members who share or mention this group in a WhatsApp status will be actioned.\n\n` +
        `Action   : *${cfg.members.action}*\n` +
        `Max Warns: *${cfg.members.maxWarns}*\n\n` +
        `_Admins are exempt. Use .antistatus admin on to also cover admins._`
      )
    }

    // ── .antistatus off ────────────────────────────────────────
    if (sub === "off") {
      cfg.members.enabled = false
      return reply(`🔕 *Anti-Status Mention — OFF*`)
    }

    // ── .antistatus set warn|kick|delete ───────────────────────
    if (sub === "set") {
      if (!["warn", "kick", "delete"].includes(val)) {
        return reply(
          `❓ *Usage:* .antistatus set warn|kick|delete\n\n` +
          `• *warn*   — warn user, auto-kick after max warns\n` +
          `• *kick*   — remove user immediately\n` +
          `• *delete* — delete message only, no kick`
        )
      }
      cfg.members.action = val
      return reply(`⚙️ Action set to *${val}*`)
    }

    // ── .antistatus setwarn <n> ────────────────────────────────
    if (sub === "setwarn") {
      const n = parseInt(val, 10)
      if (!val || isNaN(n) || n < 1) {
        return reply(
          `❓ *Usage:* .antistatus setwarn <number>\n` +
          `Example: .antistatus setwarn 3`
        )
      }
      cfg.members.maxWarns = n
      return reply(`⚙️ Max warnings set to *${n}*. Users kicked on warn *${n}*.`)
    }

    // ── .antistatus resetwarn @user ────────────────────────────
    if (sub === "resetwarn") {
      const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (val ? val.replace(/\D/g, "") + "@s.whatsapp.net" : null)
      if (!target) {
        return reply(`❓ *Usage:* .antistatus resetwarn @user`)
      }
      const before = countWarn(from, target)
      clearWarn(from, target)
      return reply(
        `✅ Warnings cleared for @${target.split("@")[0]}\n` +
        `Before: *${before}* → Now: *0*`
      )
    }

    // ── .antistatus status ─────────────────────────────────────
    if (sub === "status") {
      return reply(
        `📋 *Anti-Status — Settings*\n\n` +
        `👥 *Member Mode*\n` +
        `  Status   : ${cfg.members.enabled ? "✅ ON" : "❌ OFF"}\n` +
        `  Action   : *${cfg.members.action}*\n` +
        `  Max Warns: *${cfg.members.maxWarns}*\n\n` +
        `👑 *Admin Mode*\n` +
        `  Status   : ${cfg.admin.enabled ? "✅ ON" : "❌ OFF"}\n` +
        `  Action   : *delete only* (never kicks admins)`
      )
    }

    // ── .antistatus (no args) = help ───────────────────────────
    return reply(
      `╔═══════════════════════════╗\n` +
      `║   ANTI STATUS MENTION     ║\n` +
      `╚═══════════════════════════╝\n\n` +
      `*Member Commands*\n` +
      `.antistatus on\n` +
      `.antistatus off\n` +
      `.antistatus set warn|kick|delete\n` +
      `.antistatus setwarn <number>\n` +
      `.antistatus resetwarn @user\n` +
      `.antistatus status\n\n` +
      `*Admin Commands*\n` +
      `.antistatus admin on\n` +
      `.antistatus admin off\n\n` +
      `_Only group admins & bot owner._`
    )
  }
}
