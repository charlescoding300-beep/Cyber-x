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

// ── Normalize JID ───────────────────────────────────────────────
function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.replace(/:[0-9]+@/, '@').trim();
}

// ── Helpers ─────────────────────────────────────────────────────
function fmt(jid) {
  return '@' + jid.replace(/@.+/, '');
}

function progressBar(current, max) {
  const filled = Math.round((current / max) * 10);
  const empty  = 10 - filled;
  return '▰'.repeat(filled) + '▱'.repeat(empty);
}

function statusBadge(current, max) {
  const pct = current / max;
  if (pct >= 1)   return '🔴 *LIMIT REACHED*';
  if (pct >= 0.7) return '🟠 *HIGH RISK*';
  if (pct >= 0.4) return '🟡 *MODERATE*';
  return '🟢 *SAFE*';
}

// ── Divider line ────────────────────────────────────────────────
const LINE  = '─────────────────────────────';
const DLINE = '═════════════════════════════';

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

// ── Get bot JID ─────────────────────────────────────────────────
function getBotId(sock) {
  return normalizeJid(sock.user?.id || '');
}

// ── Group info ──────────────────────────────────────────────────
async function getGroupInfo(sock, groupJid) {
  const meta   = await sock.groupMetadata(groupJid);
  const botId  = getBotId(sock);
  const admins = meta.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => normalizeJid(p.id || p.jid || ''));
  const botIsAdmin = admins.some(id =>
    id === botId || id.includes(botId.split('@')[0])
  );
  return { meta, admins, botIsAdmin };
}

// ── Usage card ───────────────────────────────────────────────────
function usageCard() {
  return `\
⚠️ *WARN SYSTEM — CYBER X*
${DLINE}

_The warn system lets admins issue_
_strikes against rule-breaking members._
_Hit the limit → instant removal._

${LINE}
📋 *COMMANDS*
${LINE}

▸ *.warn*
  Reply to a message to issue a warn

▸ *.warn set <1–50>*
  Set the max warn limit for this group
  _Example: .warn set 5_

▸ *.warn reset @user*
  Clear all warns for a specific member

▸ *.warn reset all*
  Wipe every member's warns in this group

▸ *.warn check @user*
  View a member's current warn count

▸ *.warn list*
  Show warn counts for all members

${LINE}
🔒 *Admin & bot use only*
🤖 *Bot must be admin to auto-kick*
💬 *Reply to a message to target a member*
${DLINE}`;
}

