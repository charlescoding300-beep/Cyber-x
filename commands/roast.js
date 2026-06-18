// ─────────────────────────────────────────────────────────────────────────────
// commands/roast.js  —  CYBER X  |  Roast Machine (Deadly Edition)
//
// USAGE:
//   .roast              → roast the sender
//   Reply to someone → .roast  → auto-tags that person
//   .roast @mention     → roast a tagged person
//   .roast John         → roast by name
// ─────────────────────────────────────────────────────────────────────────────

const ROASTS = [
  "Your birth certificate is an apology letter from the condom factory.",
  "You're the reason your parents regret not practicing safe sex.",
  "I've seen better faces on a wanted poster.",
  "You're not ugly — you're just aesthetically challenging to everyone around you.",
  "Your IQ is so low, Google Maps can't even find it.",
  "You're like a Monday — nobody wants you, everybody dreads you, and you ruin everything.",
  "If stupidity was a currency, you'd be the richest corpse in the graveyard.",
  "You're the human equivalent of a participation trophy nobody asked for.",
  "I'd roast you harder but my mom said I'm not allowed to burn actual garbage.",
  "You have the personality of a wet sock left in the sun for three days.",
  "Even your shadow leaves you when you walk into the light.",
  "You're like a software virus — you slow everything down and nobody asked you to show up.",
  "Your parents looked at you and told God they understood Thanos.",
  "You're living proof that evolution has a glitch.",
  "The only thing worse than your face is your personality, and somehow both keep getting worse.",
  "You're so useless that if you disappeared tomorrow, people would only notice the WiFi got faster.",
  "Your life is like a broken pencil — absolutely pointless.",
  "You have the emotional depth of a puddle on a hot day.",
  "If brains were taxed, you'd get a refund every year.",
  "You're not the dumbest person in the world but you better pray they don't die.",
  "You're the reason instructions exist on shampoo bottles.",
  "I'd tell you to go to hell, but I don't want Satan to suffer like that.",
  "You're the type of person that would microwave fish in the office and think it's fine.",
  "You bring so much joy to people — specifically when you leave the room.",
  "Your mind is like concrete — thoroughly mixed and permanently set.",
  "You're so irrelevant even your WiFi drops you.",
  "If I had a dollar for every brain cell you have, I'd be broke.",
  "Looking at you makes me grateful mirrors have feelings and walls don't talk.",
  "You're like a cloud — the whole day gets better when you disappear.",
  "You remind me of a penny — two-faced, worthless, and always trying to fit in.",
  "Your existence is the universe's way of testing people's patience.",
  "You're the type to Google your own name and get zero results.",
  "If your life was a movie, it would be rated D for Disappointing.",
  "You're not a mistake — you're a cautionary tale.",
  "You make onions cry.",
  "You're so forgettable, your own alarm clock hits snooze on you.",
  "Even your dog unfollows you in real life.",
  "You're like a flat tyre — completely useless and nobody wants to deal with you.",
  "Your parents took one look at you and named you after their disappointment.",
  "You're proof that God has a sense of humour and sometimes it's dark.",
]

// ── Opening lines that tag the person ────────────────────────────────────────
const OPENERS = [
  "Oi {name} 👀 since you wanna exist today—",
  "Alright {name}, hold still. This won't hurt. Actually it will—",
  "{name} bestie I say this with ZERO love—",
  "Listen {name}, someone had to tell you—",
  "Bro {name} I'm doing this for your own good—",
  "Okay {name} the group voted and I was chosen—",
  "ATTENTION {name}: your daily dose of reality—",
  "{name} God himself sent me to deliver this message—",
  "Yo {name} we need to talk. The whole group agreed—",
  "{name} take a seat. Actually stand, you won't be here long—",
]

// ── Closing lines ─────────────────────────────────────────────────────────────
const CLOSERS = [
  "💀 *CYBER X has spoken. Seek help.*",
  "🔥 *Get well soon bestie. Emotionally.*",
  "😭 *Roasted, toasted and served cold. CYBER X style.*",
  "💀 *I don't make the rules. I just enforce them.*",
  "🖤 *This has been a CYBER X public service announcement.*",
  "🔥 *Take that personally. You were meant to.*",
  "😤 *CYBER X Roast Machine — no survivors.*",
  "💀 *Therapy is available. I suggest you book immediately.*",
  "🥀 *Goodnight. Drink water. Reconsider your life choices.*",
  "😈 *Powered by CYBER X. Devastation guaranteed.*",
]

function random(arr) { return arr[Math.floor(Math.random() * arr.length)] }

module.exports = {
  pattern:  "roast",
  alias:    ["burn", "clap", "deadass"],
  desc:     "Roast someone with deadly precision 🔥",
  usage:    ".roast | reply to someone → .roast | .roast @mention",
  category: "fun",

  async run({ sock, from, msg, args, sender }) {

    const roast   = random(ROASTS)
    const closer  = random(CLOSERS)

    let targetJid  = null
    let targetName = null
    let mentions   = []

    // ── Priority 1: Reply to a message → roast whoever sent it ───────────────
    const ctx = msg.message?.extendedTextMessage?.contextInfo
    if (ctx?.participant) {
      targetJid  = ctx.participant
      targetName = "@" + ctx.participant.split("@")[0]
      mentions   = [ctx.participant]
    }

    // ── Priority 2: @mention in the command ──────────────────────────────────
    else if (ctx?.mentionedJid?.length > 0) {
      targetJid  = ctx.mentionedJid[0]
      targetName = "@" + ctx.mentionedJid[0].split("@")[0]
      mentions   = [ctx.mentionedJid[0]]
    }

    // ── Priority 3: Name typed as arg ─────────────────────────────────────────
    else if (args.length > 0) {
      targetName = args.join(" ")
    }

    // ── Priority 4: Roast the sender themselves ───────────────────────────────
    else {
      targetJid  = sender
      targetName = "@" + sender.split("@")[0]
      mentions   = [sender]
    }

    const opener = random(OPENERS).replace(/\{name\}/g, targetName)

    const text =
      `🔥💀 *CYBER X ROAST MACHINE* 💀🔥\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${opener}\n\n` +
      `❝ _${roast}_ ❞\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${closer}`

    await sock.sendMessage(from, {
      text,
      mentions,
    }, { quoted: msg })
  },
}
