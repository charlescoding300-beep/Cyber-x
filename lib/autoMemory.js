const memory = require("./groupMemory");

// this runs automatically for every message
function autoMemoryHandler(sock, msg, extractBody) {
  try {
    const jid = msg.key.remoteJid;
    if (!jid?.endsWith("@g.us")) return;

    const text = extractBody(msg);
    if (!text) return;

    // AUTO LOG EVERYTHING (safe, lightweight)
    memory.pushLog(jid, `message: ${text.slice(0, 80)}`);

  } catch (e) {
    console.log("[AUTO MEMORY ERROR]", e.message);
  }
}

module.exports = { autoMemoryHandler };
