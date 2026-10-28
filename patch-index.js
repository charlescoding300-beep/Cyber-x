'use strict'
// 𓃦 𝗭Ξ𝗡 𝗫 — one-time patch for index.js (anti-status in group chat)
// Run ONCE from the bot's root folder:   node patch-index.js
// Edits: 1) hook in processPassive  2) expose warning counter  3) switch off old status@broadcast handler
// Safe: backup index.js.bak-antistatus, syntax check, auto-restore. Running it twice does nothing.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const file = path.join(process.cwd(), process.argv[2] || 'index.js')
if (!fs.existsSync(file)) {
  console.error(`❌ ${file} not found — run this from the bot's root folder (where index.js is)`)
  process.exit(1)
}

const original = fs.readFileSync(file, 'utf8')
if (original.includes('lib.handleAntistatusGroup')) {
  console.log('✔ index.js is already patched — nothing to do')
  process.exit(0)
}

const EOL = original.includes('\r\n') ? '\r\n' : '\n'
let src = original
const report = []

function edit(label, regex, replacer, required) {
  if (!regex.test(src)) {
    report.push(`${required ? '❌' : '⚠️'} ${label} — line not found`)
    return required ? false : true
  }
  src = src.replace(regex, replacer)
  report.push(`✅ ${label}`)
  return true
}

if (!(/function antistatusAddWarning\b/.test(src) && /function antistatusResetWarnings\b/.test(src))) {
  console.error('❌ antistatusAddWarning / antistatusResetWarnings not found in index.js — not patching')
  process.exit(1)
}

const HOOK =
  'if (typeof lib.handleAntistatusGroup === "function") ' +
  'lib.handleAntistatusGroup(sock, m, phone).catch(e => console.error("[" + phone + "] ANTISTATUS-GC ERR:", e.message))'

const ok1 = edit(
  'hook added in processPassive',
  /^([ \t]*)handleAntitagInline\(sock, m, phone\)\.catch\([^\r\n]*/m,
  (line, indent) => `${line}${EOL}${indent}${HOOK}`,
  true
)

const ok2 = edit(
  'warning counter exposed',
  /^([ \t]*)global\.__antistatusGetMode[^\r\n]*/m,
  (line, indent) =>
    `${line}${EOL}${indent}global.__antistatusAddWarning    = antistatusAddWarning` +
    `${EOL}${indent}global.__antistatusResetWarnings = antistatusResetWarnings`,
  true
)

edit(
  'old status@broadcast handler switched off',
  /^([ \t]*)(handleAntistatusInline\(sock, m, phone\)\.catch[^\r\n]*)/m,
  (line, indent, code) => `${indent}// ${code}  // replaced by lib/antistatusgc.js`,
  false
)

console.log(report.join('\n'))

if (!ok1 || !ok2) {
  console.error('\n❌ Nothing was changed. Send me the output above and I will fix the patch.')
  process.exit(1)
}

const backup = `${file}.bak-antistatus`
fs.copyFileSync(file, backup)
fs.writeFileSync(file, src)

try {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
} catch (e) {
  fs.copyFileSync(backup, file)
  console.error('\n❌ The patched file failed the syntax check — original restored.')
  console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'))
  process.exit(1)
}

console.log(`\n✔ index.js patched (backup: ${path.basename(backup)}). Restart the bot to apply.`)
