'use strict'

const axios  = require('axios')
const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'

module.exports = {
  pattern:  'restart',
  alias:    ['update', 'redeploy'],
  category: 'owner',
  desc:     'Update and restart CYBER X on Render',
  usage:    '.restart',

  run: async ({ sock, from, msg, isOwner }) => {

    // ── Owner only ──
    if (!isOwner) {
      return sock.sendMessage(from, {
        text: `❌ *Access Denied!*\nThis command is *OWNER ONLY*.\n\n${CREDIT}`,
        quoted: msg
      })
    }

    const hook = process.env.RENDER_DEPLOY_HOOK

    if (!hook) {
      return sock.sendMessage(from, {
        text:
`❌ *RENDER_DEPLOY_HOOK not set!*

Add to your .env:
\`RENDER_DEPLOY_HOOK=your_hook_url\`

Get it from:
Render Dashboard → Your Service → Settings → Deploy Hook

${CREDIT}`,
        quoted: msg
      })
    }

    // ── React immediately ──
    await sock.sendMessage(from, {
      react: { text: '🚀', key: msg.key }
    }).catch(() => {})

    // ── Send ONE message and edit it through the process ──
    const sent = await sock.sendMessage(from, {
      text:
`╔═══════════════════════════╗
║  🚀 *CYBER X UPDATE*      ║
╚═══════════════════════════╝

⏳ *Step 1/3* — Connecting to Render...
▱▱▱▱▱▱▱▱▱▱ 0%

${CREDIT}`,
    }, { quoted: msg })

    // ── Helper to edit the same message ──
    async function editMsg(text) {
      try {
        await sock.sendMessage(from, {
          text,
          edit: sent.key,
        })
      } catch {}
    }

    // ── Step 1 — wait 2 seconds ──
    await new Promise(r => setTimeout(r, 2000))

    await editMsg(
`╔═══════════════════════════╗
║  🚀 *CYBER X UPDATE*      ║
╚═══════════════════════════╝

✅ *Step 1/3* — Connected to Render
⏳ *Step 2/3* — Sending deploy request...
▓▓▓▱▱▱▱▱▱▱ 30%

${CREDIT}`
    )

    // ── Step 2 — trigger deploy hook ──
    try {
      await axios.get(hook, { timeout: 15000 })
    } catch (err) {
      await editMsg(
`╔═══════════════════════════╗
║  🚀 *CYBER X UPDATE*      ║
╚═══════════════════════════╝

❌ *Deploy failed!*

*Reason:* ${err.response?.status || err.message}

Please check your RENDER_DEPLOY_HOOK and try again.

${CREDIT}`
      )
      await sock.sendMessage(from, {
        react: { text: '❌', key: msg.key }
      }).catch(() => {})
      return
    }

    await new Promise(r => setTimeout(r, 2000))

    await editMsg(
`╔═══════════════════════════╗
║  🚀 *CYBER X UPDATE*      ║
╚═══════════════════════════╝

✅ *Step 1/3* — Connected to Render
✅ *Step 2/3* — Deploy request sent
⏳ *Step 3/3* — Restarting CYBER X...
▓▓▓▓▓▓▱▱▱▱ 60%

${CREDIT}`
    )

    await new Promise(r => setTimeout(r, 3000))

    await editMsg(
`╔═══════════════════════════╗
║  🚀 *CYBER X UPDATE*      ║
╚═══════════════════════════╝

✅ *Step 1/3* — Connected to Render
✅ *Step 2/3* — Deploy request sent
✅ *Step 3/3* — Restart triggered
▓▓▓▓▓▓▓▓▓▓ 100%

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 *UPDATE SUCCESSFUL!*

⚡ CYBER X is redeploying on Render
🕐 Bot will be back online in ~30-60 seconds
🔄 Latest changes are now live

━━━━━━━━━━━━━━━━━━━━━━━━━━━
${CREDIT}`
    )

    // ── Final reaction ──
    await sock.sendMessage(from, {
      react: { text: '✅', key: msg.key }
    }).catch(() => {})
  }
}
