// patch-termination.js
// Wires core/termination.js into index.js: one require, one attach() call
// inside startBot (same place vmuteCore/autoTag/charAi attach), and adds
// "termination" to the two admin-required command sets so the .termination
// command itself can only be toggled by a group admin.
//
// Run from your bot folder:
//   node patch-termination.js
//   node patch-termination.js --dry     (show only, no writes)
//   node patch-termination.js --undo    (restore from the .bak-termination backup)
'use strict'
const fs = require('fs')
const path = require('path')

const DRY = process.argv.includes('--dry')
const UNDO = process.argv.includes('--undo')
const FILE = path.join(process.cwd(), 'index.js')
const BAK = FILE + '.bak-termination'

if (UNDO) {
  if (!fs.existsSync(BAK)) { console.log('✗ No backup found at', BAK); process.exit(1) }
  fs.copyFileSync(BAK, FILE)
  console.log('✔ Restored index.js from', BAK)
  process.exit(0)
}

if (!fs.existsSync(FILE)) { console.log('✗ index.js not found in', process.cwd()); process.exit(1) }
let src = fs.readFileSync(FILE, 'utf8')

if (src.includes('core/termination') && src.includes('termination.attach(')) {
  console.log('• Already patched — nothing to do.')
  process.exit(0)
}

let changed = 0

// 1) require
{
  const anchor = 'const vmuteCore = require("./core/vmute")'
  if (src.includes(anchor) && !src.includes('require("./core/termination")')) {
    src = src.replace(anchor, `${anchor}\nconst termination = require("./core/termination")`)
    changed++
    console.log('✔ added require("./core/termination")')
  } else if (!src.includes('require("./core/termination")')) {
    console.log('✗ could not find the vmuteCore require line to anchor on — add manually: const termination = require("./core/termination")')
  }
}

// 2) attach() call inside startBot, right after vmuteCore.attach(state, sock)
{
  const anchor = 'vmuteCore.attach(state, sock)'
  if (src.includes(anchor) && !src.includes('termination.attach(state, sock)')) {
    src = src.replace(anchor, `${anchor}\n  termination.attach(state, sock)`)
    changed++
    console.log('✔ added termination.attach(state, sock)')
  } else if (!src.includes('termination.attach(state, sock)')) {
    console.log('✗ could not find vmuteCore.attach(state, sock) to anchor on — add manually right after it')
  }
}

// 3) admin-required command sets
for (const setName of ['COMMANDS_NEEDING_GROUP_ADMIN_CONTEXT', 'COMMANDS_REQUIRING_SENDER_GROUP_ADMIN']) {
  const re = new RegExp(`(const ${setName} = new Set\\(\\[[\\s\\S]*?)("warn",?\\s*\\n\\]\\))`)
  const m = re.exec(src)
  if (!m) { console.log(`✗ could not find ${setName} to patch — add "termination" to it manually`); continue }
  if (m[0].includes('"termination"')) { console.log(`• ${setName} already includes "termination"`); continue }
  const replacement = m[1] + '"warn", "termination",\n])'
  src = src.slice(0, m.index) + replacement + src.slice(m.index + m[0].length)
  changed++
  console.log(`✔ added "termination" to ${setName}`)
}

if (!changed) { console.log('Nothing changed.'); process.exit(1) }

console.log(`\n${DRY ? 'Would write' : 'Writing'} index.js (${changed} change(s))`)
if (DRY) process.exit(0)

if (!fs.existsSync(BAK)) fs.copyFileSync(FILE, BAK)
fs.writeFileSync(FILE, src)

try {
  require('child_process').execSync(`node --check "${FILE}"`, { stdio: 'pipe' })
  console.log('✔ syntax check passed')
} catch (e) {
  fs.copyFileSync(BAK, FILE)
  console.log('✗ patched file failed syntax check — reverted automatically. Error:')
  console.log(e.stderr?.toString() || e.message)
  process.exit(1)
}

console.log('✔ Done. Restart the bot.')
