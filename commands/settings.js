// ─────────────────────────────────────────────────────────
//  lib/settings.js
//  Auto-loaded by index.js — no require() needed in index.
//
//  Render: set these in Dashboard → Environment
//    OWNER_NUMBER   e.g.  2348012345678
//    BOT_NAME       optional, default CYBER X
//    PREFIX         optional, default  .
// ─────────────────────────────────────────────────────────

const settings = {
  botName: process.env.BOT_NAME     || "𝘾𝙔𝘽𝙀𝙍 𝙓",
  prefix:  process.env.PREFIX       || ".",
  owner:   process.env.OWNER_NUMBER || "YOUR_NUMBER_HERE",
}

module.exports = { settings }
