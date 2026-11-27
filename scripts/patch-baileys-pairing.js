// Keep Baileys from returning a pairing code before WhatsApp acknowledges it.
"use strict"
const fs = require("fs")
const path = require("path")

const entry = process.env.BAILEYS_SOCKET_ENTRY ||
  require.resolve("@whiskeysockets/baileys")
const socketPath = process.env.BAILEYS_SOCKET_PATH ||
  path.join(path.dirname(entry), "Socket", "socket.js")

const source = fs.readFileSync(socketPath, "utf8")
const start = source.indexOf("const requestPairingCode = async")
if (start < 0) throw new Error("Baileys requestPairingCode function was not found")
const end = source.indexOf("async function generatePairingKey()", start)
if (end < 0) throw new Error("Baileys pairing-key helper was not found")

const section = source.slice(start, end)
if (section.includes("await query({")) {
  console.log("[PAIRING PATCH] WhatsApp acknowledgement wait is present")
  process.exit(0)
}
if (!section.includes("await sendNode({")) {
  throw new Error("Unexpected Baileys pairing implementation; patch not applied")
}
const updated = source.slice(0, start) +
  section.replace("await sendNode({", "await query({") +
  source.slice(end)
fs.writeFileSync(socketPath, updated)
console.log("[PAIRING PATCH] requestPairingCode now waits for WhatsApp's IQ response")
