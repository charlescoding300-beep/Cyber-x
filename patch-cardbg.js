#!/usr/bin/env node
'use strict'
// ════════════════════════════════════════════════════════════════════
//  patch-cardbg.js — ZEN X | rotating colour background for link cards
//
//  Usage (from ~/zenx-bot):   node patch-cardbg.js commands/gcstatus.js
//
//  Needs core/cardbg.js. Three edits, each must match EXACTLY ONE place:
//    1. require core/cardbg
//    2. a link with no picture gets the next colour background
//    3. the final card also gets a background if it still has none
//  Makes commands/gcstatus.js.bak-cardbg first, runs `node --check`, restores on failure.
//  Safe to run twice.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const FILE = process.argv[2] || 'commands/gcstatus.js'
const BAK = FILE + '.bak-cardbg'
const CORE = path.join(path.dirname(FILE), '..', 'core', 'cardbg.js')

if (!fs.existsSync(CORE)) {
  console.error('✗ core/cardbg.js not found next to commands/. Copy it into core/ first.')
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

if (src.includes('core/cardbg')) {
  console.log('✔ gcstatus.js already uses the rotating card background — nothing to do.')
  process.exit(0)
}

// 1 — require
swapOnce(
  'require core/cardbg',
  'const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"',
  'const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"\nconst gcCardBg = require("../core/cardbg")'
)

// 2 — no picture on the page → next colour background
swapOnce(
  'no-picture link gets the next colour',
  [
    '  if (!image) {',
    '    diag.error = "no picture found on the page"',
    '    return { preview, diag }',
    '  }',
  ].join('\n'),
  [
    '  if (!image) {',
    '    diag.error = "no picture found on the page"',
    '    if (!preview.jpegThumbnail) preview.jpegThumbnail = await gcCardBg.makeCardBackground(gcCardBg.hostOf(canonicalUrl), title).catch(() => null)',
    '    return { preview, diag }',
    '  }',
  ].join('\n')
)

// 3 — the final card: if it still has no background, give it the next colour
swapOnce(
  'final card gets a background when it has none',
  [
    '  return { preview, diag }',
    '}',
    '',
    'function applyPreview(ext, preview) {',
  ].join('\n'),
  [
    '  if (!preview.jpegThumbnail) preview.jpegThumbnail = await gcCardBg.makeCardBackground(gcCardBg.hostOf(canonicalUrl), title).catch(() => null)',
    '  return { preview, diag }',
    '}',
    '',
    'function applyPreview(ext, preview) {',
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

