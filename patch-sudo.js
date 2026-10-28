#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-sudo.js — ZEN X | wires SUDO into index.js
//
//  Usage (from ~/zenx-bot):   node patch-sudo.js index.js
//
//  Three small edits, each must match EXACTLY ONE place, otherwise nothing
//  is changed:
//    1. require core/sudostore
//    2. private mode lets sudo users through
//    3. a logged-out session's sudo list is deleted
//  Makes index.js.bak-sudo first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK = FILE + '.bak-sudo'

const original = fs.readFileSync(FILE, 'utf8')
let src = original

function abort(msg) {
  console.error('✗ PATCH ABORTED — ' + msg)
  console.error('  index.js was NOT modified.')
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

if (src.includes('core/sudostore')) {
  console.log('✔ index.js already has sudo wired in — nothing to do.')
  process.exit(0)
}

// 1 — require
swapOnce(
  'require sudostore',
  'const sessionExecutor = require("./core/sessionexec")',
  'const sessionExecutor = require("./core/sessionexec")\nconst sudoStore = require("./core/sudostore")'
)

// 2 — private mode lets sudo users through
swapOnce(
  'private mode bypass for sudo users',
  `function isBlockedByPrivateMode(state, isOwner, fromMe, sender, senderAlt) {
  if (isOwner || fromMe) return false
  if (!isPrivateLockdownActive(state)) return false
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)
  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n))) return false
  return true
}`,
  `function isBlockedByPrivateMode(state, isOwner, fromMe, sender, senderAlt) {
  if (isOwner || fromMe) return false
  if (!isPrivateLockdownActive(state)) return false
  const candidates = [sender, senderAlt].filter(Boolean).map(normalizeNum)
  if (SUDO_NUMBERS.length && candidates.some(n => SUDO_NUMBERS.includes(n))) return false
  // per-session sudo list added with .sudo — persistent, survives restarts
  if (sudoStore.isSudo(normalizeNum(state.phone), candidates)) return false
  return true
}`
)

// 3 — drop this session's sudo list when it is logged out / removed
swapOnce(
  'clean up sudo list on removeSession',
  '  // Wipe auth folder',
  '  // Drop this session\'s sudo list (logout / removal)\n  try { sudoStore.wipe(clean) } catch {}\n\n  // Wipe auth folder'
)

fs.writeFileSync(BAK, original)
fs.writeFileSync(FILE, src)

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' })
  console.log('\n✔ Syntax check passed.')
  console.log('✔ Backup saved as ' + BAK + '   (undo: cp ' + BAK + ' ' + FILE + ')')
  console.log('  Restart the bot now (e.g. pm2 restart all).')
} catch (e) {
  fs.writeFileSync(FILE, original)
  console.error('\n✗ Syntax check FAILED — original index.js restored.')
  console.error(String(e.stderr || e.message))
  process.exit(1)
}

