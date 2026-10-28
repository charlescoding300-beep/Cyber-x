#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-statusbg.js — ZEN X | random background behind group TEXT statuses
//
//  Usage (from ~/zenx-bot):   node patch-statusbg.js commands/gcstatus.js
//
//  Needs: core/cardbg.js (the new one), and patch-cardbg.js already applied.
//  One edit, to exactly one place (the text status builder):
//    each text status gets a random background (never the same as the one before).
//  Makes commands/gcstatus.js.bak-statusbg first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'commands/gcstatus.js'
const BAK = FILE + '.bak-statusbg'
const CORE = path.join(path.dirname(FILE), '..', 'core', 'cardbg.js')

if (!fs.existsSync(CORE)) {
  console.error('✗ core/cardbg.js not found next to commands/. Copy the new core/cardbg.js into core/ first.')
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

if (src.includes('pickStatusBackground')) {
  console.log('✔ gcstatus.js already sets a random text-status background — nothing to do.')
  process.exit(0)
}

if (!src.includes('const gcCardBg = require("../core/cardbg")')) {
  abort('gcstatus.js has no cardbg wiring yet. Run patch-cardbg.js first, then this patch.')
}

// The two shapes the text status builder can have. Exactly one must match.
const VARIANTS = [
  {
    label: 'text status builder (ext object)',
    find: '  if (preview) applyPreview(ext, preview)',
    repl: '  if (preview) applyPreview(ext, preview)\n  ext.backgroundArgb = gcCardBg.pickStatusBackground()',
  },
  {
    label: 'text status builder (generated content)',
    find: '  inner.extendedTextMessage.contextInfo = {',
    repl: '  inner.extendedTextMessage.backgroundArgb = gcCardBg.pickStatusBackground()\n  inner.extendedTextMessage.contextInfo = {',
  },
]

const hits = VARIANTS.filter(v => count(src, v.find) === 1)
if (hits.length !== 1) {
  abort(`text status builder not recognised (matches: ${hits.length}). Paste the buildTextStatus function here so it can be matched.`)
}

const v = hits[0]
src = src.replace(v.find, v.repl)
console.log('  ✔ ' + v.label + ': random background set on every text status')

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

