"use strict"
const { pushAllData, restoreAllData } = require("../lib/persist")
module.exports = {
  name: "restore",
  alias: ["backup", "savedata"],
  category: "owner",
  desc: "Restore or backup all bot data from Redis",
  owner: true,
  async run({ sock, m, args }) {
    const jid = m.key.remoteJid
    const action = (args[0] || "restore").toLowerCase()
    if (action === "push" || action === "save" || action === "backup") {
      await sock.sendMessage(jid, { text: "⟳ Pushing all data to Redis..." }, { quoted: m })
      const ok = await pushAllData()
      return sock.sendMessage(jid, { text: ok ? "✅ *BACKUP COMPLETE*\n\nAll data pushed to Redis!\n\n> antilink • antistatus • welcome • coins • cards • everything ✓" : "❌ *BACKUP FAILED*\n\nCheck Redis env vars." }, { quoted: m })
    }
    await sock.sendMessage(jid, { text: "⟳ Restoring all data from Redis..." }, { quoted: m })
    const { restored, skipped } = await restoreAllData()
    if (!restored && !skipped) return sock.sendMessage(jid, { text: "⚠️ *NO BACKUP FOUND*\n\nRun *.restore push* first to create a backup." }, { quoted: m })
    return sock.sendMessage(jid, { text: `✅ *RESTORE COMPLETE*\n\n📁 Restored: *${restored}* files\n❌ Failed: *${skipped}*\n\n> Everything restored ✓\n\n_© 𝕮𝖄𝕭𝙀𝙍 𝖃 ™_` }, { quoted: m })
  }
}
