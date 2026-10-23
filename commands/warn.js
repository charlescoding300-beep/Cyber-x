'use strict';

const fs   = require('fs');
const path = require('path');
const adminLib = require('../lib/isAdmin')
const { sendBotNotAdmin } = require('../lib/groupAdminNotice')
const CREDIT = '> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*'

// ── Database ────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'warns.json');

let dbCache = null
let dbSaveQueue = Promise.resolve()

function loadDB() {
  if (dbCache) return dbCache
  try {
    if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
    dbCache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { dbCache = {}; }
  return dbCache
}

function saveDB(db) {
  dbCache = db
  const snapshot = JSON.stringify(db, null, 2)
  dbSaveQueue = dbSaveQueue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true })
    const temporary = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`
    try {
      await fs.promises.writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
      await fs.promises.rename(temporary, DATA_FILE)
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }).catch(e => {
    console.error('[WARN] save failed:', e.message)
    throw e
  })
  return dbSaveQueue
}

// Read the small legacy JSON file during command loading, not on the first warn.
loadDB()

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
  const raw = ctx.participantPn || ctx.participantAlt || ctx.participant || ctx.remoteJid || null;
  return raw ? normalizeJid(raw) : null;
}

function findParticipant(groupCache, groupJid, target) {
  const participants = groupCache?.[groupJid]?.participants
  if (!Array.isArray(participants)) return null
  return participants.find(participant => adminLib.participantMatches(participant, target)) || null
}

function canonicalTarget(participant, fallback) {
  const value = participant?.phoneNumber || participant?.id || participant?.jid || participant?.lid || fallback
  return value ? normalizeJid(value) : null
}

function targetAliases(participant, target) {
  return [...new Set([
    target,
    participant?.phoneNumber,
    participant?.id,
    participant?.jid,
    participant?.lid,
  ].filter(Boolean).map(normalizeJid))]
}

function matchingWarningKeys(members, aliases) {
  return Object.keys(members).filter(key =>
    aliases.some(alias => adminLib.participantMatches({ id: key }, alias))
  )
}

// ── Group info ──────────────────────────────────────────────────
async function getGroupInfo(sock, groupJid) {
  const context = await adminLib.getGroupAdminContext(sock, groupJid)
  if (!context.available) throw context.error || new Error('group role metadata unavailable')
  const admins = context.meta.participants.filter(adminLib.isAdminParticipant)
  return { meta: context.meta, admins, botIsAdmin: context.botAdmin }
}

// ── Usage card ───────────────────────────────────────────────────
function usageCard() {
  return `\
