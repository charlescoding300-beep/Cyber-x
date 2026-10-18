"use strict"
const { pushAllData, restoreAllData } = require("../lib/persist")
module.exports = {
  name: "restore",
  alias: ["backup", "savedata"],
  category: 'owner',
  desc: "Save or restore bot data using the local SQLite database",
  owner: true,
  async run({ sock, m, args }) {
    const jid = m.key.remoteJid
    const action = (args[0] || "restore").toLowerCase()
    if (action === "push" || action === "save" || action === "backup") {
      await sock.sendMessage(jid, { text: "⟳ Saving a local SQLite snapshot..." }, { quoted: m })
      const ok = await pushAllData()
      return sock.sendMessage(jid, { text: ok ? "✅ *BACKUP COMPLETE*\n\nThe bot data snapshot was saved to its SQLite database." : "❌ *BACKUP FAILED*\n\nThe local SQLite snapshot could not be saved." }, { quoted: m })
    }
    await sock.sendMessage(jid, { text: "⟳ Restoring the local SQLite snapshot..." }, { quoted: m })
    const { restored, skipped } = await restoreAllData()
    if (!restored && !skipped) return sock.sendMessage(jid, { text: "⚠️ *NO BACKUP FOUND*\n\nRun *.restore push* first to save a local snapshot." }, { quoted: m })
    return sock.sendMessage(jid, { text: `✅ *RESTORE COMPLETE*\n\n📁 Restored: *${restored}* files\n❌ Failed: *${skipped}*\n\n> Everything restored ✓\n\n_© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦` }, { quoted: m })
  }
}
