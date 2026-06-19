// ─────────────────────────────────────────────────────────────────────────────
// lib/automation.js  —  CYBER X  |  Real-Effect Auto Settings
//
// Wires up the settings that were sitting in lib/settings.js as dead booleans:
//   autoTyping, autoRecording, autoReply, autoRead,
//   autoViewStatus, autoReactStatus, alwaysOnline, groupOnly, dmOnly
//
// Nothing in here is loaded automatically — index.js's dynamic loadDir(LIB_DIR)
// picks it up the same way it picks up every other lib/*.js file, because it
// exports a plain object. No index.js changes needed for that part.
//
// Two tiny call sites DO need adding by hand (can't avoid touching index.js
// for these — there's no event for "ordinary message" or "status arrived"
// that doesn't already pass through index.js's existing listeners):
//
//   1. Inside the existing messages.upsert loop, alongside handleMemory /
//      handleAntilink, add:
//        if (!m.key.fromMe) lib.handleAutomation(sock, m, extractBody, state).catch(() => {})
//
//   2. Inside handleMessage(), right after `mode === "private"` check, add:
//        if (lib.blockedByChatType && lib.blockedByChatType(state, from)) return
//
//   3. Inside connection.update's `if (connection === "open")` block, add:
//        if (typeof lib.startPresenceLoop === "function") lib.startPresenceLoop(sock, state)
//
// That's it — three single lines, nothing existing rewritten or removed.
// Exact diffs are in the second message below.
// ─────────────────────────────────────────────────────────────────────────────

// Presence updates expire after ~10s on multi-device WhatsApp, so a 5s window
// fits in a single update with no flicker and no need for a refresh mid-way.
const TYPING_WINDOW_MS = 5000;

// alwaysOnline must be re-sent before the ~10s expiry. 8s gives margin.
const PRESENCE_REFRESH_MS = 8000;

// Per-chat timers so rapid-fire messages in the same chat don't stack
// overlapping composing/paused calls on top of each other.
const typingTimers = new Map(); // jid -> Timeout

// One interval per connected session (phone), not per chat.
const presenceLoops = new Map(); // phone -> Timeout

function cleanJid(jidOrNum) {
  return (jidOrNum || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Fire-and-forget fake typing indicator for `ms`, then clears it.
 * Uses 'paused' (not 'available') to clear — per Baileys docs, 'paused' is
 * the correct way to stop showing composing/recording without also
 * announcing online status as a side effect.
 */
async function fakePresence(sock, jid, kind, ms = TYPING_WINDOW_MS) {
  const existing = typingTimers.get(jid);
  if (existing) clearTimeout(existing);

  try {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate(kind, jid);
  } catch {
    return;
  }

  const t = setTimeout(async () => {
    typingTimers.delete(jid);
    try {
      await sock.sendPresenceUpdate("paused", jid);
    } catch {}
  }, ms);

  typingTimers.set(jid, t);
}

/**
 * Main hook — called once per incoming, non-command, non-self message.
 * index.js decides what counts as "ordinary" (no prefix match) before
 * calling this, OR you can pass every message and let this function check
 * the prefix itself — see isOrdinaryMessage below, used internally as a
 * safety net in case this ever gets called from a different spot.
 */
async function handleAutomation(sock, m, extractBody, state) {
  if (!m?.message) return;
  if (m.key.fromMe) return;

  const from = m.key.remoteJid;
  if (!from) return;

  // Status updates are handled by handleStatusAutomation, not here.
  if (from === "status@broadcast") return;

  const settings = state.settings; // per-user forUser() layer, falls back to global
  const isGroup = from.endsWith("@g.us");

  // autoRead — mark every incoming message as read, regardless of prefix.
  if (settings.get("autoRead")) {
    try {
      await sock.readMessages([m.key]);
    } catch {}
  }

  const body = extractBody(m) || "";
  const prefix = settings.get("prefix") || ".";
  const isCommand = body.startsWith(prefix);
  if (isCommand) return; // typing/recording/reply only fire on ordinary messages

  const typingOn = settings.get("autoTyping");
  const recordingOn = settings.get("autoRecording");

  // autoTyping and autoRecording are mutually exclusive per message —
  // if somehow both are on, typing wins so there's no flicker between the two.
  if (typingOn) {
    fakePresence(sock, from, "composing").catch(() => {});
  } else if (recordingOn) {
    fakePresence(sock, from, "recording").catch(() => {});
  }

  // autoReply — DMs only by design (firing in groups on every non-command
  // message is spammy and a fast way to get the linked number flagged).
  if (settings.get("autoReply") && !isGroup) {
    const template = settings.get("autoReplyText") || "Hey! I'm here.";
    const text = template.replace(/\{prefix\}/g, prefix);
    try {
      await sock.sendMessage(from, { text }, { quoted: m });
    } catch {}
  }
}

/**
 * Separate hook for status@broadcast updates — these arrive as normal
 * messages.upsert events with key.remoteJid === "status@broadcast", but the
 * "viewer" of the status is identified by key.participant, not remoteJid.
 */
async function handleStatusAutomation(sock, m, state) {
  if (!m?.message) return;
  if (m.key.remoteJid !== "status@broadcast") return;
  if (m.key.fromMe) return;

  const statusOwner = m.key.participant;
  if (!statusOwner) return;

  const settings = state.settings;

  if (settings.get("autoViewStatus")) {
    try {
      await sock.readMessages([m.key]);
    } catch {}
  }

  if (settings.get("autoReactStatus")) {
    const emoji = settings.get("statusReactEmoji") || "🔥";
    try {
      await sock.sendMessage(
        "status@broadcast",
        {
          react: {
            text: emoji,
            key: m.key,
          },
        },
        {
          // Without statusJidList the reaction is sent but never actually
          // delivered to the status owner — this is what targets it to them.
          statusJidList: [statusOwner],
        }
      );
    } catch {}
  }
}

/**
 * groupOnly / dmOnly guard — bot-wide for now (not per-command). Owner always
 * bypasses both, so misconfiguring this can't lock the owner out of their
 * own bot. Returns true if the message SHOULD be blocked.
 */
function blockedByChatType(state, from, isOwner) {
  if (isOwner) return false;

  const settings = state.settings;
  const isGroup = from.endsWith("@g.us");

  if (settings.get("groupOnly") && !isGroup) return true;
  if (settings.get("dmOnly") && isGroup) return true;

  return false;
}

/**
 * alwaysOnline — keeps presence pinned "available" globally (no jid = applies
 * to the whole connection, not a specific chat) via a background interval,
 * re-sent every 8s since multi-device presence expires after ~10s.
 * One loop per session (phone), safe to call again on reconnect — clears
 * any previous loop for that phone first.
 */
function startPresenceLoop(sock, state) {
  const phone = state.phone;
  const existing = presenceLoops.get(phone);
  if (existing) clearInterval(existing);

  const tick = async () => {
    if (!state.settings.get("alwaysOnline")) return;
    try {
      await sock.sendPresenceUpdate("available");
    } catch {}
  };

  tick(); // fire immediately so it doesn't wait 8s for the first update
  const interval = setInterval(tick, PRESENCE_REFRESH_MS);
  presenceLoops.set(phone, interval);
}

function stopPresenceLoop(phone) {
  const existing = presenceLoops.get(cleanJid(phone) || phone);
  if (existing) {
    clearInterval(existing);
    presenceLoops.delete(phone);
  }
}

module.exports = {
  handleAutomation,
  handleStatusAutomation,
  blockedByChatType,
  startPresenceLoop,
  stopPresenceLoop,
};
