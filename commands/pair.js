'use strict'

module.exports = {
  pattern: 'pair',
  desc: 'Shows how to deploy your own CYBER X bot',
  category: 'general',

  run: async ({ sock, from, msg }) => {
    // React with 🖕🏻
    await sock.sendMessage(from, {
      react: { text: '🖕🏻', key: msg.key }
    })

    const imageUrl = 'https://i.ibb.co/spf35QYC/file-00000000a30c71f48bb49e183e1d43cb.png'

    const text = `🤣🤣🤣😩😩 *You can't pair me directly*
*This is what you should do* 👇🏻 *Only the lengend can get.

╔═══════════════════════════╗
║   𝕮𝖄𝕭𝙴𝚁 𝖃 ™ — DEPLOY GUIDE   ║
╚═══════════════════════════╝

Hey! So you want your *own* CYBER X bot? 
Let me explain this like you're 5 years old 😄

Think of CYBER X like a *robot friend* living on the internet.
Right now you're talking to *my* robot.
But you can have *your very own* — on *your* WhatsApp number!

Here's how 👇🏻

━━━━━━━━━━━━━━━━━━━
🧰 *WHAT YOU NEED FIRST*
━━━━━━━━━━━━━━━━━━━

Before anything, make sure you have these 3 things:

✅ Your own *WhatsApp number*
✅ A free account on 👉 *github.com*
✅ A free account on 👉 *render.com*

Both GitHub and Render are totally free to sign up.
Think of GitHub as a place where the bot's "brain" is stored,
and Render as the place where the brain "wakes up" and runs.

━━━━━━━━━━━━━━━━━━━
🍴 *STEP 1 — COPY THE BOT*
━━━━━━━━━━━━━━━━━━━

1. Go to the CYBER X GitHub page 👇🏻

👇🏻👇🏻👇🏻👇🏻👇🏻👇🏻👇🏻👇🏻👇🏻👇🏻
╔══════════════════════════════════════╗
║ 🖥️  👆🏻👆🏻 *OFFICIAL CYBER X REPO* 👆🏻👆🏻 🖥️  ║
║                                      ║
║  🔗 github.com/charlescoding300-beep  ║
║           */Cyber-x* 🔗              ║
║                                      ║
║  🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟  ║
║   This is where the magic lives 🪄   ║
║  🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟⭐🌟  ║
╚══════════════════════════════════════╝
☝🏻☝🏻☝🏻☝🏻☝🏻☝🏻☝🏻☝🏻☝🏻☝🏻

2. You'll see a button at the top right that says *Fork*
3. Click it!

That's it. You just made your own copy of the bot 🎉
Think of it like photocopying a recipe so you can cook it yourself.

━━━━━━━━━━━━━━━━━━━
🌐 *STEP 2 — SET UP RENDER*
━━━━━━━━━━━━━━━━━━━

Now go to *render.com* and log in.

1. Click *New → Web Service*
2. Connect your GitHub account when it asks
3. Find and select your *Cyber-x* copy
4. Fill in these boxes exactly like this:

┌─────────────────────────────┐
│ Name        → cyber-x       │
│ Runtime     → Node          │
│ Build Cmd   → npm install   │
│ Start Cmd   → node index.js │
│ Type        → Free          │
└─────────────────────────────┘

━━━━━━━━━━━━━━━━━━━
🔑 *STEP 3 — ENTER YOUR INFO*
━━━━━━━━━━━━━━━━━━━

Still on Render, click the *Environment* tab.
Add these 4 things (called "environment variables"):

┌──────────────────┬──────────────────────────┐
│ PAIRING_NUMBER   │ Your number (e.g.         │
│                  │ 2348012345678)            │
│                  │ No + or spaces or dashes! │
├──────────────────┼──────────────────────────┤
│ BOT_NAME         │ Whatever you want 😄      │
├──────────────────┼──────────────────────────┤
│ PREFIX           │ . (just a dot)            │
├──────────────────┼──────────────────────────┤
│ OWNER_NUMBER     │ Same as your number above │
└──────────────────┴──────────────────────────┘

━━━━━━━━━━━━━━━━━━━
🚀 *STEP 4 — LAUNCH & CONNECT*
━━━━━━━━━━━━━━━━━━━

1. Click *Deploy*
2. Wait a minute or two for it to build
3. Click on *Logs* — you'll see something like this:

╔══════════════════════════╗
║  WHATSAPP PAIRING CODE   ║
║  👉  ABCD-WXYZ           ║
╚══════════════════════════╝

4. Now on your WhatsApp:
   → Go to *Settings*
   → Tap *Linked Devices*
   → Tap *Link a Device*
   → Tap *"Link with phone number instead"*
   → Type in the code from the logs

Done! Your bot is now *LIVE* 🟢✅

━━━━━━━━━━━━━━━━━━━
💤 *WILL IT STAY ONLINE?*
━━━━━━━━━━━━━━━━━━━

Yes! CYBER X has a built-in auto-ping 
that taps itself every *4 minutes* so it 
never goes to sleep on the free plan 😴❌

If it still sleeps, add this to your environment:

┌─────────────────────┬────────────────────────┐
│ RENDER_EXTERNAL_URL │ your Render service URL │
└─────────────────────┴────────────────────────┘

━━━━━━━━━━━━━━━━━━━
⚠️ *VERY IMPORTANT*
━━━━━━━━━━━━━━━━━━━

🔴 Use *your own* WhatsApp number
🔴 Never share your *session/* folder — 
   it's like your password
🔴 Don't use the bot to spam people
   (WhatsApp will ban your number)

━━━━━━━━━━━━━━━━━━━
📁 *WHAT'S INSIDE THE BOT?*
━━━━━━━━━━━━━━━━━━━

Cyber-x/
├── index.js     ← The brain (don't touch!)
├── commands/    ← All bot commands live here
├── lib/         ← Helper tools
├── session/     ← Your login info (auto-made)
└── .env         ← Settings (use Render dashboard)

━━━━━━━━━━━━━━━━━━━
➕ *ADDING YOUR OWN COMMANDS*
━━━━━━━━━━━━━━━━━━━

Want to teach your bot new tricks?
Just create a new file in the *commands/* folder:

\`\`\`js
module.exports = {
  pattern: 'hello',
  desc: 'Say hello',
  category: 'general',
  run: async ({ sock, from, msg }) => {
    await sock.sendMessage(from, {
      text: 'Hello from CYBER X! 👋'
    }, { quoted: msg })
  },
}
\`\`\`

Push it to GitHub → Render redeploys → Done! 🎉

━━━━━━━━━━━━━━━━━━━
❓ *SOMETHING WRONG?*
━━━━━━━━━━━━━━━━━━━

*Bot not connecting?*
→ Make sure your number has no +, spaces or dashes
→ Delete the session/ folder and redeploy

*Commands not working?*
→ Double-check PREFIX and OWNER_NUMBER

*Bot going offline?*
→ Add RENDER_EXTERNAL_URL to your env vars
*If you having problems deploying the bot. DM
>>> 234 812 038 2097, 234 811 775 0075.
╔═══════════════════════════╗
║  Bot    : CYBER X ™       ║
║  By     : Charles Chucks  ║
║  © All rights reserved    ║
╚═══════════════════════════╝`

    await sock.sendMessage(from, {
      image: { url: imageUrl },
      caption: text
    }, { quoted: msg })
  }
}
