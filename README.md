# 𝕮𝖄𝕭𝙴𝚁 𝖃 ™
> Advanced WhatsApp Bot — Created & Managed by Charles Chucks

![CYBER X](https://i.ibb.co/spf35QYC/file-00000000a30c71f48bb49e183e1d43cb.png)

---

## ✨ Features

- 🛡️ Group Management & Moderation
- 🤖 AI Assistance
- 🎵 Media Download Tools
- 🔒 Security & Anti-Spam Systems
- 🎮 Games & Entertainment
- 🔧 Utility Commands
- ⚙️ Custom Automation Systems

---

## 🚀 Deploy Your Own CYBER X

Everyone can run their own private copy of CYBER X on their own WhatsApp number.  
You do **not** share accounts — each person pairs their own number.

---

## 📋 Requirements

- A WhatsApp number (your own)
- A free [Render](https://render.com) account
- A free [GitHub](https://github.com) account

---

## 🛠️ Step-by-Step Deployment

### Step 1 — Fork the Repository

1. Go to the CYBER X GitHub repo
2. Click **Fork** (top right)
3. This creates your own copy of the bot

---

### Step 2 — Set Up Render

1. Go to [render.com](https://render.com) and sign up free
2. Click **New → Web Service**
3. Connect your GitHub account
4. Select your forked **Cyber-x** repo
5. Fill in these settings:

| Field | Value |
|---|---|
| **Name** | cyber-x (or anything you like) |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node index.js` |
| **Instance Type** | Free |

---

### Step 3 — Set Environment Variables

In Render, go to **Environment** tab and add these:

| Key | Value |
|---|---|
| `PAIRING_NUMBER` | Your WhatsApp number with country code, digits only. Example: `2348012345678` |
| `BOT_NAME` | Whatever you want to call your bot |
| `PREFIX` | `.` (or your preferred prefix) |
| `OWNER_NUMBER` | Your WhatsApp number (same as pairing number) |

---

### Step 4 — Deploy & Pair

1. Click **Deploy**
2. Wait for the build to finish
3. Open the **Logs** tab
4. You will see a pairing code like:

```
╔══════════════════════════════╗
║  WHATSAPP PAIRING CODE       ║
║  👉  ABCD-WXYZ               ║
╚══════════════════════════════╝
```

5. On your WhatsApp:
   - Go to **Settings → Linked Devices → Link a Device**
   - Tap **Link with phone number instead**
   - Enter the code from the logs

6. Bot connects instantly — you're live ✅

---

## 🔄 Keeping Your Bot Online (Free Render Tier)

Render's free tier sleeps after inactivity. CYBER X has a built-in auto-ping every 4 minutes to prevent this. No extra setup needed.

---

## ⚙️ Configuration

All settings are in environment variables on Render. You can update them anytime:

- `BOT_NAME` — Display name of your bot
- `PREFIX` — Command prefix (default `.`)
- `OWNER_NUMBER` — Your number for owner-only commands

After changing env vars, Render auto-redeploys.

---

## 📁 Project Structure

```
Cyber-x/
├── index.js          ← Core bot (do not modify)
├── commands/         ← All bot commands
├── lib/              ← Shared libraries
├── session/          ← Auth session (auto-generated)
└── .env              ← Local env (Render uses dashboard vars)
```

---

## ➕ Adding Your Own Commands

Create a new file in `commands/`:

```js
'use strict'

module.exports = {
  pattern:  'hello',
  desc:     'Say hello',
  category: 'general',

  run: async ({ sock, from, msg }) => {
    await sock.sendMessage(from, {
      text: 'Hello from CYBER X! 👋'
    }, { quoted: msg })
  },
}
```

Push to GitHub → Render auto-redeploys → command is live. That's it.

---

## ❓ Common Issues

**Bot not connecting?**
- Make sure `PAIRING_NUMBER` has no spaces, dashes or `+` — digits only
- Check Render logs for the pairing code
- Delete the `session/` folder and redeploy if stuck

**Commands not working?**
- Make sure you set `PREFIX` and `OWNER_NUMBER` correctly in env vars
- Check Render logs for any error messages

**Bot going offline?**
- The auto-ping keeps it alive on free tier
- If it still sleeps, set `RENDER_EXTERNAL_URL` env var to your Render service URL

---

## ⚠️ Important Rules

- Each person must use **their own WhatsApp number**
- Do **not** share your `session/` folder with anyone — it contains your auth credentials
- Do **not** use CYBER X to spam, harass, or violate WhatsApp Terms of Service
- Misuse can result in your WhatsApp number being banned

---

## 📜 Credits

```
Bot Name   : CYBER X ™
Creator    : Charles Chucks
© 𝕮𝖄𝕭𝙴𝚁 𝖃 — All rights reserved
```

---

> Built with ❤️ by Charles Chucks

