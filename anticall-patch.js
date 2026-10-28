'use strict'
const fs = require('fs')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK  = FILE + '.bak-anticall-msg'
const original = fs.readFileSync(FILE, 'utf8')
let src = original

const startMark = "// Notice goes to the bot's OWN chat — never to the caller"
const endMark   = 'sock.ev.on("call", async (calls) => {'

function count(s, f) { let n = 0, i = -1; while ((i = s.indexOf(f, i + 1)) !== -1) n++; return n }
function fail(m) { console.error('✗ ABORTED — ' + m + '\n  index.js was NOT modified.'); process.exit(1) }

if (src.includes('ANTI-CALL ALERT')) { console.log('✔ Already patched.'); process.exit(0) }
if (count(src, startMark) !== 1) fail('start marker: expected 1, found ' + count(src, startMark))
if (count(src, endMark)   !== 1) fail('end marker: expected 1, found ' + count(src, endMark))
const a = src.indexOf(startMark)
const b = src.indexOf(endMark)
if (a >= b) fail('markers out of order')

const block = String.raw`// Anti-call notice — sent to the CALLER's DM (only when the call was really rejected)
  const antiCallNotify = async (callerJid, ok) => {
    try {
      if (!ok) return   // never claim "rejected" if the reject actually failed

      // Banned users never get replies from the bot
      const sessionPhone = normalizeNum(sock.user?.id || "")
      if (await isBannedFast(sessionPhone, normalizeNum(callerJid), callerJid)) return

      const chatJid = antiCallClean(callerJid)
      let shownJid  = chatJid

      // @lid callers: show their real phone-number tag when Baileys knows it
      if (shownJid.endsWith("@lid")) {
        try {
          const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(shownJid)
          if (pn) shownJid = String(pn).includes("@") ? antiCallClean(pn) : pn + "@s.whatsapp.net"
        } catch {}
      }

      const tag = "@" + shownJid.split("@")[0]
      const text =
        "╭━━━〔 📵 ANTI-CALL ALERT 〕━━━╮\n" +
        "┃\n" +
        "┃ ⚠️ Incoming Call Detected\n" +
        "┃\n" +
        "┃ 👤 Caller: " + tag + "\n" +
        "┃ 📞 Action: Call rejected automatically\n" +
        "┃ 🛡️ Protection: Anti-Call is enabled\n" +
        "┃\n" +
        "┃ Sorry, calls are not accepted on this bot.\n" +
        "┃ Please send a text message instead.\n" +
        "┃\n" +
        "╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n" +
        "> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦"

      // Try the caller's own chat first, then the phone-number chat as a fallback
      const targets = [...new Set([chatJid, shownJid])]
      let sent = false
      for (const t of targets) {
        try {
          await sock.sendMessage(t, { text, mentions: [shownJid] })
          sent = true
          break
        } catch (e) {
          console.error("[ANTICALL:" + phone + "] notice to " + t + " failed:", e.message)
        }
      }
      if (!sent) console.error("[ANTICALL:" + phone + "] caller notice could not be delivered")
    } catch (e) {
      console.error("[ANTICALL:" + phone + "] notify failed:", e.message)
    }
  }

  `
src = src.slice(0, a) + block + src.slice(b)

fs.writeFileSync(BAK, original)
fs.writeFileSync(FILE, src)
try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' })
  console.log('✔ Anti-call notice updated. Syntax check passed.')
  console.log('✔ Backup: ' + BAK + '  — restart the bot now.')
} catch (e) {
  fs.writeFileSync(FILE, original)
  console.error('✗ Syntax check failed — original restored.\n' + String(e.stderr || e.message))
  process.exit(1)
}
