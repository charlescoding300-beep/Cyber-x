#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-vmute.js — ZEN X | wires the persistent mute into index.js
//
//  Usage (from ~/zenx-bot):   node patch-vmute.js index.js
//
//  Three edits, each must match EXACTLY ONE place, otherwise nothing changes:
//    1. require core/vmute
//    2. attach mute enforcement to every session socket (after autoTag)
//    3. delete a logged-out session's mute list
//  Makes index.js.bak-vmute first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK = FILE + '.bak-vmute'

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

if (src.includes('core/vmute')) {
  console.log('✔ index.js already has the persistent mute wired in — nothing to do.')
  process.exit(0)
}

// the old hook must be removed first, or two enforcers would run and delete twice
if (src.includes('vmuteAttach(') || src.includes('commands/vmute') || src.includes('lib.handleVmute')) {
  abort('index.js still references the OLD vmute hook (vmuteAttach / commands/vmute / lib.handleVmute). ' +
        'Delete those lines first, then run this patch again.')
}

// 1 — require
swapOnce(
  'require core/vmute',
  'const sessionExecutor = require("./core/sessionexec")',
  'const sessionExecutor = require("./core/sessionexec")\nconst vmuteCore = require("./core/vmute")'
)

// 2 — attach enforcement to every session socket (runs again after each reconnect)
swapOnce(
  'attach mute enforcement to every session',
  '  autoTag.autoTagAttach(state, sock)',
  '  autoTag.autoTagAttach(state, sock)\n  vmuteCore.attach(state, sock)'
)

// 3 — delete the mute list when the session is logged out / removed
swapOnce(
  'clean up mute list on removeSession',
  '  // Wipe auth folder',
  '  // Drop this session\'s mute list (logout / removal)\n  try { vmuteCore.wipe(clean) } catch {}\n\n  // Wipe auth folder'
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
