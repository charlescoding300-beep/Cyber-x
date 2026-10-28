#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-antistatus.js — ZEN X | wires the group-chat anti-status into index.js
//
//  Usage (from ~/zenx-bot):   node patch-antistatus.js index.js
//
//  Two edits, each must match EXACTLY ONE place, otherwise nothing changes:
//    1. require core/antistatusgc
//    2. attach the enforcer to every session socket (after autoTag)
//  Makes index.js.bak-antistatus first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK = FILE + '.bak-antistatus'

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

if (src.includes('core/antistatusgc')) {
  console.log('✔ index.js already has the group-chat anti-status wired in — nothing to do.')
  process.exit(0)
}

// the old group-status hook would run next to the new one and delete twice
if (src.includes('handleAntistatusGroup')) {
  abort('index.js still calls handleAntistatusGroup (the old group-chat hook). ' +
        'Remove that call first, then run this patch again.')
}

swapOnce(
  'require core/antistatusgc',
  'const sessionExecutor = require("./core/sessionexec")',
  'const sessionExecutor = require("./core/sessionexec")\nconst antistatusGc = require("./core/antistatusgc")'
)

swapOnce(
  'attach group-chat anti-status to every session',
  '  autoTag.autoTagAttach(state, sock)',
  '  autoTag.autoTagAttach(state, sock)\n  antistatusGc.attach(state, sock)'
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
