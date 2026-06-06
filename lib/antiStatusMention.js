/**
 * ╔══════════════════════════════════════════════╗
 * ║        ANTI STATUS MENTION GROUP             ║
 * ║   Detects & handles group mentions in status ║
 * ╚══════════════════════════════════════════════╝
 *
 * lib/antiStatusMention.js
 * Compatible with Baileys (multi-device) WhatsApp bots
 */

'use strict';

// ─── In-memory store (replace with DB if you need persistence) ───────────────
const store = {
  /** @type {Map<string, { enabled: boolean, action: 'warn'|'kick'|'delete', maxWarns: number }>} */
  groupSettings: new Map(),

  /** @type {Map<string, Map<string, number>>} groupId → jid → warnCount */
  warns: new Map(),
};

// ─── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: false,
  action: 'warn',   // 'warn' | 'kick' | 'delete'
  maxWarns: 3,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get settings for a group, seeding defaults if not present.
 * @param {string} groupId
 */
function getSettings(groupId) {
  if (!store.groupSettings.has(groupId)) {
    store.groupSettings.set(groupId, { ...DEFAULT_SETTINGS });
  }
  return store.groupSettings.get(groupId);
}

/**
 * Update settings for a group (partial update).
 * @param {string} groupId
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
function updateSettings(groupId, patch) {
  const current = getSettings(groupId);
  store.groupSettings.set(groupId, { ...current, ...patch });
}

/**
 * Add a warning to a user in a group.
 * @param {string} groupId
 * @param {string} jid
 * @returns {{ count: number, maxWarns: number, exceeded: boolean }}
 */
function addWarn(groupId, jid) {
  if (!store.warns.has(groupId)) store.warns.set(groupId, new Map());
  const groupWarns = store.warns.get(groupId);
  const count = (groupWarns.get(jid) || 0) + 1;
  groupWarns.set(jid, count);
  const { maxWarns } = getSettings(groupId);
  return { count, maxWarns, exceeded: count >= maxWarns };
}

/**
 * Reset warnings for a user in a group.
 * @param {string} groupId
 * @param {string} jid
 */
function resetWarn(groupId, jid) {
  store.warns.get(groupId)?.delete(jid);
}

/**
 * Check if a message is a status broadcast that mentions this group.
 * Returns true when:
 *   • The message comes from status@broadcast
 *   • OR the quoted/context message references the group JID
 *   • OR the message body contains the group's invite link / @group mention
 *
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} msg
 * @param {string} groupId
 * @returns {boolean}
 */
function isStatusMentioningGroup(msg, groupId) {
  try {
    const from = msg.key?.remoteJid || '';
    const participant = msg.key?.participant || msg.participant || '';
    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    // 1) Direct status broadcast message inside the group that references status
    if (from === 'status@broadcast') return true;

    // 2) Message in group that quotes a status or contains group link / mention
    const groupShortId = groupId.replace('@g.us', '');
    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo;

    // Quoted status
    if (contextInfo?.remoteJid === 'status@broadcast') return true;

    // Body contains the group's numerical ID or a WhatsApp invite link
    if (
      body.includes(groupShortId) ||
      /chat\.whatsapp\.com\/[A-Za-z0-9]+/.test(body)
    ) {
      return true;
    }

    // mentionedJid list contains the group itself
    const mentioned = contextInfo?.mentionedJid || [];
    if (mentioned.includes(groupId)) return true;

    return false;
  } catch {
    return false;
  }
}

// ─── Core handler (call this from your main message event) ───────────────────

/**
 * Handle an incoming message — returns an action descriptor or null.
 *
 * @param {object} params
 * @param {import('@whiskeysockets/baileys').WASocket} params.sock   Baileys socket
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} params.msg
 * @param {string}  params.groupId   e.g. "120363xxxxxxxx@g.us"
 * @param {string}  params.senderJid e.g. "628xxxxxxxx@s.whatsapp.net"
 * @param {boolean} params.isAdmin   is the sender an admin?
 * @param {boolean} params.isBotAdmin is the bot an admin in this group?
 * @returns {Promise<'warned'|'kicked'|'deleted'|'skip'|null>}
 */
