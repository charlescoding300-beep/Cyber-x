'use strict'
/**
 * commands/info.js — CYBER X | Official Info
 *
 * Usage: .info
 * ✅ Instant reaction
 * ✅ Image + caption
 * ✅ Quoted reply
 */

const CREDIT  = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const IMG_URL = 'https://i.ibb.co/spf35QYC/file-00000000a30c71f48bb49e183e1d43cb.png'

module.exports = {
  pattern:  'info',
  desc:     'Official CYBER X information',
  usage:    '.info',
  category: 'general',

  run: async ({ sock, from, msg, sender }) => {

    // React instantly
    sock.sendMessage(from, {
      react: { text: '🌐', key: msg.key }
    }).catch(() => {})

    const caption =
`✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦
╔══════════════════════════╗
║                          ║
║     𝘾𝙔𝘽𝙀𝙍  𝙓  ™         ║
║   *Official Information*   ║
║                          ║
╚══════════════════════════╝
✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦

Welcome to *CYBER X* — an advanced WhatsApp automation and utility bot designed to deliver powerful features across security, entertainment, moderation, and productivity for users and communities worldwide.

CYBER X was built with a vision of providing a *fast, reliable, and modern* WhatsApp experience. The platform is continuously developed and maintained to ensure stability, innovation, and user satisfaction.

━━━━━━━━━━━━━━━━━━━━━━━━━━
👨‍💻 *FOUNDER & LEAD DEVELOPER*
━━━━━━━━━━━━━━━━━━━━━━━━━━

*Charles Chucks*

Creator and driving force behind CYBER X. Through dedication, creativity, and continuous development, Charles has transformed CYBER X into a feature-rich platform trusted by communities across WhatsApp.

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *MISSION*
━━━━━━━━━━━━━━━━━━━━━━━━━━

To provide users with a *smart, secure, and efficient* WhatsApp assistant capable of enhancing communication, moderation, entertainment, and automation.

━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 *CORE FEATURES*
━━━━━━━━━━━━━━━━━━━━━━━━━━

◈ Group Management & Moderation
◈ AI Assistance & Smart Replies
◈ Media Download Tools
◈ Security & Anti-Spam Systems
◈ Games & Entertainment
◈ Utility Commands
◈ Custom Automation Systems

━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 *OFFICIAL CERTIFICATE*
━━━━━━━━━━━━━━━━━━━━━━━━━━

╔══════════════════════════╗
║  ✦ *CERTIFICATE OF*      ║
║    *AUTHENTICITY* ✦      ║
║                          ║
║  This confirms that      ║
║  *CYBER X* is an         ║
║  officially created and  ║
║  actively maintained     ║
║  WhatsApp Bot Platform.  ║
║                          ║
║  🔏 *Authorized by:*     ║
║  Charles Chucks          ║
║                          ║
║  📌 *Status:*            ║
║  ✅ ACTIVE & VERIFIED    ║
║                          ║
║  🌐 *Platform:*          ║
║  WhatsApp — Global       ║
╚══════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━
📢 *OFFICIAL NOTICE*
━━━━━━━━━━━━━━━━━━━━━━━━━━

CYBER X is *actively maintained* and updated. Users are encouraged to report bugs, suggest features, and contribute ideas to help improve the platform.

Thank you for being part of the *CYBER X* community.

✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦
     𝘾𝙔𝘽𝙀𝙍 𝙓
*Created & Managed by Charles Chucks*
${CREDIT}
✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦ ✦`

    await sock.sendMessage(from, {
      image:    { url: IMG_URL },
      caption,
      mimetype: 'image/jpeg',
    }, { quoted: msg })
  },
}
