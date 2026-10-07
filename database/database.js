"use strict"

const Database = require("better-sqlite3")
const path = require("path")

const dbPath = path.join(__dirname, "zenx.db")
const db = new Database(dbPath)

db.pragma("journal_mode = WAL")
db.pragma("foreign_keys = ON")

db.exec(`
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    coins INTEGER DEFAULT 0,
    total_spins INTEGER DEFAULT 0,
    total_jackpots INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hero_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antilink (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS antistatus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_key TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS welcome_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_phone
    ON players(phone);

CREATE INDEX IF NOT EXISTS idx_daily_player
    ON daily(player_key);

CREATE INDEX IF NOT EXISTS idx_cards_player
    ON cards(player_key);

CREATE INDEX IF NOT EXISTS idx_hero_cache_key
    ON hero_cache(cache_key);

CREATE INDEX IF NOT EXISTS idx_antilink_group
    ON antilink(group_jid);

CREATE INDEX IF NOT EXISTS idx_welcome_group
    ON welcome_store(group_jid);
`)

console.log("ZEN X DATABASE READY")
console.log("Database:", dbPath)

module.exports = db

/* ─────────────────────────────────────────────────────────────
   ZEN X VPS STORAGE
   WhatsApp authentication + application JSON
   ───────────────────────────────────────────────────────────── */

db.exec(`
CREATE TABLE IF NOT EXISTS wa_auth (
    phone TEXT PRIMARY KEY,
    creds TEXT NOT NULL DEFAULT '{}',
    keys TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_data (
    namespace TEXT NOT NULL,
    data_key TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (namespace, data_key)
);

CREATE TABLE IF NOT EXISTS bot_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_type TEXT NOT NULL,
    backup_key TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wa_auth_updated
    ON wa_auth(updated_at);

CREATE INDEX IF NOT EXISTS idx_app_data_namespace
    ON app_data(namespace);
`);
