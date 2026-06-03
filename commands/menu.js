const os = require("os")
const fs = require("fs")
const path = require("path")

module.exports = {
  pattern: ".menu",

  run: async ({ sock, from, msg, sender, commands }) => {

    const tag = sender.split("@")[0]

    // ───────── SYSTEM INFO ─────────
    const getDate = () => new Date().toDateString()

    const getUptime = () => {
      const u = process.uptime()
      return `${Math.floor(u / 60)}m ${Math.floor(u % 60)}s`
    }

    const getRam = () => {
      const used = process.memoryUsage().rss / 1024 / 1024
      const total = os.totalmem() / 1024 / 1024
      return `${used.toFixed(2)}MB / ${total.toFixed(0)}MB`
    }

    // ───────── LOCAL COMMANDS ─────────
    const cmdPath = path.join(process.cwd(), "commands")

    let files = []
    try {
      files = fs.readdirSync(cmdPath)
    } catch {}

    const localCmds = files
      .filter(f => f.endsWith(".js"))
      .map(f => `.${f.replace(".js", "")}`)

    // ───────── GLOBAL COMMANDS ─────────
    const globalCmds = Array.from(commands.keys())
      .map(c => c.startsWith(".") ? c : `.${c}`)

    // ───────── MERGE + REMOVE DUPLICATES ─────────
    const allCmds = [...new Set([...localCmds, ...globalCmds])].sort()

    // ───────── BOLD MENU TEXT ─────────
    let text =
`╭━━━━━━━━━━━━━━━╮
┃ *🤖 𝘾𝙔𝘽𝙀𝙍 𝙓 MENU*
╰━━━━━━━━━━━━━━━╯

👤 *User:* @${tag}
📅 *Date:* ${getDate()}
⏱ *Uptime:* ${getUptime()}
💾 *RAM:* ${getRam()}
📦 *Total Commands:* ${allCmds.length}

╭──〔 *COMMANDS* 〕──╮
`

    for (const c of allCmds) {
      text += `┃ ◦ *${c}*\n`
    }

    text += `
╰━━━━━━━━━━━━━━━╯

> © *𝕮𝖄𝕭𝙴𝚁 𝖃*
`

    await sock.sendMessage(from, {
      text,
      mentions: [sender]
    }, { quoted: msg })
  }
}
