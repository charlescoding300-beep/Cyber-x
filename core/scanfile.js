'use strict'

// ════════════════════════════════════════════════════════════════════
//  core/scanfile.js — ZEN X | defensive file analysis for .scanfile
//
//  • findSourceFile(text)  guesses which command file produced a bot message,
//                          by matching the message text against the bot's own files
//  • scanCode(text)        lists what a script does and flags risky patterns
//  • scanDocument(buffer)  does the same for a file someone sent you
//  • redact(text)          hides every secret-looking value before anything is shown
//
//  Nothing here runs the file. It only reads the text and reports on it.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SECRET_MARK = '••••'
const LEVELS = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

// ── secrets: found first, then hidden everywhere ─────────────────────────────
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_\-]{30,}/g,                                  // Google / Gemini keys
  /\b\d{8,10}:[A-Za-z0-9_\-]{30,}\b/g,                         // Telegram bot tokens
  /\bsk-[A-Za-z0-9_\-]{20,}\b/g,                               // OpenAI-style keys
  /(?:KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH)\w*\s*(?:\|\||\?\?|=|:)\s*['"`]([^'"`\s]{5,})['"`]/gi, // KEY = 'value'
  /(?:api[_-]?key|apikey|token|secret|password)["'\s:=]+["']?([A-Za-z0-9_\-]{12,})["']?/gi,       // key: value
]

function redact(text) {
  let out = String(text || '')
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (whole, value) => {
      const secret = typeof value === 'string' ? value : whole
      return whole.replace(secret, SECRET_MARK)
    })
  }
  return out
}

function countSecrets(text) {
  let n = 0
  for (const re of SECRET_PATTERNS) {
    const m = String(text || '').match(re)
    if (m) n += m.length
  }
  return n
}

// ── what a script does ───────────────────────────────────────────────────────
const RULES = [
  { id: 'shell-pipe', level: 'CRITICAL', label: 'downloads and runs a script straight away (curl/wget piped to a shell)', re: /(curl|wget)[^\n|]*\|\s*(ba|z|k)?sh\b/gi },
  { id: 'destructive', level: 'CRITICAL', label: 'deletes files recursively (rm -rf or recursive delete)', re: /\brm\s+-[a-z]*r[a-z]*f?\s+\/|\brmSync\([^)]*recursive\s*:\s*true|\bfs\.rm\([^)]*recursive\s*:\s*true|\brm\s+-rf\b/gi },
  { id: 'eval', level: 'HIGH', label: 'runs text as code (eval / new Function)', re: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/g },
  { id: 'spawn', level: 'HIGH', label: 'runs system commands (child_process)', re: /\bchild_process\b|\bexecSync?\s*\(|\bspawnSync?\s*\(|\bexecFile(Sync)?\s*\(/g },
  { id: 'remote-code', level: 'HIGH', label: 'loads code from the internet at run time', re: /\bimport\s*\(\s*['"`]https?:|require\s*\(\s*['"`]https?:/g },
  { id: 'base64-blob', level: 'MEDIUM', label: 'contains a large encoded block (often hides code)', re: /[A-Za-z0-9+/]{400,}={0,2}/g },
  { id: 'file-delete', level: 'MEDIUM', label: 'deletes files', re: /\bunlink(Sync)?\s*\(|\bfs\.rm(Sync)?\s*\(|\bfs\.rmdir/g },
  { id: 'file-write', level: 'LOW', label: 'writes files to disk', re: /\bwriteFile(Sync)?\s*\(|\bcreateWriteStream\s*\(/g },
  { id: 'env-read', level: 'INFO', label: 'reads environment variables (.env settings)', re: /process\.env\b/g },
  { id: 'network', level: 'LOW', label: 'talks to the internet', re: /\bfetch\s*\(|\baxios(\.\w+)?\s*\(|\bhttps?\.(get|request)\s*\(/g },
]

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function scanCode(rawText) {
  const text = String(rawText || '')
  const findings = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    const lines = []
    let m
    while ((m = rule.re.exec(text)) !== null) {
      lines.push(lineOf(text, m.index))
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++
    }
    if (lines.length) findings.push({ id: rule.id, level: rule.level, label: rule.label, count: lines.length, lines: [...new Set(lines)].slice(0, 6) })
  }

  const hosts = [...new Set((text.match(/https?:\/\/([a-zA-Z0-9.-]+)/g) || []).map(u => u.replace(/^https?:\/\//, '').toLowerCase()))]
  const envVars = [...new Set((text.match(/process\.env\.([A-Z0-9_]+)/g) || []).map(v => v.replace('process.env.', '')))]
  const packages = [...new Set((text.match(/require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g) || []).map(r => r.replace(/require\(\s*['"]|['"]\s*\)/g, '')))]
  const secrets = countSecrets(text)
  if (secrets) findings.push({ id: 'secret', level: 'HIGH', label: 'contains a hardcoded key or token (hidden in this report)', count: secrets, lines: [] })

  const top = findings.reduce((best, f) => (LEVELS.indexOf(f.level) > LEVELS.indexOf(best) ? f.level : best), 'INFO')
  return { risk: findings.length ? top : 'INFO', findings, hosts, envVars, packages, secrets }
}

// ── which of the bot's own files produced a message ──────────────────────────
const SCAN_DIRS = ['commands', 'core', 'lib']

function fragmentsOf(source) {
  const out = []
  const re = /'([^'\\\n]{10,})'|"([^"\\\n]{10,})"|`([^`\n]{10,})`/g
  let m
  while ((m = re.exec(source)) !== null) {
    const frag = (m[1] || m[2] || m[3] || '').replace(/\$\{[^}]*\}/g, '')
    if (frag.length >= 10) out.push(frag)
  }
  return out
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

function findSourceFile(messageText, baseDir) {
  const target = norm(messageText)
  if (target.length < 12) return null
  let best = null
  for (const dir of SCAN_DIRS) {
    const full = path.join(baseDir, dir)
    let files = []
    try { files = fs.readdirSync(full).filter(f => /\.(c|m)?js$/.test(f)) } catch { continue }
    for (const f of files) {
      const file = path.join(full, f)
      let source = ''
      try { source = fs.readFileSync(file, 'utf8') } catch { continue }
      const matched = fragmentsOf(source).filter(frag => norm(frag).length >= 8 && target.includes(norm(frag)))
      const unique = [...new Set(matched)]
      const score = unique.length
      const longest = unique.reduce((n, s) => Math.max(n, s.length), 0)
      if (score < 2 && longest < 25) continue
      const cmd = (source.match(/\bname\s*:\s*['"]([^'"]+)['"]/) || [])[1] || f.replace(/\.(c|m)?js$/, '')
      const candidate = { file: path.relative(baseDir, file), command: cmd, score, longest, matched: unique.slice(0, 4) }
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.longest > best.longest)) best = candidate
    }
  }
  return best
}

// ── files someone sent you ───────────────────────────────────────────────────
const TEXT_EXT = /\.(js|cjs|mjs|ts|py|sh|bash|txt|md|json|html|htm|php|rb|pl|ps1|bat|cmd|yml|yaml|xml|csv|env|cfg|ini)$/i

function magicOf(buf) {
  const h = buf.subarray(0, 12)
  if (h[0] === 0x50 && h[1] === 0x4b) return 'ZIP archive (zip, apk, docx, jar…)'
  if (h[0] === 0x7f && h[1] === 0x45 && h[2] === 0x4c && h[3] === 0x46) return 'Linux program (ELF binary)'
  if (h[0] === 0x4d && h[1] === 0x5a) return 'Windows program (EXE/DLL)'
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return 'PDF document'
  if (h.toString('latin1', 4, 8) === 'ftyp') return 'video or audio (MP4 family)'
  if (h[0] === 0xff && h[1] === 0xd8) return 'JPEG image'
  if (h[0] === 0x89 && h[1] === 0x50) return 'PNG image'
  if (h.toString('latin1', 0, 4) === 'RIFF') return 'RIFF media (WebP, WAV, AVI…)'
  return null
}

function scanDocument(buf, fileName = '') {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
  const looksText = buf.subarray(0, 2048).every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128)
  const kind = magicOf(buf)
  const base = { fileName, size: buf.length, sha256, kind, text: false }

  if (kind && !TEXT_EXT.test(fileName)) {
    return { ...base, risk: kind.includes('Windows') || kind.includes('ELF') ? 'HIGH' : 'INFO', findings: [], note: 'Binary file: not opened, only its type is shown. Do not run programs from people you do not trust.' }
  }
  if (!looksText) {
    return { ...base, risk: 'INFO', findings: [], note: 'Binary file: not opened, only its type is shown.' }
  }
  const text = buf.toString('utf8')
  const report = scanCode(text)
  return { ...base, text: true, ...report, note: null }
}

module.exports = { redact, countSecrets, scanCode, findSourceFile, scanDocument, magicOf, LEVELS, SECRET_MARK, RULES }
