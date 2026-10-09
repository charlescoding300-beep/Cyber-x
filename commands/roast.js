const fs = require("fs")
const path = require("path")

const ROASTS = [
  "Bro entered the chat with 2% battery and 0% brain.",
  "You talk with so much confidence for someone who's always wrong.",
  "Your Wi-Fi has more connection than your personality.",
  "Bro's biggest achievement is surviving his own decisions.",
  "You don't need a comeback. You need a software update.",
  "Even autocorrect gave up trying to understand you.",
  "Your brain is running on trial mode.",
  "Bro has premium confidence with free-trial intelligence.",
  "You bring absolutely nothing to the conversation except notifications.",
  "Your typing speed is faster than your thinking.",
  "If nonsense was currency, you'd be a billionaire.",
  "Bro really woke up and chose confusion.",
  "You're not the main character. You're background buffering.",
  "Your jokes need a restart.",
  "I've seen loading screens with more personality.",
  "Your logic left the group chat without saying goodbye.",
  "Bro's brain has 47 tabs open and none of them are responding.",
  "You're proof that confidence doesn't require evidence.",
  "Even Google would ask what you're searching for.",
  "Your comeback has been stuck on 'connecting…' since 2020.",
  "Bro has unlimited audacity and zero storage.",
  "You argue like your keyboard is your lawyer.",
  "Your personality is basically a system error.",
  "You have the energy of a phone at 1% pretending it can last all day.",
  "Bro is built different. Unfortunately, the difference is a bug.",
  "Your brain needs better network coverage.",
  "You're not cooked. You're still waiting for the oven to preheat.",
  "Your ideas need parental supervision.",
  "Bro speaks fluent nonsense.",
  "You have more excuses than actual achievements.",
  "Your confidence is doing all the heavy lifting.",
  "Even your shadow tries to distance itself from you.",
  "You're the reason group chats need an admin.",
  "Your personality has been discontinued.",
  "Bro's IQ is currently under maintenance.",
  "You bring chaos to places that already have enough.",
  "Your logic is sponsored by bad decisions.",
  "You are the human version of 'try again later'.",
  "Bro has main-character confidence with NPC dialogue.",
  "Your brain needs a firmware update.",
  "You're not difficult to understand. You're just difficult to justify.",
  "Your argument came with no supporting documents.",
  "Bro has been buffering since birth.",
  "You're proof that copy and paste doesn't always work.",
  "Your brain and common sense are in a long-distance relationship.",
  "Even your excuses need excuses.",
  "You don't lose arguments. You simply abandon them.",
  "Your comeback arrived after everyone went home.",
  "Bro is running Zen X on demo intelligence.",
  "Your confidence has better uptime than your reasoning.",
  "You have the processing power of a calculator with low batteries.",
  "Your thoughts need a moderator.",
  "Bro's personality is still loading.",
  "You could make a simple question complicated professionally.",
  "Your common sense has left the server.",
  "You're not roasting anyone. You're just providing examples.",
  "Bro came online but his brain stayed offline.",
  "Your decisions deserve their own warning label.",
  "You have the rare talent of making silence sound intelligent.",
  "Your brain has an excellent spam filter because it blocks common sense.",
  "You're basically an unanswered notification.",
  "Bro is the reason 'Are you sure?' exists.",
  "Your logic needs a VPN to reach reality.",
  "You talk like every thought is breaking news.",
  "Your brain is on airplane mode.",
  "You have more confidence than available evidence.",
  "Bro's personality has too many unnecessary features.",
  "You're not a problem solver. You're a problem generator.",
  "Your brain has unlimited data but no signal.",
  "You make bad decisions look like a subscription service.",
  "Even your own reflection needs a mute button.",
  "Bro is running an outdated version of common sense.",
  "Your arguments come with zero warranty.",
  "You are the notification nobody asked for.",
  "Your brain needs a reboot before another sentence.",
  "Bro's thought process took a wrong turn and never came back.",
  "You're giving 'terms and conditions nobody read'.",
  "Your presence has more bugs than features.",
  "Bro, even your excuses are tired of you.",
  "Your brain has been disconnected from the server.",
  "You're not mysterious. Nobody understands what you're doing.",
  "Your personality needs an admin panel.",
  "Bro's logic is currently unavailable.",
  "You have successfully turned confidence into a bug.",
  "Your brain is running background processes nobody requested.",
  "Even silence would be a better contribution.",
  "Bro, your comeback needs an emergency update.",
  "You are proof that unlimited data doesn't mean unlimited intelligence.",
  "Your decisions have a higher error rate than a broken keyboard.",
  "Your brain has a permanent '404 Not Found'.",
  "Bro, you're not lagging. That's just your normal speed.",
  "Your personality came with the wrong installation package.",
  "You make confusion look like a lifestyle.",
  "Your common sense subscription expired.",
  "Bro's brain has entered safe mode.",
  "You're the reason developers add confirmation dialogs.",
  "Your thoughts need a queue manager.",
  "Bro is professionally unserious.",
  "You have the confidence of someone who never checks their own messages.",
  "Your brain is connected, but nobody is home."
]

