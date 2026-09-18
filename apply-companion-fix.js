/**
 * Patches @whiskeysockets/baileys@7.0.0-rc14 to handle WhatsApp's
 * <notification type="companion_reg_refresh"> stage, which current Baileys
 * acks and silently drops — leaving pairing stuck on "Logging in..."
 * forever because the server rotated the adv secret and Baileys never
 * picked up the new value.
 *
 * Adapted (trimmed to the pairing-code path) from the verified fix in
 * WhiskeySockets/Baileys PR #2765 and #2602, as vendored by
 * evolution-foundation/evolution-api PR #2727.
 *
 * Run this ONCE after `npm install @whiskeysockets/baileys@7.0.0-rc14`,
 * then run `npx patch-package @whiskeysockets/baileys` to freeze the
 * result into patches/@whiskeysockets+baileys+7.0.0-rc14.patch so it
 * survives future `npm install`.
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "node_modules", "@whiskeysockets", "baileys", "lib")

function readFile(p) {
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p} — did npm install @whiskeysockets/baileys@7.0.0-rc14 succeed?`)
  return fs.readFileSync(p, "utf8")
}

function writeFile(p, content) {
  fs.writeFileSync(p, content, "utf8")
  console.log(`✔ patched ${path.relative(process.cwd(), p)}`)
}

// ── 1. messages-recv.js — guard against the malformed link_code_companion_reg
//       shape that currently crashes with Boom('Invalid buffer', 400) ──────
{
  const file = path.join(ROOT, "Socket", "messages-recv.js")
  let src = readFile(file)
  const anchor = "const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');"
  if (!src.includes(anchor)) {
    throw new Error("messages-recv.js: expected anchor not found — Baileys internals changed, patch needs updating")
  }
  if (src.includes("getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub')) { break; }")) {
    console.log("… messages-recv.js already patched, skipping")
  } else {
    src = src.replace(
      anchor,
      `${anchor}\n\t\t\t\tif (!getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub')) { break; }`
    )
    writeFile(file, src)
  }
}

// ── 2. companion-reg-client-utils.js — add handleCompanionRegRefresh ───────
{
  const file = path.join(ROOT, "Utils", "companion-reg-client-utils.js")
  let src = readFile(file)

  if (src.includes("export const handleCompanionRegRefresh")) {
    console.log("… companion-reg-client-utils.js already patched, skipping")
  } else {
    if (!src.includes("import { randomBytes } from 'crypto'")) {
      src = `import { randomBytes } from 'crypto';\nimport { getBinaryNodeChild } from '../WABinary/index.js';\n` + src
    }

    src += `
/** The two children WA Web's parser accepts on this notification. */
const COMPANION_REG_REFRESH_CHILDREN = ['companion_reg_refresh', 'pair-device-rotate-qr'];

/**
 * <notification type="companion_reg_refresh"> - the server retiring an
 * unpaired companion's registration material (rotates the adv secret).
 * Trimmed for the pairing-code path: refreshQR is a no-op unless a QR
 * flow also happens to be live on this socket.
 */
export const handleCompanionRegRefresh = (node, { creds, emitCredsUpdate, refreshQR, logger }) => {
if (!COMPANION_REG_REFRESH_CHILDREN.some(tag => getBinaryNodeChild(node, tag))) {
logger.warn({ node }, 'companion_reg_refresh carries neither expected child; ignoring');
return 'ignored_malformed';
}
if (creds.me) {
logger.debug({ id: node.attrs.id }, 'companion_reg_refresh on a registered session; keeping the adv secret');
return 'ignored_registered';
}
creds.advSecretKey = randomBytes(32).toString('base64');
emitCredsUpdate({ advSecretKey: creds.advSecretKey });
logger.info({ id: node.attrs.id }, 'rotated the adv secret the server asked to retire');
refreshQR?.();
return 'rotated';
};
`
    writeFile(file, src)
  }
}

// ── 3. socket.js — actually listen for the notification ────────────────────
{
  const file = path.join(ROOT, "Socket", "socket.js")
  let src = readFile(file)

  if (src.includes("CB:notification,type:companion_reg_refresh")) {
    console.log("… socket.js already patched, skipping")
  } else {
    // 3a. pull handleCompanionRegRefresh into the Utils import
    const utilsImportRe = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/Utils\/index\.js['"];/
    const m = src.match(utilsImportRe)
    if (!m) throw new Error("socket.js: Utils/index.js import not found — Baileys internals changed")
    if (!m[1].includes("handleCompanionRegRefresh")) {
      const updated = `import {${m[1].trim()}, handleCompanionRegRefresh } from '../Utils/index.js';`
      src = src.replace(m[0], updated)
    }

    // 3b. declare refreshPairingQR + add the notification listener, anchored
    //     right after the xmlstreamend close handler (always present, always
    //     runs before any pairing IQ is registered).
    const closeAnchor = "ws.on('CB:xmlstreamend', () => void end(new Boom('Connection Terminated by Server', { statusCode: DisconnectReason.connectionClosed })));"
    if (!src.includes(closeAnchor)) {
      throw new Error("socket.js: xmlstreamend anchor not found — Baileys internals changed, patch needs updating")
    }
    const insertion = `${closeAnchor}
// Set while a pairing QR flow is live on this connection; stays
// undefined for pairing-code sessions, which is fine — refreshQR
// below is a no-op in that case.
let refreshPairingQR;
// the server retiring an unpaired companion's registration material
ws.on('CB:notification,type:companion_reg_refresh', (node) => {
handleCompanionRegRefresh(node, {
creds,
emitCredsUpdate: update => ev.emit('creds.update', update),
refreshQR: () => refreshPairingQR?.(),
logger
})
});`
    src = src.replace(closeAnchor, insertion)
    writeFile(file, src)
  }
}

console.log("\nDone. Now run:\n  npx patch-package @whiskeysockets/baileys\nto freeze this into a patches/ file, then add to package.json:\n  \"scripts\": { \"postinstall\": \"patch-package\" }")
