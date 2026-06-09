const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../database/groupMemory.json");

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
}

function db() {
  return JSON.parse(fs.readFileSync(DB_PATH));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// MAIN AUTO HANDLER (THIS IS WHAT INDEX WILL CALL LIKE ANTILINK)
async function handleMemory(sock, msg, extractBody) {
  try {
    const jid = msg.key.remoteJid;
    if (!jid || !jid.endsWith("@g.us")) return;

    const text = extractBody(msg);
    if (!text) return;

    const data = db();

    if (!data[jid]) data[jid] = { logs: [] };

    data[jid].logs.push({
      text: text.slice(0, 80),
      time: Date.now()
    });

    if (data[jid].logs.length > 50) {
      data[jid].logs.shift();
    }

    save(data);
  } catch (e) {
    console.log("[MEMORY ERROR]", e.message);
  }
}

module.exports = {
  handleMemory
};
