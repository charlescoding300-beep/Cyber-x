'use strict'

module.exports = {
  pattern: 'groupinfo',
  alias: ['ginfo', 'groupinfo'],
  category: 'group/admin',
  desc: 'Display full group information with photo and invite link',
  usage: '.groupinfo',

  run: async ({ sock, from, msg, message, isGroup }) => {

    if (!isGroup) {
      return sock.sendMessage(from, {
        text: `╔═══════════════════════╗\n║  ⚠️  𝗚𝗥𝗢𝗨𝗣 𝗢𝗡𝗟𝗬 ⚠️  ║\n╚═══════════════════════╝\n\n❌ This command only works in groups!\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }

    try {
      const meta = await sock.groupMetadata(from)

      let inviteLink = 'N/A'
      try {
        const code = await sock.groupInviteCode(from)
        inviteLink = `https://chat.whatsapp.com/${code}`
      } catch (_) {}

      let ppUrl = null
      try {
        ppUrl = await sock.profilePictureUrl(from, 'image')
      } catch (_) {}

      const totalMembers = meta.participants.length
      const admins = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      const totalAdmins = admins.length
      const totalRegular = totalMembers - totalAdmins

      const isLocked = meta.restrict ? '🔒 Admins Only' : '🔓 All Members'
      const isAnnounce = meta.announce ? '📢 Announcement Mode' : '💬 Open Chat'
      const isEphemeral = meta.ephemeralDuration
        ? `⏳ ${meta.ephemeralDuration / 86400}d Disappearing`
        : '♾️ Messages Kept'

      const created = meta.creation
        ? new Date(meta.creation * 1000).toLocaleDateString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric'
          })
        : 'Unknown'

      const desc = meta.desc ? meta.desc.trim() : 'No description set'

      const caption = `╔══════════════════════════╗\n║  🌐 ⚡ 𝗚𝗥𝗢𝗨𝗣 𝗜𝗡𝗙𝗢 ⚡ 🌐  ║\n╚══════════════════════════╝\n\n🏷️ *Name:* ${meta.subject}\n🆔 *Group ID:* ${meta.id}\n📅 *Created:* ${created}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n👥 *Members:* ${totalMembers}\n👑 *Admins:* ${totalAdmins}\n🧑‍💻 *Regular:* ${totalRegular}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n📝 *Description:*\n${desc}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚙️ *Settings:*\n  • ${isLocked}\n  • ${isAnnounce}\n  • ${isEphemeral}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔗 *Invite Link:*\n${inviteLink}\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`

      if (ppUrl) {
        await sock.sendMessage(from, {
          image: { url: ppUrl },
          caption: caption
        }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { text: caption }, { quoted: msg })
      }

    } catch (err) {
      console.error('[groupinfo error]', err)
      sock.sendMessage(from, {
        text: `❌ Failed to fetch group info.\nError: ${err.message}\n\n> © 𝕮𝖄𝕭𝕰𝕽 𝖃 ™`,
        quoted: msg
      })
    }
  }
}