// ── Main ─────────────────────────────────────────────────────────
module.exports = {
  pattern:  'warn',
  category: 'group',

  run: async ({ sock, from, msg, sender, args, isGroup, isAdmin, isBotAdmin }) => {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text:
`❌ *Group Only*
${LINE}
This command only works inside group chats.`
      }, { quoted: msg });
    }

    if (!isAdmin) {
      return sock.sendMessage(from, {
        text:
`🔒 *Admins Only*
${LINE}
Only group admins can use the warn system.`
      }, { quoted: msg });
    }

    const db  = loadDB();
    const g   = getGroup(db, from);
    const sub = (args[0] || '').toLowerCase();

    // ── .warn list ──────────────────────────────────────────────
    if (sub === 'list') {
      const entries = Object.entries(g.members).sort(([, a], [, b]) => b - a);

      if (!entries.length) {
        return sock.sendMessage(from, {
          text:
`📋 *Warn List*
${LINE}
✅ No warns recorded in this group yet.`
        }, { quoted: msg });
      }

      const lines = entries.map(([jid, count], i) => {
        const bar = progressBar(count, g.maxwarn);
        return `${i + 1}. *${fmt(jid)}*\n    ${bar} ${count}/${g.maxwarn} — ${statusBadge(count, g.maxwarn)}`;
      }).join('\n\n');

      return sock.sendMessage(from, {
        text:
`📋 *WARN LIST — THIS GROUP*
${DLINE}

${lines}

${LINE}
⚙️  Max limit: *${g.maxwarn} warns*`
      }, { quoted: msg });
    }

    // ── .warn set <n> ───────────────────────────────────────────
    if (sub === 'set') {
      const n = parseInt(args[1], 10);
      if (!n || n < 1 || n > 50) {
        return sock.sendMessage(from, {
          text:
`⚙️ *Set Warn Limit*
${LINE}
❓ Usage: *.warn set <1–50>*
_Example: .warn set 5_`
        }, { quoted: msg });
      }

      g.maxwarn = n;
      saveDB(db);

      return sock.sendMessage(from, {
        text:
`⚙️ *WARN LIMIT UPDATED*
${DLINE}

✅ New limit set to *${n} warns*

Members will be *auto-kicked* once they
reach *${n}* warns in this group.

${LINE}
💡 _Use .warn to start issuing warns_`
      }, { quoted: msg });
    }

    // ── .warn reset all ─────────────────────────────────────────
    if (sub === 'reset' && (args[1] || '').toLowerCase() === 'all') {
      const total = Object.keys(g.members).length;
      g.members = {};
      saveDB(db);

      return sock.sendMessage(from, {
        text:
`🧹 *ALL WARNS CLEARED*
${DLINE}

✅ Wiped warns for *${total} member(s)*

This group now has a clean slate.`
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
          text:
`🧹 *Reset Warns*
${LINE}
❓ Usage: *.warn reset @user*
_Tag the member you want to clear._`
        }, { quoted: msg });
      }

      const had = g.members[target] || 0;
      delete g.members[target];
      saveDB(db);

      return sock.sendMessage(from, {
        text:
`🧹 *WARNS RESET*
${DLINE}

👤 Member  : *${fmt(target)}*
📌 Cleared : *${had} warn(s) → 0*

✅ Their record has been wiped.`,
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
          text:
`🔍 *Check Warns*
${LINE}
❓ Usage: *.warn check @user*
_Tag the member you want to inspect._`
        }, { quoted: msg });
      }

      const count = g.members[target] || 0;
      const left  = Math.max(0, g.maxwarn - count);
      const bar   = progressBar(count, g.maxwarn);

      return sock.sendMessage(from, {
        text:
`🔍 *WARN CHECK*
${DLINE}

👤 *Member*    : ${fmt(target)}
⚠️  *Warns*     : ${count} / ${g.maxwarn}
📊 *Progress*  : ${bar}
🏷️  *Status*    : ${statusBadge(count, g.maxwarn)}
📌 *Remaining* : *${left} warn(s) before kick*

${LINE}
${count >= g.maxwarn
  ? '🚨 _This member has hit the warn limit._'
  : `💡 _${left} more warn(s) until auto-removal._`}`,
        mentions: [target]
      }, { quoted: msg });
    }

    // ── .warn (main — reply required) ───────────────────────────
    if (!sub) {
      const target = getQuoted(msg);

      if (!target) {
        return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
      }

      // Block warning admins
      try {
        const { admins } = await getGroupInfo(sock, from);
        const targetNorm = normalizeJid(target);
        if (admins.some(id => id === targetNorm || id.includes(targetNorm.split('@')[0]))) {
          return sock.sendMessage(from, {
            text:
`🛡️ *Cannot Warn Admin*
${LINE}
${fmt(target)} is a group admin.
Warns cannot be issued to admins.`,
            mentions: [target]
          }, { quoted: msg });
        }
      } catch {}

      // Increment warn
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
`⚠️ *YOU HAVE BEEN WARNED*
${DLINE}

You received a warning in a group.

📊 *Progress*  : ${bar}
⚠️  *Warns*     : ${count} / ${g.maxwarn}
📌 *Remaining* : ${left} warn(s)
🏷️  *Status*    : ${statusBadge(count, g.maxwarn)}

${LINE}
${count >= g.maxwarn
  ? '🚨 *You have reached the max warn limit.*\nYou will be removed from the group.'
  : `⚠️ *${left} more warn(s)* until you are removed.\nPlease follow the group rules.`}`
        });
      } catch {}

      // Group warn notice
      await sock.sendMessage(from, {
        text:
`⚠️ *WARN ISSUED — CYBER X*
${DLINE}

👤 *Member*    : ${fmt(target)}
📊 *Progress*  : ${bar}
⚠️  *Warns*     : ${count} / ${g.maxwarn}
🏷️  *Status*    : ${statusBadge(count, g.maxwarn)}
📌 *Remaining* : ${left > 0 ? `${left} warn(s) before removal` : '🚨 *REMOVAL TRIGGERED*'}

${LINE}
${count >= g.maxwarn
  ? `🚨 *${fmt(target)} has hit the warn limit!*`
  : `💡 _${left} more warn(s) until auto-removal._`}`,
        mentions: [target]
      }, { quoted: msg });

      // ── Auto-kick on max ──────────────────────────────────────
      if (count >= g.maxwarn) {
        let botIsAdmin  = false;
        let kickTarget  = target;

        try {
          const info = await getGroupInfo(sock, from);
          botIsAdmin  = info.botIsAdmin;

          const phoneNumber        = target.split('@')[0];
          const matchedParticipant = info.meta.participants.find(p => {
            const pid = normalizeJid(p.id || p.jid || '');
            return pid === target ||
                   pid.includes(phoneNumber) ||
                   (p.lid && p.lid.includes(phoneNumber));
          });

          if (matchedParticipant) {
            kickTarget = normalizeJid(matchedParticipant.id || matchedParticipant.jid);
          }

          console.log(`[WARN] Kicking ${kickTarget} | botAdmin: ${botIsAdmin}`);
        } catch (e) {
          console.error('[WARN] getGroupInfo error:', e.message);
        }

        if (botIsAdmin) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            await sock.groupParticipantsUpdate(from, [kickTarget], 'remove');
            delete g.members[target];
            saveDB(db);

            console.log(`[WARN] ✅ Kicked ${kickTarget}`);

            await sock.sendMessage(from, {
              text:
`🔨 *MEMBER REMOVED*
${DLINE}

👤 *Member* : ${fmt(target)}
📌 *Reason* : Reached *${g.maxwarn}* warns
✅ *Action* : Removed from group

_Their warn record has been cleared._`,
              mentions: [target]
            });
          } catch (e) {
            console.error('[WARN] Kick failed:', e.message);
            await sock.sendMessage(from, {
              text:
`❌ *Kick Failed*
${LINE}
Could not remove ${fmt(target)}.

_Error: ${e.message}_

Make sure I'm *admin* with remove rights.`,
              mentions: [target]
            });
          }
        } else {
          await sock.sendMessage(from, {
            text:
`🚨 *ACTION REQUIRED*
${LINE}
${fmt(target)} hit *max warns* but I'm
not an admin — I can't remove them.

👑 Please *promote the bot to admin*
   so it can enforce the warn limit.`,
            mentions: [target]
          });
        }
      }

      return;
    }

    return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
  }
};
