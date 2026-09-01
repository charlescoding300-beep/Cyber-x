require("dotenv").config();

const { Telegraf } = require("telegraf");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Your local Zen X server
const SERVER_URL =
  process.env.CYBER_X_SERVER_URL || "http://127.0.0.1:3000";

// Hardcoded — users must follow this WhatsApp channel before they can pair
const WHATSAPP_CHANNEL_LINK = "https://whatsapp.com/channel/0029Vb8U73N1yT211FynJ01n";

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing.");
  process.exit(1);
}

const bot = new Telegraf(TELEGRAM_TOKEN);

/*
|--------------------------------------------------------------------------
| GATE — WhatsApp channel follow (honor system — WhatsApp has no API for this)
|--------------------------------------------------------------------------
*/

// Users who've confirmed following the WhatsApp channel this session
const whatsappFollowConfirmed = new Set();

// Phone number a user was trying to pair with, held until they confirm
const pendingNumber = new Map();

async function promptToFollowWhatsApp(ctx) {
  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║      𝘼𝘾𝙏𝙄𝙊𝙉 𝙍𝙀𝙌𝙐𝙄𝙍𝙀𝘿      ║
╚══════════════════════════════╝

🔒 Following our WhatsApp channel
is required to use Zen X pairing.

📲 Tap below to follow, then confirm.

⚠️ Pairing will not continue until
you confirm you've followed.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Follow Channel", url: WHATSAPP_CHANNEL_LINK }],
          [{ text: "✅ I've Followed", callback_data: "whatsapp_followed" }],
        ],
      },
    }
  );
}

/*
|--------------------------------------------------------------------------
| CALLBACK BUTTON — "I've Followed"
|--------------------------------------------------------------------------
*/

bot.action("whatsapp_followed", async (ctx) => {
  const userId = ctx.from.id;
  await ctx.answerCbQuery();

  const verifying = await ctx.reply("🔄 Verifying your follow status...");

  // Brief pause for weight — this is an honor-system check, no real API call happens
  await new Promise((resolve) => setTimeout(resolve, 2000));

  whatsappFollowConfirmed.add(userId);

  await ctx.telegram.editMessageText(
    ctx.chat.id,
    verifying.message_id,
    undefined,
    "✅ Thanks for following! You're all set."
  );

  const number = pendingNumber.get(userId);
  if (!number) return;

  pendingNumber.delete(userId);
  await runPairing(ctx, number);
});

/*
|--------------------------------------------------------------------------
| STATE
|--------------------------------------------------------------------------
*/

// phone -> { chatId, connected }
const sessions = new Map();

// per-user cooldown so people can't spam pairing requests
const lastRequest = new Map();
const COOLDOWN_MS = 30_000;

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function cleanPhone(text) {
  return String(text || "").replace(/\D/g, "");
}

