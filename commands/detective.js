'use strict'
/**
 * commands/detective.js — CYBER X | 🕵️ Detective
 *
 * Usage:
 *   .detective @user
 *   reply to message + .detective
 *
 * ✅ Fast — reaction + image fire instantly
 * ✅ Your image URL always shown
 * ✅ No network fetch — zero delay
 * ✅ Deterministic — same user = same file every time
 */

const CREDIT = '> © 𝕮𝖄𝕭𝙴𝚁 𝖃 ™'
const IMG_URL = 'https://i.ibb.co/RTY5HnLR/file-000000007a7071f4b7a02e91da447704.png'

function getTarget(msg) {
  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
  if (mentioned.length) return mentioned[0]
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  if (ctx?.participant) return ctx.participant
  if (ctx?.remoteJid?.endsWith('@s.whatsapp.net')) return ctx.remoteJid
  return null
}

function sr(seed, min, max) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  const norm = (Math.abs(h) % 1000) / 1000
  return Math.floor(norm * (max - min + 1)) + min
}

function fakeJoinDate(jid) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${sr(jid+'d',1,28)} ${months[sr(jid+'m',0,11)]} ${sr(jid+'y',2019,2024)}`
}

function fakeMsgCount(jid)   { return sr(jid+'msg', 42, 9999).toLocaleString() }
function fakeWarns(jid)      { return sr(jid+'w', 0, 4) }
function fakeDanger(jid)     { return sr(jid+'danger', 1, 99) }
function fakeSuspicious(jid) { return sr(jid+'sus', 1, 99) }
function fakeLoyalty(jid)    { return sr(jid+'loyal', 1, 99) }
function fakeTrust(jid)      { return sr(jid+'trust', 1, 99) }
function fakeIQ(jid)         { return sr(jid+'iq', 60, 160) }

function fakeNicknames(jid) {
  const pool = [
    'Shadow','Ghost','Viper','Thunder','Blaze','Phantom',
    'Storm','Echo','Cipher','Nova','Raven','Falcon',
    'Wolf','Titan','Glitch','Specter','Cobra','Drift',
    'Reaper','Jinx','Riot','Frenzy','Pulse','Zero',
  ]
  const count = sr(jid+'nc', 1, 3)
  const picks = []
  for (let i = 0; i < count; i++) picks.push(pool[sr(jid+'n'+i, 0, pool.length - 1)])
  return [...new Set(picks)].join(' • ')
}

function fakeActivity(jid) {
  const times = [
    '🌙 Active mostly at *midnight*',
    '☀️ Morning person — *suspicious*',
    '🌆 Evening chatter — *always online*',
    '⏰ Active *24/7* — does this person sleep?',
    '🕐 Random hours — *unpredictable*',
    '🌅 Early bird — *plotting since dawn*',
  ]
  return times[sr(jid+'act', 0, times.length - 1)]
}

function fakePpAnalysis(jid) {
  const results = [
    '😇 Innocent face — *do not trust it*',
    '😈 Suspicious energy detected in pixels',
    '🕵️ Possible undercover agent',
    '🤡 Clown vibes — *highly certified*',
    '💀 Last seen at a *classified location*',
    '👑 Royalty detected — *questionable loyalty*',
    '🔥 High threat level aura confirmed',
    '😴 Too calm — *definitely hiding something*',
    '🧠 Big brain energy — *extremely dangerous*',
    '🐍 Snake emoji would be appropriate',
    '🦅 Free spirit — *impossible to control*',
    '🤫 Knows too much about everyone',
    '🥷 Ninja mode activated',
    '🎭 This is clearly not their real face',
  ]
  return results[sr(jid+'pp', 0, results.length - 1)]
}

function fakeSecret(jid) {
  const secrets = [
    '🤐 *Once sent a voice note by mistake*',
    '👀 *Screenshots chats but denies it*',
    '😂 *Laughs at their own messages*',
    '🕵️ *Reads messages without replying for days*',
    '🎭 *Has 3 different personalities online*',
    '📱 *Online at 3am — we have questions*',
    '🗑️ *Deletes messages hoping nobody saw*',
    '🔇 *Mutes the group but stays to spy*',
    '📸 *Saves everyone\'s profile pictures*',
    '💬 *Types for 10 mins then sends "ok"*',
  ]
  return secrets[sr(jid+'sec', 0, secrets.length - 1)]
}

function fakeVerdict(jid) {
  const v = [
    '🟢 *MOSTLY HARMLESS* — for now',
    '🟡 *SUSPICIOUS* — keep watching closely',
    '🔴 *KNOWN TROUBLEMAKER* — handle with care',
    '🟠 *UNPREDICTABLE* — approach with caution',
    '⚫ *OFF THE GRID* — no further comment',
    '🔵 *DOUBLE AGENT* — trust absolutely nobody',
    '🟣 *CHAOTIC NEUTRAL* — could go either way',
  ]
  return v[sr(jid+'v', 0, v.length - 1)]
}

function bar(pct, len = 10) {
  const f = Math.round((pct / 100) * len)
  return '█'.repeat(f) + '░'.repeat(len - f) + ` *${pct}%*`
}

module.exports = {
  pattern:  'detective',
  desc:     'Pull up a secret file on any user',
  usage:    '.detective @user  OR  reply + .detective',
  category: 'fun',

  run: async ({ sock, from, msg, sender }) => {

    // ── React instantly — fire and forget ─────────────────────────
    sock.sendMessage(from, {
      react: { text: '🕵️', key: msg.key }
    }).catch(() => {})

    const target = getTarget(msg)

    if (!target) {
      return sock.sendMessage(from, {
        image:   { url: IMG_URL },
        caption:
`🕵️ *DETECTIVE MODE*

