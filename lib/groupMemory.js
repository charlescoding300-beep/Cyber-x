const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../database/groupMemory.json");

// ensure folder exists
const DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

// ensure file exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
}

// load memory
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH));
  } catch {
    return {};
  }
}

// save memory
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// set group data
function setGroup(jid, key, value) {
  const db = readDB();

  if (!db[jid]) db[jid] = {};

  db[jid][key] = value;

  writeDB(db);
}

// get group data
function getGroup(jid, key) {
  const db = readDB();
  return db[jid]?.[key];
}

// push logs (auto memory history)
function pushLog(jid, action) {
  const db = readDB();

  if (!db[jid]) db[jid] = {};
  if (!db[jid].logs) db[jid].logs = [];

  db[jid].logs.push({
    action,
    time: new Date().toISOString()
  });

  // keep only last 50 logs
  if (db[jid].logs.length > 50) {
    db[jid].logs.shift();
  }

  writeDB(db);
}

module.exports = {
  setGroup,
  getGroup,
  pushLog,
  readDB
};
