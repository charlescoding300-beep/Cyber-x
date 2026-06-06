'use strict';

const path = require('path');
const {
  loadDB, saveDB, getGroup,
  fmt, isAdmin, isBotAdmin,
} = require(path.join(__dirname, '../lib/antistatus.js'));

function usageCard() {
  return `╔════════════════════════════════════╗
║     🚫  𝘾𝙔𝘽𝙀𝙍 𝙓 — ANTI STATUS      ║
╚════════════════════════════════════╝

*Commands* — prefix .

┌─ Anyone ───────────────────────────
│ .antistatus
│  → Show this card
│
│ .antistatus status
│  → Show group config + warn counts
│
│ .antistatus warns
│  → List all member warns
└────────────────────────────────────

┌─ Admin only ───────────────────────
│ .antistatus on
│  → Enable (warn mode default)
│
│ .antistatus on warn
│  → DM offender + group alert
│
│ .antistatus on delete
│  → Delete msg + DM + warn
│
│ .antistatus on kick
│  → Delete + warn → kick at max
│
│ .antistatus off
│  → Disable
│
│ .antistatus mode warn
│ .antistatus mode delete
│ .antistatus mode kick
│  → Change mode while keeping on
│
│ .antistatus maxwarn 3
│  → Set max warns before kick
│
│ .antistatus clearwarn @user
│  → Reset one member's warns
│
│ .antistatus clearwarn all
│  → Wipe all warns in group
└────────────────────────────────────

┌─ Modes ────────────────────────────
│ warn   → DM + group alert only
│ delete → Delete msg + DM + warn
│ kick   → Delete + auto kick at max
└────────────────────────────────────`;
}

function getMentioned(msg, text) {
  const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (m) return m;
  const n = text.match(/\d{7,15}/);
  return n ? `${n[0]}@s.whatsapp.net` : null;
}

module.exports = {
  pattern: 'antistatus',

  run: async ({ sock, from, msg, sender, args, isGroup, isAdmin: callerIsAdmin }) => {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: '❌ Anti-Status only works inside groups.'
      }, { quoted: msg });
    }

    const db   = loadDB();
    const g    = getGroup(db, from);
    const sub  = (args[0] || '').toLowerCase();
    const sub2 = (args[1] || '').toLowerCase();

    // ── PUBLIC ──────────────────────────────────────────────────

    if (!sub || sub === 'help') {
      return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
    }

    if (sub === 'status') {
      const warnLines = Object.entries(g.warns)
        .sort(([,a],[,b]) => b - a)
        .map(([j, c]) => `  • ${fmt(j)} — ${c} / ${g.maxwarn}`)
        .join('\n') || '  (none)';

      return sock.sendMessage(from, {
        text:
`📊 *𝘾𝙔𝘽𝙀𝙍 𝙓 — Anti Status Config*

• Status    : ${g.enabled ? '✅ Enabled' : '❌ Disabled'}
• Mode      : *${g.mode}*
• Max Warns : *${g.maxwarn}*

⚠️ *Warn Counts:*
${warnLines}`
      }, { quoted: msg });
    }

    if (sub === 'warns') {
      const entries = Object.entries(g.warns).sort(([,a],[,b]) => b - a);
      if (!entries.length) {
        return sock.sendMessage(from, {
          text: '✅ No warns recorded in this group.'
        }, { quoted: msg });
      }
      const lines = entries.map(([j, c]) => `  • ${fmt(j)} — ${c} warn(s)`).join('\n');
      return sock.sendMessage(from, {
        text: `⚠️ *Warn List*\n\n${lines}`
      }, { quoted: msg });
    }

    // ── ADMIN ONLY ───────────────────────────────────────────────

    if (!callerIsAdmin) {
      return sock.sendMessage(from, {
        text: '🔒 Only *group admins* can use this command.'
      }, { quoted: msg });
    }

    // .antistatus on [mode]
    if (sub === 'on') {
      const mode = ['warn','delete','kick'].includes(sub2) ? sub2 : 'warn';
      g.enabled = true;
      g.mode    = mode;
      saveDB(db);

      const botAdm = await isBotAdmin(sock, from);
      const warn   = (mode === 'delete' || mode === 'kick') && !botAdm
        ? '\n\n⚠️ Make me *admin* so I can delete/kick.' : '';

      return sock.sendMessage(from, {
        text:
`✅ *Anti-Status Enabled*

• Mode      : *${mode}*
• Max Warns : *${g.maxwarn}*${warn}`
      }, { quoted: msg });
    }

    // .antistatus off
    if (sub === 'off') {
      g.enabled = false;
      saveDB(db);
      return sock.sendMessage(from, {
        text: '❌ *Anti-Status has been disabled.*'
      }, { quoted: msg });
    }

    // .antistatus mode <warn|delete|kick>
    if (sub === 'mode') {
      if (!['warn','delete','kick'].includes(sub2)) {
        return sock.sendMessage(from, {
          text: '❓ Valid modes: *warn* | *delete* | *kick*'
        }, { quoted: msg });
      }
      g.mode = sub2;
      saveDB(db);

      const botAdm = await isBotAdmin(sock, from);
      const warn   = (sub2 === 'delete' || sub2 === 'kick') && !botAdm
        ? '\n⚠️ Make me admin for this mode to work.' : '';

      return sock.sendMessage(from, {
        text: `🔄 Mode changed to *${sub2}*${warn}`
      }, { quoted: msg });
    }

    // .antistatus maxwarn <n>
    if (sub === 'maxwarn') {
      const n = parseInt(args[1], 10);
      if (!n || n < 1 || n > 20) {
        return sock.sendMessage(from, {
          text: '❓ Usage: *.antistatus maxwarn <1–20>*'
        }, { quoted: msg });
      }
      g.maxwarn = n;
      saveDB(db);
      return sock.sendMessage(from, {
        text: `⚙️ Max warns set to *${n}*`
      }, { quoted: msg });
    }

    // .antistatus clearwarn all | @user
    if (sub === 'clearwarn') {
      if (sub2 === 'all') {
        g.warns = {};
        saveDB(db);
        return sock.sendMessage(from, {
          text: '🧹 All warns cleared for this group.'
        }, { quoted: msg });
      }

      const target = getMentioned(msg, args.slice(1).join(' '));
      if (!target) {
        return sock.sendMessage(from, {
          text: '❓ Tag a user or use *all*.\nExample: .antistatus clearwarn @user'
        }, { quoted: msg });
      }

      if (!g.warns[target]) {
        return sock.sendMessage(from, {
          text: `ℹ️ ${fmt(target)} has no warns.`
        }, { quoted: msg });
      }

      delete g.warns[target];
      saveDB(db);
      return sock.sendMessage(from, {
        text: `🧹 Warns cleared for ${fmt(target)}`,
        mentions: [target]
      }, { quoted: msg });
    }

    // fallback
    return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
  }
};
