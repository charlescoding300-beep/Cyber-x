const os = require("os")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

module.exports = {
  pattern: ".menu",

  run: async ({ sock, from, msg, sender, commands }) => {

    const tag = sender.split("@")[0]

    // ───────── SYSTEM INFO ─────────
    const getDate = () => new Date().toDateString()

    const getTime = () =>
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      })

    const getUptime = () => {
      const u = process.uptime()
      const h = Math.floor(u / 3600)
      const m = Math.floor((u % 3600) / 60)
      const s = Math.floor(u % 60)
      return `${h}h ${m}m ${s}s`
    }

    const getRam = () => {
      const used = process.memoryUsage().rss / 1024 / 1024
      const total = os.totalmem() / 1024 / 1024
      return `${used.toFixed(2)}MB / ${total.toFixed(0)}MB`
    }

    const getCpu = () => {
      const cpus = os.cpus()
      return cpus[0].model.split(" ").slice(0, 3).join(" ")
    }

    const getPlatform = () =>
      `${os.type()} ${os.arch()}`

    // ───────── COMMAND LIST ─────────
    const cmdPath = path.join(process.cwd(), "commands")

    let files = []
    try {
      files = fs.readdirSync(cmdPath)
    } catch {}

    const localCmds = files
      .filter(f => f.endsWith(".js"))
      .map(f => `.${f.replace(".js", "")}`)

    const globalCmds = Array.from(commands.keys()).map(c =>
      c.startsWith(".") ? c : `.${c}`
    )

    const allCmds = [...new Set([...localCmds, ...globalCmds])].sort()

    // ───────── MENU TEXT ─────────
    let text =
`╔════════════════════╗
║  🤖 *𝘾𝙔𝘽𝙀𝙍 𝙓 BOT*  ║
╚════════════════════╝

┌─────〔 👤 *USER INFO* 〕─────
│ 👤 *User:* @${tag}
│ 📅 *Date:* ${getDate()}
│ 🕐 *Time:* ${getTime()}
└──────────────────────────

┌─────〔 🖥️ *BOT STATUS* 〕─────
│ ⏱️ *Uptime:* ${getUptime()}
│ 💾 *RAM:* ${getRam()}
│ 🖥️ *CPU:* ${getCpu()}
│ 🌐 *Platform:* ${getPlatform()}
│ 📦 *Total Cmds:* ${allCmds.length}
└──────────────────────────

╔════〔 ⚡ *𝘾𝙔𝘽𝙀𝙍 𝙓 COMMANDS* 〕════╗
`

    for (const c of allCmds) {
      text += `║  ◈ *${c}*\n`
    }

    text +=
`\n╚══════════════════════╝
❏ *𝘾𝙔𝘽𝙀𝙍 𝙓* — Always Online 24/7
❏ Powered by *Charles Tech*
> © 𝕮𝖄𝖡𝙴𝚁 𝖃 ™`

    // ───────── FAST IMAGE (FIXED) ─────────
    const imgUrl = "https://files.catbox.moe/ncpwqt.jpg"

    let imageBuffer
    try {
      const res = await axios.get(imgUrl, {
        responseType: "arraybuffer",
        timeout: 10000
      })
      imageBuffer = Buffer.from(res.data)
    } catch (e) {
      imageBuffer = null
    }

    // ───────── SEND MENU ─────────
    if (imageBuffer) {
      await sock.sendMessage(from, {
        image: imageBuffer,
        caption: text,
        mentions: [sender]
      }, { quoted: msg })
    } else {
      await sock.sendMessage(from, {
        text: text,
        mentions: [sender]
      }, { quoted: msg })
    }
  }
}
