"use strict";

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../database/groupMemory.json");
const DB_DIR = path.dirname(DB_PATH);
const SAVE_DEBOUNCE_MS = 1000;
const SAVE_RETRY_MS = 5000;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function loadDatabase() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[MEMORY] Load error:", error.message);
    }
    return {};
  }
}

// Read the ~1 MB store once at startup; all message updates stay in memory.
const database = loadDatabase();
let revision = 0;
let persistedRevision = 0;
let saveTimer = null;
let writePromise = null;

function tempPath(revisionToWrite, suffix) {
  return DB_PATH + "." + process.pid + "." + revisionToWrite + "." + suffix + ".tmp";
}

function queueFlush(delayMs) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush().catch(() => {});
  }, delayMs);
  if (saveTimer.unref) saveTimer.unref();
}

function markDirty() {
  revision += 1;
  queueFlush(SAVE_DEBOUNCE_MS);
}

async function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (writePromise) {
    await writePromise;
    if (persistedRevision < revision) return flush();
    return;
  }

  if (persistedRevision >= revision) return;

  const operation = (async () => {
    while (persistedRevision < revision) {
      const targetRevision = revision;
      const serialized = JSON.stringify(database);
      const tmp = tempPath(targetRevision, "async");
      await fs.promises.writeFile(tmp, serialized, "utf8");
      await fs.promises.rename(tmp, DB_PATH);
      persistedRevision = targetRevision;
    }
  })();

  writePromise = operation;
  try {
    await operation;
  } catch (error) {
    console.error("[MEMORY] Save error:", error.message);
    queueFlush(SAVE_RETRY_MS);
    throw error;
  } finally {
    if (writePromise === operation) writePromise = null;
  }
}

// Preserve the latest in-memory log if PM2 stops the process before the timer fires.
function flushOnExit() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (persistedRevision >= revision) return;

  const tmp = tempPath(revision, "exit");
  try {
    fs.writeFileSync(tmp, JSON.stringify(database), "utf8");
    fs.renameSync(tmp, DB_PATH);
    persistedRevision = revision;
  } catch (error) {
    console.error("[MEMORY] Exit save error:", error.message);
  }
}
process.once("exit", flushOnExit);

function ensureGroup(jid) {
  if (!database[jid] || typeof database[jid] !== "object") {
    database[jid] = { logs: [] };
  }
  if (!Array.isArray(database[jid].logs)) database[jid].logs = [];
  return database[jid];
}

async function handleMemory(sock, msg, extractBody) {
  try {
    const jid = msg && msg.key && msg.key.remoteJid;
    if (!jid || !jid.endsWith("@g.us")) return;

    const text = extractBody(msg);
    if (!text) return;

    const group = ensureGroup(jid);
    group.logs.push({ text: text.slice(0, 80), time: Date.now() });
    if (group.logs.length > 50) group.logs.splice(0, group.logs.length - 50);
    markDirty();
  } catch (error) {
    console.error("[MEMORY] Handle error:", error.message);
  }
}

module.exports = {
  handleMemory,
  flush,
  readDatabase: () => database,
};
