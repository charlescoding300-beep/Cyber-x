"use strict";
const fs = require("fs");
const path = require("path");

const entry = process.env.BAILEYS_SOCKET_ENTRY || require.resolve("@whiskeysockets/baileys");
const packageDir = path.dirname(entry);
const socketPath = process.env.BAILEYS_SOCKET_PATH || path.join(packageDir, "Socket", "socket.js");
const recvPath = process.env.BAILEYS_RECV_PATH || path.join(packageDir, "Socket", "messages-recv.js");

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error("Baileys pairing patch could not find " + label);
  return source.replace(before, after);
}

function patchSocket() {
  let source = fs.readFileSync(socketPath, "utf8");
  const start = source.indexOf("const requestPairingCode = async");
  const end = source.indexOf("async function generatePairingKey()", start);
  if (start < 0 || end < 0) throw new Error("Baileys pairing-code function not found");
  let section = source.slice(start, end);

  const platformHelper = [
    "        const pairingPlatform = (() => {",
    "            const browserIds = { Chrome: \"1\", Firefox: \"2\", IE: \"3\", Opera: \"4\", Safari: \"5\", Edge: \"6\" };",
    "            const supportedOS = new Set([\"Mac OS\", \"Windows\", \"Ubuntu\"]);",
    "            const first = browser && browser[0];",
    "            const second = browser && browser[1];",
    "            const browserName = Object.prototype.hasOwnProperty.call(browserIds, first) ? first :",
    "                (Object.prototype.hasOwnProperty.call(browserIds, second) ? second : \"Chrome\");",
    "            const osName = supportedOS.has(first) ? first : (supportedOS.has(second) ? second : \"Mac OS\");",
    "            return { id: browserIds[browserName], display: browserName + \" (\" + osName + \")\" };",
    "        })();",
    "        const pairingCode = customPairingCode ?? bytesToCrockford(randomBytes(5));"
  ].join("\n");
  section = replaceOnce(section,
    "        const pairingCode = customPairingCode ?? bytesToCrockford(randomBytes(5));",
    platformHelper, "canonical pairing platform");

  const oldCreds = [
    "        authState.creds.pairingCode = pairingCode;",
    "        authState.creds.me = {",
    "            id: jidEncode(phoneNumber, 's.whatsapp.net'),",
    "            name: '~'",
    "        };",
    "        ev.emit('creds.update', authState.creds);"
  ].join("\n");
  const newCreds = [
    "        const jid = jidEncode(phoneNumber, 's.whatsapp.net');",
    "        authState.creds.pairingCode = pairingCode;"
  ].join("\n");
  section = replaceOnce(section, oldCreds, newCreds, "deferred auth identity");

  section = replaceOnce(section, "        await query({", [
    "        let pairingResponse;",
    "        try {",
    "            pairingResponse = await query({"
  ].join("\n"), "acknowledged pairing IQ");

  section = replaceOnce(section, "jid: authState.creds.me.id,", "jid,", "pairing JID");
  section = replaceOnce(section, "content: getCompanionPlatformId(browser)", "content: pairingPlatform.id", "pairing platform id");

  const displayTag = section.indexOf("tag: 'companion_platform_display'");
  const displayStart = section.indexOf("content: ", displayTag);
  const displayEnd = section.indexOf("\n", displayStart);
  if (displayTag < 0 || displayStart < 0 || displayEnd < 0) throw new Error("Baileys pairing platform display not found");
  if (!section.slice(displayStart, displayEnd).includes("pairingPlatform.display")) {
    section = section.slice(0, displayStart) + "content: pairingPlatform.display" + section.slice(displayEnd);
  }
  section = replaceOnce(section, "content: '0'", "content: Buffer.from([0])", "pairing nonce");

  const oldFooter = [
    "        });",
    "        return authState.creds.pairingCode;",
    "    };"
  ].join("\n");
  const newFooter = [
    "        });",
    "        } catch (error) {",
    "            if (authState.creds.pairingCode === pairingCode) authState.creds.pairingCode = undefined;",
    "            throw error;",
    "        }",
    "        if (!pairingResponse) throw new Error('Timed out waiting for WhatsApp pairing acknowledgement');",
    "        authState.creds.me = { id: jid, name: '~' };",
    "        ev.emit('creds.update', authState.creds);",
    "        return pairingCode;",
    "    };"
  ].join("\n");
  section = replaceOnce(section, oldFooter, newFooter, "pairing result and rollback");

  source = source.slice(0, start) + section + source.slice(end);
  source = replaceOnce(source, "        if (!creds.me) {", "        if (!creds.me || (!!creds.pairingCode && !creds.registered)) {", "pending pairing reconnect path");
  fs.writeFileSync(socketPath, source);
}

function patchReceiver() {
  let source = fs.readFileSync(recvPath, "utf8");
  const start = source.indexOf("case 'link_code_companion_reg':");
  const end = source.indexOf("case 'privacy_token':", start);
  if (start < 0 || end < 0) throw new Error("Baileys pairing notification handler not found");
  let section = source.slice(start, end);
  const oldStage = "                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));";
  const newStage = [
    "                // WhatsApp sends a ref-only notification before the phone enters the code.",
    "                if (linkCodeCompanionReg?.attrs?.stage !== 'primary_hello') break;",
    oldStage
  ].join("\n");
  section = replaceOnce(section, oldStage, newStage, "primary_hello stage guard");

  if (!section.includes("authState.creds.registered = true;")) {
    const breakAt = section.lastIndexOf("                break;");
    if (breakAt < 0) throw new Error("Baileys pairing completion point not found");
    section = section.slice(0, breakAt) + [
      "                authState.creds.registered = true;",
      "                ev.emit('creds.update', authState.creds);",
      "                break;"
    ].join("\n") + section.slice(breakAt + "                break;".length);
  }
  source = source.slice(0, start) + section + source.slice(end);
  fs.writeFileSync(recvPath, source);
}

patchSocket();
patchReceiver();
console.log("[PAIRING PATCH] canonical platform, null nonce, ack result, stage guard, and reconnect state applied");
