const run = async ({ sock, from, message, isGroup }) => {
  if (!isGroup) {
    return await sock.sendMessage(from, {
      text: `╔═══════════════════════╗
║  ⚠️  𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬 ⚠️  ║
╚═══════════════════════╝
❌ This command only works in groups!

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    }, { quoted: message });
  }

  try {
    const meta = await sock.groupMetadata(from);

    let inviteLink = 'N/A';
    try {
      const code = await sock.groupInviteCode(from);
      inviteLink = `https://chat.whatsapp.com/${code}`;
    } catch (_) {}

    let ppUrl = null;
    try {
      ppUrl = await sock.profilePictureUrl(from, 'image');
    } catch (_) {}

    const totalMembers = meta.participants.length;
    const admins = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
    const totalAdmins = admins.length;
    const totalRegular = totalMembers - totalAdmins;

    const isLocked = meta.restrict ? '🔒 Admins Only' : '🔓 All Members';
    const isAnnounce = meta.announce ? '📢 Announcement Mode' : '💬 Open Chat';
    const isEphemeral = meta.ephemeralDuration
      ? `⏳ ${meta.ephemeralDuration / 86400}d Disappearing`
      : '♾️ Messages Kept';

    const created = meta.creation
      ? new Date(meta.creation * 1000).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric'
        })
      : 'Unknown';

    const desc = meta.desc ? meta.desc.trim() : 'No description set';

    const caption = `╔══════════════════════════╗
║  🌐 ⚡ 𝗚𝗥𝗢𝗨𝗣 𝗜𝗡𝗙𝗢 ⚡ 🌐  ║
╚══════════════════════════╝

🏷️ *Name:* ${meta.subject}
🆔 *Group ID:* ${meta.id}
📅 *Created:* ${created}

━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 *Members:* ${totalMembers}
👑 *Admins:* ${totalAdmins}
🧑‍💻 *Regular:* ${totalRegular}
━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Description:*
${desc}
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ *Settings:*
  • ${isLocked}
  • ${isAnnounce}
  • ${isEphemeral}
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 *Invite Link:*
${inviteLink}
━━━━━━━━━━━━━━━━━━━━━━━━━━

> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`;

    if (ppUrl) {
      await sock.sendMessage(from, {
        image: { url: ppUrl },
        caption: caption
      }, { quoted: message });
    } else {
      await sock.sendMessage(from, { text: caption }, { quoted: message });
    }

  } catch (err) {
    console.error('[groupinfo error]', err);
    await sock.sendMessage(from, {
      text: `❌ Failed to fetch group info.\nError: ${err.message}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`
    }, { quoted: message });
  }
};

module.exports = {
  name: 'groupinfo',
  aliases: ['ginfo', 'groupinfo'],
  category: 'group',
  desc: 'Display full group information with photo and invite link',
  usage: '.groupinfo',
  run
};
