'use strict';

const fs   = require('fs');
const path = require('path');

// Chain antilink setSocket so both run when index.js calls lib.setSocket()
const _prior = [];
try {
  const al = require(path.join(__dirname, 'antilink.js'));
  if (typeof al.setSocket === 'function') _prior.push(al.setSocket);
} catch {}

// ── Database ────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'antistatus.json');

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
  if (!db[gid]) db[gid] = { enabled: false, mode: 'warn', maxwarn: 3, warns: {} };
  return db[gid];
}

// ── Helpers ─────────────────────────────────────────────────────
function getSender(msg) {
  return msg.key.participant || msg.key.remoteJid || '';
}

function fmt(jid) {
  return '@' + jid.replace(/@.+/, '');
}

async function isAdmin(sock, gid, jid) {
  try {
    const meta = await sock.groupMetadata(gid);
    return meta.participants.some(
      p => (p.id || p.jid) === jid &&
           (p.admin === 'admin' || p.admin === 'superadmin')
    );
  } catch { return false; }
}

async function isBotAdmin(sock, gid) {
  try {
    const meta  = await sock.groupMetadata(gid);
    const botId = (sock.user?.id || '').replace(/:.*@/, '@');
    return meta.participants.some(
      p => (p.id || p.jid) === botId &&
           (p.admin === 'admin' || p.admin === 'superadmin')
    );
  } catch { return false; }
}

// ── Status share detection ──────────────────────────────────────
function isStatusShare(msg) {
  if (!msg?.message) return false;
  const TARGET = 'status@broadcast';
  const TYPES  = [
    'extendedTextMessage','imageMessage','videoMessage',
    'audioMessage','stickerMessage','documentMessage',
  ];
  const wrappers = [
    msg.message,
    msg.message?.ephemeralMessage?.message,
    msg.message?.viewOnceMessage?.message,
    msg.message?.viewOnceMessageV2?.message,
    msg.message?.documentWithCaptionMessage?.message,
  ];
  for (const w of wrappers) {
    if (!w) continue;
    if (w.contextInfo?.remoteJid === TARGET) return true;
    for (const t of TYPES) {
      if (w[t]?.contextInfo?.remoteJid === TARGET) return true;
    }
  }
  return false;
}

// ── Auto enforcement ────────────────────────────────────────────
async function enforce(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!jid?.endsWith('@g.us')) return;

  const db = loadDB();
  const g  = getGroup(db, jid);
  if (!g.enabled)          return;
  if (!isStatusShare(msg)) return;

  const sender = getSender(msg);
  if (await isAdmin(sock, jid, sender)) return;

  if (!g.warns[sender]) g.warns[sender] = 0;
  g.warns[sender]++;
  const count     = g.warns[sender];
  const left      = Math.max(0, g.maxwarn - count);
  const botAdm    = await isBotAdmin(sock, jid);
  saveDB(db);

  // DM offender
  try {
    await sock.sendMessage(sender, {
      text:
`╔═══════════════════════════╗
║  ⚠️ ANTI-STATUS WARNING  ║
╚═══════════════════════════╝

You shared a *WhatsApp Status* in a group that has this feature disabled.

• Warn    : *${count} / ${g.maxwarn}*
• Left    : *${left}*
• Mode    : *${g.mode}*

${count >= g.maxwarn && g.mode === 'kick'
  ? '🚨 You have reached the limit and will be *removed*.'
  : `⚠️ ${left} more warn(s) before you are kicked.`}`
    });
  } catch {}

  // Group alert
  await sock.sendMessage(jid, {
    text:
`🚫 *CYBER X — Anti Status*

👤 Member : ${fmt(sender)}
⚠️  Warns  : ${count} / ${g.maxwarn}
⚙️  Mode   : *${g.mode}*
${left > 0 ? `🔔 ${left} warn(s) remaining before kick.` : '🚨 Max warns reached!'}`,
    mentions: [sender]
  });

  // Delete message
  if (g.mode === 'delete' || g.mode === 'kick') {
    if (botAdm) {
      try { await sock.sendMessage(jid, { delete: msg.key }); } catch {}
    } else {
      await sock.sendMessage(jid, { text: '⚠️ Make me admin to delete messages.' });
    }
  }

  // Kick
  if (g.mode === 'kick' && count >= g.maxwarn) {
    if (botAdm) {
      try {
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        await sock.sendMessage(jid, {
          text: `👢 *${fmt(sender)} has been removed* after ${g.maxwarn} warns.`,
          mentions: [sender]
        });
        delete g.warns[sender];
        saveDB(db);
      } catch {
        await sock.sendMessage(jid, {
          text: `❌ Couldn't kick ${fmt(sender)} — make me admin.`
        });
      }
    } else {
      await sock.sendMessage(jid, {
        text: `⚠️ ${fmt(sender)} hit max warns — I need admin rights to kick.`,
        mentions: [sender]
      });
    }
  }
}

// ── setSocket — called once by index.js ─────────────────────────
function setSocket(sock) {
  for (const fn of _prior) try { fn(sock); } catch {}

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg?.message) continue;
      try { await enforce(sock, msg); } catch {}
    }
  });
}

module.exports = { setSocket, loadDB, saveDB, getGroup, fmt, isAdmin, isBotAdmin, getSender };
