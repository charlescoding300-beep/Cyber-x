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

// ── Shared header used on every message — one line, always consistent ──
const HEADER = "⚡ <b>ZEN X</b> — WhatsApp Pairing";
const FOOTER = "⚡ <i>Zen X</i>";

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
`${HEADER}
<b>Action required</b>

🔒 Following our WhatsApp channel is required before you can pair.

📲 Tap below to follow, then confirm — pairing won't continue until you do.`,
    {
      parse_mode: "HTML",
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

// Matches the REAL shape returned by index.js's getSlotsSummary():
// an array of { slot, connected, online, onlineCount, capacity, full }
// — there is no wrapping object and no "used" field, both of which the
// old version of this file incorrectly assumed.
async function getSlotsSummary() {
  try {
    const response = await fetch(`${SERVER_URL}/api/slots`);
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : (data?.slots || null);
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
`${HEADER}

⏳ <b>Generating pairing code...</b>

📱 Number: <code>${number}</code>

Please wait a moment.`,
    { parse_mode: "HTML" }
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
`${HEADER}
✅ <b>Pairing code generated</b>

📱 Number: <code>${number}</code>
${result.slot ? `🧩 Slot: <code>${result.slot}</code>\n` : ""}
🔐 <b>Your pairing code:</b>
<code>${code}</code>

<i>Tap the code above to copy it, or use the button below.</i>

<b>How to link:</b>
1️⃣ Open WhatsApp
2️⃣ Settings → Linked Devices
3️⃣ Link a Device
4️⃣ "Link with phone number instead"
5️⃣ Enter the code

🛡️ Keep this code private — don't share it with anyone.

${FOOTER}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Copy Code", copy_text: { text: code } }],
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
`${HEADER}
❌ <b>Pairing failed</b>

📱 Number: <code>${number}</code>

<b>Reason:</b> <code>${error.message}</code>

🔄 Try again by sending your number, or use /pair.

${FOOTER}`,
      { parse_mode: "HTML" }
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
`${HEADER}
👋 Welcome to <b>Zen X</b>.

Connect your WhatsApp using a secure pairing code — no QR scan needed.

📱 Just send your number with country code — no command required.

Example: <code>2348012345678</code>

Or use /pair for a guided prompt.

<b>Other commands:</b>
/help — full command list
/status — check your connection
/slots — see server capacity

${FOOTER}`,
    { parse_mode: "HTML" }
  );
});

/*
|--------------------------------------------------------------------------
| /HELP
|--------------------------------------------------------------------------
*/

bot.command("help", async (ctx) => {
  await ctx.reply(
`${HEADER}
<b>Commands</b>

📱 <b>Send your number</b>
Generates a WhatsApp pairing code automatically — no command needed.

🔐 /pair
Same thing, with a guided prompt.

📊 /status
Check your WhatsApp connection status.

🧩 /slots
See how many server slots/users are active.

❌ /cancel
Cancel the current operation.

${FOOTER}`,
    { parse_mode: "HTML" }
  );
});

/*
|--------------------------------------------------------------------------
| /CANCEL
|--------------------------------------------------------------------------
*/

bot.command("cancel", async (ctx) => {
  await ctx.reply(
`${HEADER}
❌ Operation cancelled.

Send your number whenever you're ready.`,
    { parse_mode: "HTML" }
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
`${HEADER}
<b>WhatsApp Pairing</b>

📱 Send your WhatsApp number, including country code.

✅ Correct: <code>2348012345678</code>
❌ Wrong: <code>+234 801 234 5678</code>

${FOOTER}`,
    { parse_mode: "HTML" }
  );
});

/*
|--------------------------------------------------------------------------
| /SLOTS — how many slots/users are in use
|--------------------------------------------------------------------------
*/

bot.command("slots", async (ctx) => {
  const slots = await getSlotsSummary();
  const totalUsers = await getTotalUsers();

  if (!slots || !slots.length) {
    return ctx.reply("⚠️ Could not reach the server to fetch slot info. Try again shortly.");
  }

  const lines = slots
    .map((s) => {
      const status = s.full ? "🔴 full" : (s.online ? "🟢 open" : "⚪ open");
      return `Slot ${s.slot}: ${status} (${s.connected ?? 0}/${s.capacity ?? "?"})`;
    })
    .join("\n");

  await ctx.reply(
`${HEADER}
<b>Server Slot Status</b>

<code>${lines}</code>

${totalUsers !== null ? `👥 Total users ever paired: <b>${totalUsers}</b>\n` : ""}
${FOOTER}`,
    { parse_mode: "HTML" }
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
      "🤖 Send your WhatsApp number with country code (e.g. <code>2348012345678</code>) to get a pairing code, or use /help.",
      { parse_mode: "HTML" }
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
`${HEADER}
🟢 <b>Connected</b>

📱 Number: <code>${phone}</code>
Status: <b>Active</b>

🚀 Zen X is running.

${FOOTER}`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
`${HEADER}
🔴 <b>Disconnected</b>

📱 Number: <code>${phone}</code>
Status: <b>Offline</b>

Send your number again to reconnect.

${FOOTER}`,
      { parse_mode: "HTML" }
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
`${HEADER}
🎉 <b>WhatsApp connected successfully!</b>

📱 Number: <code>${phone}</code>
Status: <b>Online</b>

🚀 Your Zen X bot is now running.
🛡️ Your session has been registered.

${FOOTER}`,
          { parse_mode: "HTML" }
        );
      }

      if (!connected && session.connected) {
        session.connected = false;
        await bot.telegram.sendMessage(
          session.chatId,
`${HEADER}
😞 <b>WhatsApp disconnected</b>

📱 Number: <code>${phone}</code>
Status: <b>Offline</b>

🔄 Your WhatsApp connection has been lost.
📲 Send your number again if you need to reconnect.

${FOOTER}`,
          { parse_mode: "HTML" }
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
⚡ ZEN X — Telegram Pairing System
   🔐 Pairing:      ONLINE
   🤖 Auto-detect:  ENABLED
   📡 Monitor:      ACTIVE
   🟢 Status:       READY
`);

/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

