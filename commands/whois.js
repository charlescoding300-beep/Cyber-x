const run = async ({ sock, from, message, sender, isGroup }) => {

  // Determine target — quoted message sender or self
  const quoted = message.message?.extendedTextMessage?.contextInfo;
  let targetJid = null;

  if (quoted?.participant) {
    targetJid = quoted.participant;
  } else if (quoted?.remoteJid) {
    targetJid = quoted.remoteJid;
  } else {
    targetJid = sender;
  }

  // Clean JID to extract phone number
  const phone = targetJid.replace(/[^0-9]/g, '');
  const cleanJid = `${phone}@s.whatsapp.net`;

  try {
    // Profile picture
    let ppUrl = null;
    try {
      ppUrl = await sock.profilePictureUrl(cleanJid, 'image');
    } catch (_) {}

    // About / status
    let about = 'No status set';
    try {
      const status = await sock.fetchStatus(cleanJid);
      if (status?.status) about = status.status;
    } catch (_) {}

    // Business profile
    let isBusiness = false;
    let bizDesc = null;
    let bizCategory = null;
    try {
      const biz = await sock.getBusinessProfile(cleanJid);
      if (biz?.description) {
        isBusiness = true;
        bizDesc = biz.description;
        bizCategory = biz.category || null;
      }
    } catch (_) {}

    // Group-specific info (admin status, etc.)
    let roleLabel = '👤 Member';
    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(from);
        const participant = meta.participants.find(p =>
          p.id.replace(/[^0-9]/g, '') === phone
        );
        if (participant?.admin === 'superadmin') roleLabel = '👑 Group Creator';
        else if (participant?.admin === 'admin') roleLabel = '🛡️ Admin';
        else roleLabel = '👤 Member';
      } catch (_) {}
    }

    const tag = `@${phone}`;

    const caption = `╔══════════════════════════╗
║  🕵️ ⚡ 𝗪𝗛𝗢 𝗜𝗦 ⚡ 🕵️  ║
╚══════════════════════════╝

👤 *User:* ${tag}
📱 *Number:* +${phone}
🆔 *JID:* ${cleanJid}

━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 *About:*
${about}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ *Role:* ${roleLabel}
💼 *Account Type:* ${isBusiness ? '🏢 Business Account' : '👤 Personal Account'}${bizCategory ? `\n📂 *Business Category:* ${bizCategory}` : ''}${bizDesc ? `\n📝 *Business Bio:* ${bizDesc}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`;

    if (ppUrl) {
      await sock.sendMessage(from, {
        image: { url: ppUrl },
        caption: caption,
        mentions: [cleanJid]
      }, { quoted: message });
    } else {
      await sock.sendMessage(from, {
        text: caption,
        mentions: [cleanJid]
      }, { quoted: message });
    }

  } catch (err) {
    console.error('[whois error]', err);
    await sock.sendMessage(from, {
      text: `❌ Failed to fetch user info.\nError: ${err.message}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    }, { quoted: message });
  }
};

module.exports = {
  name: 'whois',
  aliases: ['whois', 'who'],
  category: 'general',
  desc: 'Get full info on a user — reply to their message and type .whois',
  usage: '.whois (reply to a message)',
  run
};
