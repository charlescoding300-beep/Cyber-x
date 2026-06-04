const os = require("os")
const fs = require("fs")
const path = require("path")
const fetch = require("node-fetch")

module.exports = {
  pattern: ".menu",

  run: async ({ sock, from, msg, sender, commands }) => {

    const tag = sender.split("@")[0]

    // ───────── SYSTEM INFO ─────────
    const getDate = () => new Date().toDateString()

    const getTime = () => new Date().toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: true
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

    const getPlatform = () => {
      return `${os.type()} ${os.arch()}`
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

    // ───────── BUILD FANCY MENU ─────────
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

╔════〔 ⚡ *COMMANDS* 〕════╗
`

    for (const c of allCmds) {
      text += `║  ◈ *${c}*\n`
    }

    text +=
`╚══════════════════════╝

❏ *𝘾𝙔𝘽𝙀𝙍 𝙓* — Always Online 24/7
❏ Powered by *Charles Tech*
❏ Type any command to get started!

▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™* | All Rights Reserved
▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰`

    // ───────── LOAD MENU IMAGE FROM CATBOX ─────────
    const imgUrl = "https://files.catbox.moe/ncpwqt.jpg"
    const imgRes = await fetch(imgUrl)
    const image = Buffer.from(await imgRes.arrayBuffer())

    // ───────── SEND IMAGE + MENU AS CAPTION ─────────
    await sock.sendMessage(from, {
      image,
      caption: text,
      mentions: [sender]
    }, { quoted: msg })

    // ───────── FETCH & SEND USER PROFILE PHOTO ─────────
    try {
      const ppUrl = await sock.profilePictureUrl(sender, "image")
      const ppRes = await fetch(ppUrl)
      const ppImage = Buffer.from(await ppRes.arrayBuffer())

      await sock.sendMessage(from, {
        image: ppImage,
        caption:
`┌─────〔 📸 *PROFILE* 〕─────
│ 👤 *User:* @${tag}
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      }, { quoted: msg })

    } catch {
      await sock.sendMessage(from, {
        text:
`┌─────〔 📸 *PROFILE* 〕─────
│ ⚠️ @${tag} has no profile photo
└──────────────────────────
> © *𝕮𝖄𝕭𝙴𝚁 𝖃 ™*`,
        mentions: [sender]
      }, { quoted: msg })
    }

  }
}
