#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-gcstatus-reliable.js — ZEN X | makes .gcstatus wait for each step
//
//  Usage (from ~/zenx-bot):   node patch-gcstatus-reliable.js commands/gcstatus.js
//
//  Needs core/gcqueue.js next to commands/ (copy it into core/ first).
//  Six edits, each must match EXACTLY ONE place, otherwise nothing changes:
//    1. require core/gcqueue
//    2. download: retries (3 tries, 90s each) and rejects a non-media download
//    3. upload (single post): retries (3 tries, 150s each)
//    4. upload (.gcstatus all): retries (3 tries, 150s each)
//    5. relay: retries (2 tries) with the SAME message id, so a retry cannot double-post
//    6. media posts run one at a time per session
//  Makes commands/gcstatus.js.bak-reliable first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'commands/gcstatus.js'
const BAK = FILE + '.bak-reliable'
const CORE = path.join(path.dirname(FILE), '..', 'core', 'gcqueue.js')

if (!fs.existsSync(CORE)) {
  console.error('✗ core/gcqueue.js not found next to commands/. Copy it into core/ first.')
  process.exit(1)
}

const original = fs.readFileSync(FILE, 'utf8')
let src = original

function abort(msg) {
  console.error('✗ PATCH ABORTED — ' + msg)
  console.error('  ' + FILE + ' was NOT modified.')
  process.exit(1)
}

function count(s, find) {
  let n = 0, i = -1
  while ((i = s.indexOf(find, i + 1)) !== -1) n++
  return n
}

function swapOnce(label, find, repl) {
  const n = count(src, find)
  if (n !== 1) abort(`${label}: expected 1 match, found ${n}`)
  const i = src.indexOf(find)
  src = src.slice(0, i) + repl + src.slice(i + find.length)
  console.log('  ✔ ' + label)
}

if (src.includes('core/gcqueue')) {
  console.log('✔ gcstatus.js already uses core/gcqueue — nothing to do.')
  process.exit(0)
}

// 1 — require the helpers
swapOnce(
  'require core/gcqueue',
  'const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"',
  'const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"\nconst gcq = require("../core/gcqueue")'
)

// 2 — download: retries + usable-media check; the original function becomes downloadMediaOnce
swapOnce(
  'download: retries and media check',
  'async function downloadMedia(sock, node, type, quoted, from) {',
  [
    'async function downloadMedia(sock, node, type, quoted, from) {',
    '  const buffer = await gcq.withStage("download " + type, () => downloadMediaOnce(sock, node, type, quoted, from), { attempts: 3, timeoutMs: 90000, backoffMs: 2000 })',
    '  gcq.assertUsableMedia(buffer, type)',
    '  return buffer',
    '}',
    '',
    'async function downloadMediaOnce(sock, node, type, quoted, from) {',
  ].join('\n')
)

// 3 — upload for a single post: retries
swapOnce(
  'upload (single post): retries',
  [
    '  const prepared = await generateWAMessageContent(',
    '    { ...input, groupStatus: true },',
    '    {',
    '      upload: sock.waUploadToServer,',
    '      logger: Pino({ level: "silent" }),',
    '    }',
    '  )',
  ].join('\n'),
  [
    '  const prepared = await gcq.withStage("upload", () => generateWAMessageContent(',
    '    { ...input, groupStatus: true },',
    '    {',
    '      upload: sock.waUploadToServer,',
    '      logger: Pino({ level: "silent" }),',
    '    }',
    '  ), { attempts: 3, timeoutMs: 150000, backoffMs: 3000 })',
  ].join('\n')
)

// 4 — upload for .gcstatus all: retries
swapOnce(
  'upload (.gcstatus all): retries',
  [
    '  const prepared = await generateWAMessageContent(',
    '    { ...input, groupStatus: true },',
    '    { upload: sock.waUploadToServer, logger: Pino({ level: "silent" }) }',
    '  )',
  ].join('\n'),
  [
    '  const prepared = await gcq.withStage("upload", () => generateWAMessageContent(',
    '    { ...input, groupStatus: true },',
    '    { upload: sock.waUploadToServer, logger: Pino({ level: "silent" }) }',
    '  ), { attempts: 3, timeoutMs: 150000, backoffMs: 3000 })',
  ].join('\n')
)

// 5 — relay: a retry reuses the same message id, so the server treats it as the same message
swapOnce(
  'relay: retries with the same message id',
  '  await sock.relayMessage(group.id, status.message, { messageId: status.key.id })',
  '  await gcq.withStage("relay", () => sock.relayMessage(group.id, status.message, { messageId: status.key.id }), { attempts: 2, timeoutMs: 60000, backoffMs: 1500 })'
)

// 6 — media posts run one at a time per session
swapOnce(
  'media posts: one at a time per session',
  [
    '        status = flat',
    '          ? await sendFlatMedia(sock, group.id, content)',
    '          : await sendWrappedMedia(sock, group.id, content)',
  ].join('\n'),
  [
    '        status = await gcq.enqueue(sock.user?.id || from, () => (flat',
    '          ? sendFlatMedia(sock, group.id, content)',
    '          : sendWrappedMedia(sock, group.id, content)))',
  ].join('\n')
)

fs.writeFileSync(BAK, original)
fs.writeFileSync(FILE, src)

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' })
  console.log('\n✔ Syntax check passed.')
  console.log('✔ Backup saved as ' + BAK + '   (undo: cp ' + BAK + ' ' + FILE + ')')
  console.log('  Restart the bot now: pm2 restart all --update-env')
} catch (e) {
  fs.writeFileSync(FILE, original)
  console.error('\n✗ Syntax check FAILED — original restored.')
  console.error(String(e.stderr || e.message))
  process.exit(1)
}
