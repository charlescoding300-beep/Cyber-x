'use strict';

const fs   = require('fs');
const path = require('path');

// ── Database ────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'warns.json');

function loadDB() {
  try {
    if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return {}; }
}

function saveDB(db) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function getGroup(db, gid) {
  if (!db[gid]) db[gid] = { maxwarn: 10, members: {} };
  return db[gid];
}

// ── Normalize JID — strips :device suffix ───────────────────────
function normalizeJid(jid) {
  if (!jid) return jid
  return jid.replace(/:[0-9]+@/, '@').trim()
}

// ── Helpers ─────────────────────────────────────────────────────
function fmt(jid) {
  return '@' + jid.replace(/@.+/, '');
}

function progressBar(current, max) {
  const filled = Math.round((current / max) * 10);
  const empty  = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function danger(current, max) {
  const pct = current / max;
  if (pct >= 1)   return '🔴 MAX REACHED';
  if (pct >= 0.7) return '🟠 HIGH';
  if (pct >= 0.4) return '🟡 MODERATE';
  return '🟢 LOW';
}

// ── Get quoted participant ───────────────────────────────────────
function getQuoted(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo        ||
    msg.message?.videoMessage?.contextInfo        ||
    msg.message?.stickerMessage?.contextInfo      ||
    null;

  if (!ctx?.quotedMessage) return null;
  const raw = ctx.participant || ctx.remoteJid || null;
  return raw ? normalizeJid(raw) : null;
}

// ── Get bot JID properly ─────────────────────────────────────────
function getBotId(sock) {
  return normalizeJid(sock.user?.id || '')
}

// ── Check if participant is admin ────────────────────────────────
async function getGroupInfo(sock, groupJid) {
  const meta = await sock.groupMetadata(groupJid)
  const botId = getBotId(sock)

  const admins = meta.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => normalizeJid(p.id || p.jid || ''))

  const botIsAdmin = admins.some(id =>
    id === botId || id.includes(botId.split('@')[0])
  )

  return { meta, admins, botIsAdmin }
}

// ── Usage card ───────────────────────────────────────────────────
function usageCard() {
  return `╔══════════════════════════════════════╗
║       ⚠️   CYBER X — WARN SYSTEM      ║
╚══════════════════════════════════════╝

*How to use:*
Reply to a member's message, then type:

┌─ Commands ─────────────────────────
│ *.warn*
│  → Warn the replied member (+1)
│
│ *.warn set <number>*
│  → Set max warns before auto-kick
│  → Example: .warn set 5
│
│ *.warn reset @user*
│  → Reset a member's warns to 0
│
│ *.warn reset all*
│  → Wipe all warns in this group
│
│ *.warn check @user*
│  → Check a member's warn count
│
│ *.warn list*
│  → Show all member warn counts
└────────────────────────────────────

⚙️  *Admin & bot use only*
🔁  *Auto-kick when max warns hit*
💬  *Must reply to target message*`;
}