⚠️ *WARN SYSTEM — ZENX*
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

  run: async ({ sock, from, msg, sender, args, isGroup, isAdmin, isBotAdmin, groupCache }) => {

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

      const previousLimit = g.maxwarn
      g.maxwarn = n;
      try {
        await saveDB(db);
      } catch {
        g.maxwarn = previousLimit
        return sock.sendMessage(from, {
          text: `⚠️ I could not save the new warning limit. The previous limit is still active.\n\n${CREDIT}`,
        }, { quoted: msg });
      }

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
      const previousMembers = { ...g.members }
      const total = Object.keys(g.members).length;
      g.members = {};
      try {
        await saveDB(db);
      } catch {
        g.members = previousMembers
        return sock.sendMessage(from, {
          text: `⚠️ I could not save the warning reset. No reset was confirmed.\n\n${CREDIT}`,
        }, { quoted: msg });
      }

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

      const requested = raw ? normalizeJid(raw) : null;
      const target = requested ? canonicalTarget(findParticipant(groupCache, from, requested), requested) : null;

      if (!target) {
        return sock.sendMessage(from, {
          text:
`🧹 *Reset Warns*
${LINE}
❓ Usage: *.warn reset @user*
_Tag the member you want to clear._`
        }, { quoted: msg });
      }

      const participant = findParticipant(groupCache, from, target);
      const aliases = targetAliases(participant, target);
      const keys = matchingWarningKeys(g.members, aliases);
      const had = keys.reduce((total, key) => total + (Number(g.members[key]) || 0), 0);
      const previousValues = Object.fromEntries(keys.map(key => [key, g.members[key]]));
      for (const key of keys) delete g.members[key];
      try {
        await saveDB(db);
      } catch {
        Object.assign(g.members, previousValues)
        return sock.sendMessage(from, {
          text: `⚠️ I could not save the warning reset. No reset was confirmed.\n\n${CREDIT}`,
          mentions: [target],
        }, { quoted: msg });
      }

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

      const requested = raw ? normalizeJid(raw) : null;
      const participant = requested ? findParticipant(groupCache, from, requested) : null;
      const target = requested ? canonicalTarget(participant, requested) : null;

      if (!target) {
        return sock.sendMessage(from, {
          text:
`🔍 *Check Warns*
${LINE}
❓ Usage: *.warn check @user*
_Tag the member you want to inspect._`
        }, { quoted: msg });
      }

      const keys = matchingWarningKeys(g.members, targetAliases(participant, target));
      const count = keys.reduce((highest, key) => Math.max(highest, Number(g.members[key]) || 0), 0);
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

      // Verify the target against current LID/PN metadata before saving a
      // warning; if metadata is unavailable, fail closed instead of warning
      // an admin or writing a record against an unresolved identity.
      let warnGroupInfo
      let targetParticipant
      try {
        warnGroupInfo = await getGroupInfo(sock, from)
        targetParticipant = warnGroupInfo.meta.participants.find(p => adminLib.participantMatches(p, target))
      } catch (error) {
        console.error('[WARN] target role lookup failed:', error.message)
        return sock.sendMessage(from, {
          text: `⚠️ I could not verify that member’s current group role. Please try again.\n\n${CREDIT}`,
        }, { quoted: msg })
      }
      if (!targetParticipant) {
        return sock.sendMessage(from, {
          text: `⚠️ I could not match that reply to a current group member. Please reply to their message again.\n\n${CREDIT}`,
        }, { quoted: msg })
      }
      // Persist against the participant's phone JID when WhatsApp provides
      // it, so later replies/resets using either PN or LID find one record.
      target = canonicalTarget(targetParticipant, target)
      if (adminLib.isAdminParticipant(targetParticipant)) {
        return sock.sendMessage(from, {
          text:
`🛡️ *Cannot Warn Admin*
${LINE}
${fmt(target)} is a group admin.
Warns cannot be issued to admins.`,
          mentions: [target]
        }, { quoted: msg });
      }

      // Increment warn
      const previousCount = Number(g.members[target]) || 0
      g.members[target] = previousCount + 1
      const count = g.members[target];
      const left  = Math.max(0, g.maxwarn - count);
      const bar   = progressBar(count, g.maxwarn);
      try {
        await saveDB(db);
      } catch {
        if (previousCount) g.members[target] = previousCount
        else delete g.members[target]
        return sock.sendMessage(from, {
          text: `⚠️ I could not save this warning to local storage, so it was not issued. Please check the server’s data folder permissions and try again.\n\n${CREDIT}`,
          mentions: [target],
        }, { quoted: msg });
      }

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
`⚠️ *WARN ISSUED — ZENX*
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
          const info = warnGroupInfo || await getGroupInfo(sock, from);
          botIsAdmin  = info.botIsAdmin;

          const matchedParticipant = info.meta.participants.find(p => adminLib.participantMatches(p, target));

          if (matchedParticipant) {
            kickTarget = normalizeJid(matchedParticipant.id || matchedParticipant.jid || matchedParticipant.lid || matchedParticipant.phoneNumber);
          }

          console.log(`[WARN] Kicking ${kickTarget} | botAdmin: ${botIsAdmin}`);
        } catch (e) {
          console.error('[WARN] getGroupInfo error:', e.message);
        }

        if (botIsAdmin) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            await sock.groupParticipantsUpdate(from, [kickTarget], 'remove');
            await saveDB(db);

            console.log(`[WARN] ✅ Kicked ${kickTarget}`);

            await sock.sendMessage(from, {
              text:
`🔨 *MEMBER REMOVED*
${DLINE}

👤 *Member* : ${fmt(target)}
📌 *Reason* : Reached *${g.maxwarn}* warns
✅ *Action* : Removed from group

_Their warning record remains saved until an admin resets it._`,
              mentions: [target]
            }, { quoted: msg });
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
            }, { quoted: msg });
          }
        } else {
          await sendBotNotAdmin(sock, from, msg).catch(() => {})
        }
      }

      return;
    }

    return sock.sendMessage(from, { text: usageCard() }, { quoted: msg });
  }
};
