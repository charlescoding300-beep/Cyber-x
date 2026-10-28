#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-zenxbadge.js — ZENX | wires the badge into index.js
//
//  Usage (from ~/zenx-bot):   node patch-zenxbadge.js index.js
//
//  Needs core/zenxbadge.js next to commands/ (copy it into core/ first).
//  Two edits, each must match EXACTLY ONE place, otherwise nothing changes:
//    1. require core/zenxbadge
//    2. attach the badge to every session socket (after autoTag)
//  Makes index.js.bak-zenxbadge first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'index.js'
const BAK = FILE + '.bak-zenxbadge'
const CORE = path.join(path.dirname(FILE), 'core', 'zenxbadge.js')

if (!fs.existsSync(CORE)) {
  console.error('✗ core/zenxbadge.js not found next to index.js. Copy it into core/ first.')
  process.exit(1)
}

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

if (src.includes('core/zenxbadge')) {
  console.log('✔ index.js already has the ZENX badge wired in — nothing to do.')
  process.exit(0)
}

swapOnce(
  'require core/zenxbadge',
  'const sessionExecutor = require("./core/sessionexec")',
  'const sessionExecutor = require("./core/sessionexec")\nconst zenxBadge = require("./core/zenxbadge")'
)

swapOnce(
  'attach the badge to every session socket',
  '  autoTag.autoTagAttach(state, sock)',
  '  autoTag.autoTagAttach(state, sock)\n  zenxBadge.attach(sock)'
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