// ── Main ─────────────────────────────────────────────────────────
module.exports = {
  pattern: 'warn',

  run: async ({ sock, from, msg, sender, args, isGroup, isAdmin, isBotAdmin }) => {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: '❌ Warn command only works in groups.'
      }, { quoted: msg });
    }

    if (!isAdmin) {
      return sock.sendMessage(from, {
        text: '🔒 Only *admins* can use the warn command.'
      }, { quoted: msg });
    }

    const db  = loadDB();
    const g   = getGroup(db, from);
    const sub = (args[0] || '').toLowerCase();

    // ── .warn list ──────────────────────────────────────────────
    if (sub === 'list') {
      const entries = Object.entries(g.members).sort(([,a],[,b]) => b - a);
      if (!entries.length) {
        return sock.sendMessage(from, {
          text: '✅ No warns recorded in this group.'
        }, { quoted: msg });
      }

      const lines = entries.map(([jid, count]) => {
        const bar = progressBar(count, g.maxwarn);
        return `  ${fmt(jid)}\n  [${bar}] ${count}/${g.maxwarn} — ${danger(count, g.maxwarn)}`;
      }).join('\n\n');

      return sock.sendMessage(from, {
        text:
`╔══════════════════════════════════════╗
║       📋  WARN LIST — THIS GROUP     ║
╚══════════════════════════════════════╝

${lines}

⚙️ Max warns: *${g.maxwarn}*`
      }, { quoted: msg });
    }

    // ── .warn set <n> ───────────────────────────────────────────
    if (sub === 'set') {
      const n = parseInt(args[1], 10);
      if (!n || n < 1 || n > 50) {
        return sock.sendMessage(from, {
          text: '❓ Usage: *.warn set <1–50>*\nExample: .warn set 5'
        }, { quoted: msg });
      }
      g.maxwarn = n;
      saveDB(db);
      return sock.sendMessage(from, {
        text:
`╔══════════════════════════════════════╗
║        ⚙️  WARN LIMIT UPDATED        ║
╚══════════════════════════════════════╝

• New limit : *${n} warns*
• Action    : Auto-kick at *${n}*

Members will now be kicked after *${n}* warns.`
      }, { quoted: msg });
    }

    // ── .warn reset all ─────────────────────────────────────────
    if (sub === 'reset' && (args[1] || '').toLowerCase() === 'all') {
      g.members = {};
      saveDB(db);
      return sock.sendMessage(from, {
        text: '🧹 *All warns cleared* for this group.'
      }, { quoted: msg });
    }

    // ── .warn reset @user ───────────────────────────────────────
    if (sub === 'reset') {
      const raw =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (() => { const m = (args[1] || '').match(/\d{7,15}/); return m ? `${m[0]}@s.whatsapp.net` : null; })();

      const target = raw ? normalizeJid(raw) : null;

      if (!target) {
        return sock.sendMessage(from, {
          text: '❓ Tag a user: *.warn reset @user*'
        }, { quoted: msg });
      }

      const had = g.members[target] || 0;
      delete g.members[target];
      saveDB(db);

      return sock.sendMessage(from, {
        text:
`🧹 *Warns Reset*

• Member  : ${fmt(target)}
• Cleared : ${had} warn(s) → 0`,
        mentions: [target]
      }, { quoted: msg });
    }

    // ── .warn check @user ───────────────────────────────────────
    if (sub === 'check') {
      const raw =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (() => { const m = (args[1] || '').match(/\d{7,15}/); return m ? `${m[0]}@s.whatsapp.net` : null; })();

      const target = raw ? normalizeJid(raw) : null;

      if (!target) {
        return sock.sendMessage(from, {
          text: '❓ Tag a user: *.warn check @user*'
        }, { quoted: msg });
      }

      const count = g.members[target] || 0;
      const left  = Math.max(0, g.maxwarn - count);
      const bar   = progressBar(count, g.maxwarn);

      return sock.sendMessage(from, {
        text:
`╔══════════════════════════════════════╗
║         🔍  WARN CHECK               ║
╚══════════════════════════════════════╝

👤 Member   : ${fmt(target)}
⚠️  Warns    : *${count} / ${g.maxwarn}*
📊 Progress : [${bar}]
🔔 Status   : ${danger(count, g.maxwarn)}
📌 Remaining: *${left} warn(s) before kick*`,
        mentions: [target]
      }, { quoted: msg });
    }

    // ── .warn (main — reply required) ───────────────────────────
    if (!sub) {
      const target = getQuoted(msg);

      if (!target) {
        return sock.sendMessage(from, {
          text: usageCard()
        }, { quoted: msg });
      }

      // Don't warn admins
      try {
        const { admins } = await getGroupInfo(sock, from)
        const targetNorm = normalizeJid(target)
        if (admins.some(id => id === targetNorm || id.includes(targetNorm.split('@')[0]))) {
          return sock.sendMessage(from, {
            text: `⚠️ ${fmt(target)} is an admin — cannot warn admins.`,
            mentions: [target]
          }, { quoted: msg });
        }
      } catch {}

      // Increment
      if (!g.members[target]) g.members[target] = 0;
      g.members[target]++;
      const count = g.members[target];
      const left  = Math.max(0, g.maxwarn - count);
      const bar   = progressBar(count, g.maxwarn);
      saveDB(db);

      // DM the warned member
      try {
        await sock.sendMessage(target, {
          text:
`╔══════════════════════════════════╗
║     ⚠️  YOU HAVE BEEN WARNED    ║
╚══════════════════════════════════╝

You received a warn in a group.

• Warn count : *${count} / ${g.maxwarn}*
• Remaining  : *${left}*
• Status     : ${danger(count, g.maxwarn)}

${count >= g.maxwarn
  ? '🚨 You have hit the *maximum warns* and will be removed from the group.'
  : `⚠️ ${left} more warn(s) and you will be *auto-kicked*.`}

Please follow the group rules.`
        });
      } catch {}

      // Group warn message
      await sock.sendMessage(from, {
        text:
`╔══════════════════════════════════════╗
║       ⚠️   CYBER X — WARN ISSUED     ║
╚══════════════════════════════════════╝

👤 *Member*   : ${fmt(target)}
⚠️  *Warns*    : ${count} / ${g.maxwarn}
📊 *Progress* : [${bar}]
🔔 *Status*   : ${danger(count, g.maxwarn)}
📌 *Remaining*: ${left > 0 ? `${left} warn(s) before kick` : '🚨 KICK TRIGGERED'}

${count >= g.maxwarn
  ? `🚨 *${fmt(target)} has reached the warn limit!*`
  : `⚠️ *${left} more warn(s) until auto-kick.*`}`,
        mentions: [target]
      }, { quoted: msg });

      // ── Auto-kick on max ──────────────────────────────────────
      if (count >= g.maxwarn) {
        let botIsAdmin = false
        let kickTarget = target

        try {
          const info = await getGroupInfo(sock, from)
          botIsAdmin = info.botIsAdmin

          // ── LID fix: find the actual participant entry that matches ──
          // WhatsApp now uses LID internally; we match by phone number
          const phoneNumber = target.split('@')[0]
          const matchedParticipant = info.meta.participants.find(p => {
            const pid = normalizeJid(p.id || p.jid || '')
            return pid === target ||
                   pid.includes(phoneNumber) ||
                   (p.lid && p.lid.includes(phoneNumber))
          })

          if (matchedParticipant) {
            kickTarget = normalizeJid(matchedParticipant.id || matchedParticipant.jid)
          }

          console.log(`[WARN] Kicking ${kickTarget} | botAdmin: ${botIsAdmin}`)
        } catch (e) {
          console.error('[WARN] getGroupInfo error:', e.message)
        }

        if (botIsAdmin) {
          try {
            await new Promise(r => setTimeout(r, 1500))
            await sock.groupParticipantsUpdate(from, [kickTarget], 'remove')
            delete g.members[target]
            saveDB(db)

            console.log(`[WARN] ✅ Kicked ${kickTarget}`)

            await sock.sendMessage(from, {
              text:
`╔══════════════════════════════════════╗
║      🔨  MEMBER REMOVED              ║
╚══════════════════════════════════════╝

👤 *Member*  : ${fmt(target)}
📌 *Reason*  : Reached *${g.maxwarn}* warns
✅ *Action*  : Removed from group

Their warns have been reset.`,
              mentions: [target]
            });
          } catch (e) {
            console.error('[WARN] Kick failed:', e.message)
            await sock.sendMessage(from, {
              text: `❌ Couldn't kick ${fmt(target)} — Error: ${e.message}\n\nMake sure I'm *admin* with kick rights.`,
              mentions: [target]
            });
          }
        } else {
          await sock.sendMessage(from, {
            text: `🚨 ${fmt(target)} hit max warns but I need *admin rights* to kick.\n\nPlease promote the bot to admin.`,
            mentions: [target]
          });
        }
      }

      return;
    }

    return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
  }
};