async function handleAntiStatusMention({
  sock,
  msg,
  groupId,
  senderJid,
  isAdmin,
  isBotAdmin,
}) {
  const settings = getSettings(groupId);

  // Feature disabled or sender is admin → skip
  if (!settings.enabled || isAdmin) return 'skip';

  // Not a status mention? Nothing to do
  if (!isStatusMentioningGroup(msg, groupId)) return null;

  const msgKey = msg.key;
  const action  = settings.action;

  // Always delete the offending message if bot is admin
  if (isBotAdmin) {
    await sock.sendMessage(groupId, { delete: msgKey }).catch(() => {});
  }

  if (action === 'delete') {
    await sock.sendMessage(groupId, {
      text: `⚠️ @${senderJid.split('@')[0]} — sharing status mentions of this group is *not allowed*. Message removed.`,
      mentions: [senderJid],
    });
    return 'deleted';
  }

  if (action === 'warn') {
    const { count, maxWarns, exceeded } = addWarn(groupId, senderJid);

    if (exceeded) {
      // Auto-kick after max warns
      if (isBotAdmin) {
        await sock
          .groupParticipantsUpdate(groupId, [senderJid], 'remove')
          .catch(() => {});
      }
      resetWarn(groupId, senderJid);
      await sock.sendMessage(groupId, {
        text:
          `🚫 @${senderJid.split('@')[0]} has been *removed* after reaching ` +
          `${maxWarns} warning(s) for mentioning this group in a status.`,
        mentions: [senderJid],
      });
      return 'kicked';
    }

    await sock.sendMessage(groupId, {
      text:
        `⚠️ @${senderJid.split('@')[0]} — *Warning ${count}/${maxWarns}*\n` +
        `Do not mention this group in your WhatsApp status.`,
      mentions: [senderJid],
    });
    return 'warned';
  }

  if (action === 'kick') {
    if (isBotAdmin) {
      await sock
        .groupParticipantsUpdate(groupId, [senderJid], 'remove')
        .catch(() => {});
    }
    await sock.sendMessage(groupId, {
      text: `🚫 @${senderJid.split('@')[0]} was *removed* for mentioning this group in a status.`,
      mentions: [senderJid],
    });
    return 'kicked';
  }

  return null;
}

// ─── Command handler (integrate into your bot's command router) ──────────────

/**
 * Process admin commands related to anti-status-mention.
 * Commands (prefix-free, lowercase body expected):
 *   antistatusmention on
 *   antistatusmention off
 *   antistatusmention set warn|kick|delete
 *   antistatusmention setwarn <number>
 *   antistatusmention resetwarn @user
 *   antistatusmention status
 *
 * @param {object} params
 * @param {import('@whiskeysockets/baileys').WASocket} params.sock
 * @param {import('@whiskeysockets/baileys').proto.IWebMessageInfo} params.msg
 * @param {string}  params.groupId
 * @param {string}  params.senderJid
 * @param {boolean} params.isAdmin
 * @param {string[]} params.args  e.g. ['on'] or ['set', 'kick']
 * @returns {Promise<void>}
 */
async function handleCommand({ sock, msg, groupId, senderJid, isAdmin, args }) {
  const reply = async (text) =>
    sock.sendMessage(groupId, { text }, { quoted: msg });

  if (!isAdmin) {
    return reply('❌ Only group admins can configure Anti-Status-Mention.');
  }

  const settings = getSettings(groupId);
  const [sub, ...rest] = args.map((a) => a.toLowerCase());

  switch (sub) {
    case 'on':
      updateSettings(groupId, { enabled: true });
      return reply('✅ Anti-Status-Mention is now *ON* for this group.');

    case 'off':
      updateSettings(groupId, { enabled: false });
      return reply('🔕 Anti-Status-Mention is now *OFF* for this group.');

    case 'set': {
      const mode = rest[0];
      if (!['warn', 'kick', 'delete'].includes(mode)) {
        return reply('❓ Usage: `antistatusmention set warn|kick|delete`');
      }
      updateSettings(groupId, { action: mode });
      return reply(`⚙️ Action set to *${mode}*.`);
    }

    case 'setwarn': {
      const n = parseInt(rest[0], 10);
      if (isNaN(n) || n < 1) {
        return reply('❓ Usage: `antistatusmention setwarn <number>` (min 1)');
      }
      updateSettings(groupId, { maxWarns: n });
      return reply(`⚙️ Max warnings set to *${n}*.`);
    }

    case 'resetwarn': {
      const mentioned =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        (rest[0] ? `${rest[0].replace(/[^0-9]/g, '')}@s.whatsapp.net` : null);
      if (!mentioned) return reply('❓ Mention the user whose warnings you want to reset.');
      resetWarn(groupId, mentioned);
      return reply(`✅ Warnings reset for @${mentioned.split('@')[0]}.`);
    }

    case 'status': {
      const s = getSettings(groupId);
      return reply(
        `📋 *Anti-Status-Mention Settings*\n` +
        `• Status : ${s.enabled ? '✅ ON' : '❌ OFF'}\n` +
        `• Action : ${s.action}\n` +
        `• Max Warns : ${s.maxWarns}`
      );
    }

    default:
      return reply(
        `📖 *Anti-Status-Mention Commands*\n` +
        `• \`antistatusmention on/off\`\n` +
        `• \`antistatusmention set warn|kick|delete\`\n` +
        `• \`antistatusmention setwarn <num>\`\n` +
        `• \`antistatusmention resetwarn @user\`\n` +
        `• \`antistatusmention status\``
      );
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  handleAntiStatusMention,
  handleCommand,
  getSettings,
  updateSettings,
  isStatusMentioningGroup,
  addWarn,
  resetWarn,
};