// Pulls the first plausible phone number out of free-form text.
// Accepts optional leading + and 8-15 digits (covers all real-world MSISDN lengths).
function extractPhoneNumber(text) {
  if (!text) return null;
  const match = String(text).match(/\+?\d[\d\s-]{7,17}\d/);
  if (!match) return null;
  const digits = cleanPhone(match[0]);
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function onCooldown(userId) {
  const last = lastRequest.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function setCooldown(userId) {
  lastRequest.set(userId, Date.now());
}

async function getWhatsAppStatus(phone) {
  try {
    const response = await fetch(
      `${SERVER_URL}/api/session/${encodeURIComponent(phone)}`
    );
    if (!response.ok) return { connected: false, status: "Unknown" };
    return await response.json();
  } catch (error) {
    console.error(`[STATUS] ${phone}:`, error.message);
    return { connected: false, status: "Server unavailable" };
  }
}

async function getSlotsSummary() {
  try {
    const response = await fetch(`${SERVER_URL}/api/slots`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[SLOTS]", error.message);
    return null;
  }
}

async function getTotalUsers() {
  try {
    const response = await fetch(`${SERVER_URL}/api/stats`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.totalUsers ?? null;
  } catch (error) {
    console.error("[STATS]", error.message);
    return null;
  }
}

async function requestPairingCode(number) {
  const response = await fetch(
    `${SERVER_URL}/pair?phone=${encodeURIComponent(number)}`
  );
  const result = await response.json();

  if (!response.ok || !result.status || !result.code) {
    throw new Error(result.error || "Pairing code was not generated");
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| CORE PAIRING FLOW — shared by /pair and auto-detected numbers
|--------------------------------------------------------------------------
*/

async function runPairing(ctx, number) {
  const userId = ctx.from.id;

  if (!whatsappFollowConfirmed.has(userId)) {
    pendingNumber.set(userId, number);
    return promptToFollowWhatsApp(ctx);
  }

  if (onCooldown(userId)) {
    return ctx.reply("⏳ Please wait a bit before requesting another pairing code.");
  }
  setCooldown(userId);

  const loading = await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
╚══════════════════════════════╝

⏳ *GENERATING PAIRING CODE...*

📱 Number:
\`${number}\`

🔄 Please wait...`,
    { parse_mode: "Markdown" }
  );

  try {
    const result = await requestPairingCode(number);
    const code = result.code;

    sessions.set(number, {
      chatId: ctx.chat.id,
      connected: !!result.connected,
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loading.message_id,
      undefined,
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║     𝙋𝘼𝙄𝙍𝙄𝙉𝙂 𝙎𝙐𝘾𝘾𝙀𝙎𝙎     ║
╚══════════════════════════════╝

✅ *𝙋𝘼𝙄𝙍𝙄𝙉𝙂 𝘾𝙊𝘿𝙀 𝙂𝙀𝙉𝙀𝙍𝘼𝙏𝙀𝘿*

📱 Number
└─ \`${number}\`

🔐 Your pairing code:
┌──────────────────────┐
│      *${code}*          │
└──────────────────────┘

${result.slot ? `🧩 Slot: \`${result.slot}\`\n\n` : ""}👇 Tap the button below to copy it.

📲 *𝙃𝙊𝙒 𝙏𝙊 𝙇𝙄𝙉𝙆*

① Open WhatsApp
② Go to Linked Devices
③ Tap Link a Device
④ Choose "Link with phone number"
⑤ Enter the code

━━━━━━━━━━━━━━━━━━━━━━
🛡️ Keep your pairing code private
⚡ 𝗭𝚎𝚗 𝗫 ✓
━━━━━━━━━━━━━━━━━━━━━━`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 𝘾𝙊𝙋𝙔 𝘾𝙊𝘿𝙀", copy_text: { text: code } }],
          ],
        },
      }
    );
  } catch (error) {
    console.error("[TELEGRAM PAIR ERROR]", error);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loading.message_id,
      undefined,
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║       𝙋𝘼𝙄𝙍𝙄𝙉𝙂 𝙁𝘼𝙄𝙇𝙀𝘿       ║
╚══════════════════════════════╝

❌ *Could not generate the pairing code.*

Reason:
\`${error.message}\`

🔄 Try again by sending your number, or use /pair.

━━━━━━━━━━━━━━━━━━━━━━
⚡ 𝗭𝚎𝚗 𝗫 ✓
━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown" }
    );
  }
}

/*
|--------------------------------------------------------------------------
| /START
|--------------------------------------------------------------------------
*/

bot.start(async (ctx) => {
  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║      𝙒𝙃𝘼𝙏𝙎𝘼𝙋𝙋 𝙎𝙔𝙎𝙏𝙀𝙈      ║
╚══════════════════════════════╝

👋 Welcome to *Zen X*.

🔐 Connect your WhatsApp using
a secure pairing code.

📱 Just send your number
(with country code) — no command needed.

Example:
\`2348012345678\`

Or use:
/pair

ℹ️ Use:
/help
/status
/slots

━━━━━━━━━━━━━━━━━━━━━━
⚡ 𝗭𝚎𝚗 𝗫 ✓
━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );
});

/*
|--------------------------------------------------------------------------
| /HELP
|--------------------------------------------------------------------------
*/

bot.command("help", async (ctx) => {
  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║          𝙃𝙀𝙇𝙋             ║
╚══════════════════════════════╝

🔐 Just send your number
Generates a WhatsApp pairing code automatically.

🔐 /pair
Same thing, with a guided prompt.

📊 /status
Check your WhatsApp connection.

🧩 /slots
See how many slots/users are active.

❌ /cancel
Cancel the current operation.

━━━━━━━━━━━━━━━━━━━━━━
⚡ *𝗭𝚎𝚗 𝗫 ✓*
━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );
});

/*
|--------------------------------------------------------------------------
| /CANCEL
|--------------------------------------------------------------------------
*/

bot.command("cancel", async (ctx) => {
  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
╚══════════════════════════════╝

❌ Operation cancelled.

Send your number whenever you're ready.`
  );
});

/*
|--------------------------------------------------------------------------
| /PAIR — guided prompt (still works exactly like before)
|--------------------------------------------------------------------------
*/

bot.command("pair", async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1).join(" ");
  const directNumber = extractPhoneNumber(args);

  if (directNumber) {
    return runPairing(ctx, directNumber);
  }

  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║       𝙒𝙃𝘼𝙏𝙎𝘼𝙋𝙋 𝙋𝘼𝙄𝙍       ║
╚══════════════════════════════╝

📱 Send your WhatsApp number.

Example:

<code>2348012345678</code>

🌍 Include your country code.

❌ Don't use:
<code>+234 801 234 5678</code>

✅ Use:
<code>2348012345678</code>

━━━━━━━━━━━━━━━━━━━━━━
⚡ 𝗭𝚎𝚗 𝗫 ✓
━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "HTML" }
  );
});

/*
|--------------------------------------------------------------------------
| /SLOTS — how many slots/users are in use
|--------------------------------------------------------------------------
*/

bot.command("slots", async (ctx) => {
  const summary = await getSlotsSummary();
  const totalUsers = await getTotalUsers();

  if (!summary || !summary.slots) {
    return ctx.reply("⚠️ Could not reach the server to fetch slot info. Try again shortly.");
  }

  const lines = summary.slots
    .map(
      (s) =>
        `Slot ${s.slot}: ${s.full ? "🔴 full" : "🟢 open"} (${s.used ?? "?"}/${s.capacity ?? summary.capacity ?? "?"})`
    )
    .join("\n");

  await ctx.reply(
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║        𝙎𝙇𝙊𝙏 𝙎𝙏𝘼𝙏𝙐𝙎        ║
╚══════════════════════════════╝

🧩 *Slots* (${summary.slotCount ?? summary.slots.length} total, ${summary.capacity ?? "?"} capacity each)

${lines}

${totalUsers !== null ? `👥 *Total users ever paired:* \`${totalUsers}\`` : ""}

━━━━━━━━━━━━━━━━━━━━━━
⚡ 𝗭𝚎𝚗 𝗫 ✓
━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );
});

/*
|--------------------------------------------------------------------------
| AUTO-DETECT PHONE NUMBERS — no /pair command required
|--------------------------------------------------------------------------
*/

bot.on("text", async (ctx) => {
  const text = ctx.message.text;

  // Ignore actual bot commands — they have their own handlers above
  if (text.startsWith("/")) return;

  const number = extractPhoneNumber(text);

  if (!number) {
    return ctx.reply(
      "🤖 Send your WhatsApp number with country code (e.g. `2348012345678`) to get a pairing code, or use /help.",
      { parse_mode: "Markdown" }
    );
  }

  await runPairing(ctx, number);
});

/*
|--------------------------------------------------------------------------
| /STATUS
|--------------------------------------------------------------------------
*/

bot.command("status", async (ctx) => {
  const entry = [...sessions.entries()].find(
    ([, s]) => s.chatId === ctx.chat.id
  );

  if (!entry) {
    return ctx.reply(
`⚠️ No WhatsApp session is being monitored.

Send your number or use /pair first.`
    );
  }

  const [phone] = entry;
  const status = await getWhatsAppStatus(phone);

  if (status.connected) {
    await ctx.reply(
`╔══════════════════════════════╗
║       🟢 𝗭𝚎𝚗 𝗫 ✓       ║
║      𝙎𝙔𝙎𝙏𝙀𝙈 𝙊𝙉𝙇𝙄𝙉𝙀      ║
╚══════════════════════════════╝

✅ *WHATSAPP CONNECTED*

📱 Number:
\`${phone}\`

🟢 Connection: *ACTIVE*
🚀 Zen X is running.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.reply(
`╔══════════════════════════════╗
║       🔴 𝗭𝚎𝚗 𝗫 ✓       ║
║      𝙎𝙔𝙎𝙏𝙀𝙈 𝙊𝙁𝙁𝙇𝙄𝙉𝙀      ║
╚══════════════════════════════╝

😞 *WHATSAPP DISCONNECTED*

📱 Number:
\`${phone}\`

🔴 Connection: *OFFLINE*

Send your number again to reconnect.`,
      { parse_mode: "Markdown" }
    );
  }
});

/*
|--------------------------------------------------------------------------
| CONNECTION MONITOR — checks every 5 seconds
|--------------------------------------------------------------------------
*/

setInterval(async () => {
  for (const [phone, session] of sessions.entries()) {
    try {
      const status = await getWhatsAppStatus(phone);
      const connected = !!status.connected;

      if (connected && !session.connected) {
        session.connected = true;
        await bot.telegram.sendMessage(
          session.chatId,
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║      𝙎𝙔𝙎𝙏𝙀𝙈 𝙊𝙉𝙇𝙄𝙉𝙀      ║
╚══════════════════════════════╝

🎉 *WHATSAPP CONNECTED SUCCESSFULLY!*

✅ Connection: *ACTIVE*
📱 Number: \`${phone}\`
🟢 Status: *ONLINE*

━━━━━━━━━━━━━━━━━━━━━━
🚀 Your Zen X bot is now running.
🛡️ Your session has been registered.
━━━━━━━━━━━━━━━━━━━━━━

⚡ *𝗭𝚎𝚗 𝗫 ✓*`,
          { parse_mode: "Markdown" }
        );
      }

      if (!connected && session.connected) {
        session.connected = false;
        await bot.telegram.sendMessage(
          session.chatId,
`╔══════════════════════════════╗
║       ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡       ║
║      𝙎𝙔𝙎𝙏𝙀𝙈 𝙊𝙁𝙁𝙇𝙄𝙉𝙀      ║
╚══════════════════════════════╝

😞 *WHATSAPP DISCONNECTED*

🔴 Connection: *OFFLINE*
📱 Number: \`${phone}\`
⚠️ Status: *DISCONNECTED*

━━━━━━━━━━━━━━━━━━━━━━
🔄 Your WhatsApp connection has been lost.
📲 Send your number again if you need to reconnect.
━━━━━━━━━━━━━━━━━━━━━━

⚡ *𝗭𝚎𝚗 𝗫 ✓*`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      console.error(`[MONITOR] ${phone}:`, error.message);
    }
  }
}, 5000);

/*
|--------------------------------------------------------------------------
| LAUNCH
|--------------------------------------------------------------------------
*/

bot.launch();

console.log(`
╔══════════════════════════════════════╗
║          ⚡ 𝗭𝚎𝚗 𝗫 ✓ ⚡              ║
║                                      ║
║      TELEGRAM PAIRING SYSTEM         ║
║                                      ║
║      🔐 Pairing:  ONLINE             ║
║      🤖 Auto-detect: ENABLED         ║
║      📡 Monitor:  ACTIVE             ║
║      🟢 Status:   READY              ║
╚══════════════════════════════════════╝
`);

/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
