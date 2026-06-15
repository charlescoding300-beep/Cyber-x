require("dotenv").config()
const fs    = require("fs")
const path  = require("path")
const http  = require("http")
const https = require("https")
const Pino  = require("pino")
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys")

process.on("uncaughtException",  e => console.error("[CRASH]",   e?.message || e))
process.on("unhandledRejection", e => console.error("[PROMISE]", e?.message || e))

const BOT_START   = Math.floor(Date.now() / 1000)
const PORT        = process.env.PORT || 3000
const SELF_URL    = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`
const MAX_RETRIES = 20
const CMD_DIR     = path.join(__dirname, "commands")
const LIB_DIR     = path.join(__dirname, "lib")
const UTILS_DIR   = path.join(__dirname, "utils")

// FIX 1 — use SESSION_DIR from env (critical for server.js multi-instance)
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, "session")

// FIX 2 — Termux sets PREFIX system-wide, delete it before anything loads
delete process.env.PREFIX
// FIX 3 — respect BOT_PREFIX from env (server.js passes it)
const BOT_PREFIX = process.env.BOT_PREFIX || "."

for (const d of [CMD_DIR, LIB_DIR, UTILS_DIR, SESSION_DIR])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
