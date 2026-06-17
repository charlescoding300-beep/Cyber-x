// ─────────────────────────────────────────────────────────────────────────────
// lib/goodbye.js  —  CYBER X
//
// Compatibility shim — exported so lib loader picks it up cleanly.
// All actual goodbye logic lives in lib/groupParticipants.js
// ─────────────────────────────────────────────────────────────────────────────

const {
  DEFAULT_GOODBYE,
  GOODBYE_IMAGE,
  fillTemplate,
} = require("./groupParticipants")

module.exports = { DEFAULT_GOODBYE, GOODBYE_IMAGE, fillTemplate }