❌ No target found!
Tag someone or reply to their message:

*.detective @user*

${CREDIT}`,
        mimetype: 'image/jpeg',
      }, { quoted: msg })
    }

    const targetNum = `@${target.split('@')[0]}`
    const byNum     = `@${sender.split('@')[0]}`

    // ── All data generated instantly — zero network ───────────────
    const warns      = fakeWarns(target)
    const warnEmoji  = warns === 0 ? '✅' : warns >= 3 ? '🔴' : '⚠️'

    const caption =
`🕵️‍♂️ *CYBER X DETECTIVE*
╔══════════════════════════╗
║  🗂️ *C L A S S I F I E D*  ║
║   *S E C R E T  F I L E*   ║
╚══════════════════════════╝

🎯 *Target:* ${targetNum}
🔍 *Intel by:* ${byNum}

━━━━ 📋 *BASIC PROFILE* ━━━━━

📅 *Joined:*    ${fakeJoinDate(target)}
💬 *Msgs Sent:* ${fakeMsgCount(target)}
🧠 *IQ Score:*  ${fakeIQ(target)} _(classified)_
🎭 *Aliases:*   ${fakeNicknames(target)}
${warnEmoji} *Warnings:* ${warns}/3

━━━━ ⏰ *ACTIVITY REPORT* ━━━━

${fakeActivity(target)}

━━━━ 📊 *FILE ANALYSIS* ━━━━━

☠️ *Danger Level*
${bar(fakeDanger(target))}

👀 *Suspicious Activity*
${bar(fakeSuspicious(target))}

❤️ *Group Loyalty*
${bar(fakeLoyalty(target))}

🤝 *Trust Score*
${bar(fakeTrust(target))}

━━━━ 🖼️ *PROFILE SCAN* ━━━━━━

${fakePpAnalysis(target)}

━━━━ 🤫 *LEAKED SECRET* ━━━━━

${fakeSecret(target)}

━━━━ ⚖️ *FINAL VERDICT* ━━━━━

${fakeVerdict(target)}

╔══════════════════════════╗
║  🔒 CYBER X Intel Dept.  ║
║  *TOP SECRET — EYES ONLY* ║
╚══════════════════════════╝
${CREDIT}`

    // ── Fire image + caption instantly ────────────────────────────
    await sock.sendMessage(from, {
      image:    { url: IMG_URL },
      caption,
      mimetype: 'image/jpeg',
      mentions: [target, sender],
    }, { quoted: msg })
  },
}