const OPENERS = [
  "🔥 ZEN X has entered roast mode.",
  "⚡ ZEN X roast engine activated.",
  "💀 Target acquired. Let the roasting begin.",
  "🔥 The roast department is officially open.",
  "⚡ ZEN X is processing disrespect...",
  "💀 Warning: emotional damage incoming.",
  "🔥 Roast protocol initialized.",
  "⚡ Calculating maximum embarrassment...",
  "💀 Somebody forgot to install common sense.",
  "🔥 ZEN X has something to say."
]

const CLOSERS = [
  "💀 That's enough damage for one message.",
  "🔥 No refunds on that roast.",
  "⚡ ZEN X verdict: absolutely cooked.",
  "💀 Please reboot your confidence.",
  "🔥 Case closed. The roast has landed.",
  "⚡ System report: target successfully roasted.",
  "💀 Common sense.exe has stopped responding.",
  "🔥 Somebody check on bro.",
  "⚡ Damage calculation complete.",
  "💀 The chat has witnessed enough."
]

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function cleanJid(jid) {
  if (!jid) return ""
  return String(jid).split(":")[0]
}

function getPhoneFromJid(jid) {
  return cleanJid(jid).split("@")[0]
}

function getQuotedParticipant(message) {
  return (
    message?.message?.extendedTextMessage?.contextInfo?.participant ||
    message?.message?.imageMessage?.contextInfo?.participant ||
    message?.message?.videoMessage?.contextInfo?.participant ||
    message?.message?.documentMessage?.contextInfo?.participant ||
    message?.message?.stickerMessage?.contextInfo?.participant ||
    null
  )
}

function getMentionedParticipant(message) {
  const context =
    message?.message?.extendedTextMessage?.contextInfo ||
    message?.message?.imageMessage?.contextInfo ||
    message?.message?.videoMessage?.contextInfo ||
    message?.message?.documentMessage?.contextInfo ||
    message?.message?.stickerMessage?.contextInfo

  return context?.mentionedJid?.[0] || null
}

function getTarget(message, args = []) {
  const quoted = getQuotedParticipant(message)
  if (quoted) return quoted

  const mentioned = getMentionedParticipant(message)
  if (mentioned) return mentioned

  if (args.length) {
    const joined = args.join(" ").trim()

    const number = joined.replace(/[^\d]/g, "")
    if (number.length >= 7) {
      return `${number}@s.whatsapp.net`
    }
  }

  return message?.key?.participant || message?.participant || message?.key?.remoteJid
}

function getTargetName(message, targetJid, args = []) {
  const pushName =
    message?.pushName ||
    message?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.pushName ||
    ""

  if (args.length && !getMentionedParticipant(message) && !getQuotedParticipant(message)) {
    const supplied = args.join(" ").trim()
    if (supplied && !/^\d+$/.test(supplied)) return supplied
  }

  if (pushName) return pushName

  return getPhoneFromJid(targetJid) || "this person"
}

async function roastCommand(sock, message, args = {}) {
  const argv = Array.isArray(args)
    ? args
    : Array.isArray(args?.args)
      ? args.args
      : []

  const targetJid = getTarget(message, argv)
  const targetName = getTargetName(message, targetJid, argv)

  const roast = pickRandom(ROASTS)
    .replace(/\{name\}/gi, targetName)
    .replace(/\{mention\}/gi, `@${getPhoneFromJid(targetJid)}`)

  const opener = pickRandom(OPENERS)
  const closer = pickRandom(CLOSERS)

  const text = [
    opener,
    "",
    `🎯 *Target:* @${getPhoneFromJid(targetJid)}`,
    "",
    `🔥 *ZEN X ROAST:*`,
    roast,
    "",
    closer
  ].join("\n")

  const options = {
    mentions: targetJid ? [targetJid] : []
  }

  if (message?.key) {
    options.quoted = message
  }

  await sock.sendMessage(
    message.key.remoteJid,
    { text, ...options }
  )
}

module.exports = {
  name: "roast",
  aliases: ["burn", "clap", "deadass"],
  description: "Roast a user with the new ZEN X roast engine.",
  category: "fun",
  execute: roastCommand,
  run: roastCommand
}
