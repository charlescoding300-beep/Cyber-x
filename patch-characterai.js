#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-characterai.js — ZEN X | wires the Character AI into index.js
//
//  Usage (from ~/zenx-bot):   node patch-characterai.js index.js
//
//  Three edits, each must match EXACTLY ONE place, otherwise nothing changes:
//    1. require core/characterai
//    2. attach the AI listener to every session socket (after autoTag)
//    3. delete a logged-out session's AI config and memory
//  Makes index.js.bak-characterai first, runs node --check, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK = FILE + '.bak-characterai'

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

if (src.includes('core/characterai')) {
  console.log('✔ index.js already has the Character AI wired in — nothing to do.')
  process.exit(0)
}

swapOnce(
  'require core/characterai',
  'const sessionExecutor = require("./core/sessionexec")',
  'const sessionExecutor = require("./core/sessionexec")\nconst charAi = require("./core/characterai")'
)

swapOnce(
  'attach the Character AI listener to every session',
  '  autoTag.autoTagAttach(state, sock)',
  '  autoTag.autoTagAttach(state, sock)\n  charAi.attach(state, sock)'
)

swapOnce(
  'clean up the Character AI config and memory on removeSession',
  '  // Wipe auth folder',
  '  try { charAi.wipe(clean) } catch {}\n\n  // Wipe auth folder'
)

fs.writeFileSync(BAK, original)
fs.writeFileSync(FILE, src)

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' })
  console.log('\n✔ Syntax check passed.')
  console.log('✔ Backup saved as ' + BAK + '   (undo: cp ' + BAK + ' ' + FILE + ')')
  console.log('  Restart the bot now (e.g. pm2 restart all --update-env).')
} catch (e) {
  fs.writeFileSync(FILE, original)
  console.error('\n✗ Syntax check FAILED — original index.js restored.')
  console.error(String(e.stderr || e.message))
  process.exit(1)
}
