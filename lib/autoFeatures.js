// ─────────────────────────────────────────────────────────────────────────────
// lib/autoFeatures.js  —  CYBER X
//
// NOTE (fix): This file used to duplicate auto-typing / auto-recording /
// auto-reply / auto-view-status / auto-react-status / always-online logic
// that index.js ALREADY does correctly, per-session, in
// handleOrdinaryMessage() and handleStatus(). This file's version read
// settings from the GLOBAL lib/settings.js singleton instead of each
// session's own per-phone settings — meaning if anything ever called
// `require("../lib/settings").set(...)` instead of using the settings
// object passed into a command's run(), that setting would leak to EVERY
// session at once instead of just one. It also ran its own duplicate
// always-online interval and status listener on top of index.js's correct
// ones, causing doubled presence updates.
//
// All of that duplicate logic has been removed. index.js's own per-session
// handling is the single source of truth now. Only isPrivateBlocked is
// kept since it's a plain pure function with no shared state.
//
// This file's setSocket() also previously collided by name with
// lib/isAdmin.js's setSocket() — since index.js's loader merges every
// command/lib file's exports onto one shared `lib` object, whichever file
// loaded last (alphabetically, isAdmin.js after autoFeatures.js) silently
// overwrote the other's setSocket. Renamed here to avoid that ever
// happening again for this file.
// ─────────────────────────────────────────────────────────────────────────────

function isPrivateBlocked(sender, settings) {
  if (settings.get("mode") !== "private") return false
  const ownerBase = (settings.get("owner") || "").replace(/\D/g, "")
  if (!ownerBase) return false
  return !(
    sender === ownerBase ||
    sender.startsWith(`${ownerBase}@`) ||
    sender.indexOf(ownerBase) !== -1
  )
}

module.exports = {
  isPrivateBlocked,
}
