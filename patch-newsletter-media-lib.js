// patch-newsletter-media-lib.js
// ─────────────────────────────────────────────────────────────────────────────
// Fixes a confirmed bug in @whiskeysockets/baileys: images/video/audio sent to
// a WhatsApp CHANNEL (@newsletter) upload to the wrong CDN path and never show
// up — text posts work, media silently fails. (Upstream: issue #2345, fix not
// yet merged as PR #2434. Paths below are the ones that PR verified via three
// independent captures: WA Web JS, WA Desktop network traffic, and an Android
// DB hook — not a guess.)
//
// What this does to the installed library's upload function:
//   1. adds a NEWSLETTER_MEDIA_PATH_MAP (the confirmed /newsletter/newsletter-*
//      CDN paths)
//   2. makes it accept a `newsletter: true` option per upload call and, when
//      set, use that map instead of the normal one (anything that does NOT
//      pass this option — every existing group/DM/status send — is untouched)
//   3. adds the `server_thumb_gen=1` / `server_transcode=1` hints the official
//      client sends for channel uploads
//   4. makes the function's returned mediaUrl fall back to directPath when the
//      server doesn't return a plain url (channels only return directPath)
//
// commands/cs.js calls the upload function itself with { newsletter: true } —
// nothing else on the bot needs to change, and no normal send is affected.
//
// Run from your bot folder (the one with node_modules):
//     node core/patch-newsletter-media-lib.js
//     node core/patch-newsletter-media-lib.js --dry     (show only, no writes)
// Restart the bot after. Re-run after any `npm install` that reinstalls baileys.
// Safe to run repeatedly; a .bak-newsletter-media backup is kept per file.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs")
const path = require("path")

const DRY = process.argv.includes("--dry")
const PACKAGES = ["@whiskeysockets/baileys", "@systemzero/baileys", "baileys"]

const PATH_MAP_BLOCK = `
// [cs-patch] confirmed CDN paths for WhatsApp Channel (@newsletter) media —
// triangulated via WA Web JS, WA Desktop network capture, and an Android DB hook
// (WhiskeySockets/Baileys PR #2434). A normal group/DM/status upload never sees
// this map: it's only used when the caller passes { newsletter: true }.
const __NEWSLETTER_MEDIA_PATH_MAP = {
  image: '/newsletter/newsletter-image',
  video: '/newsletter/newsletter-video',
  gif: '/newsletter/newsletter-gif',
  ptt: '/newsletter/newsletter-ptt',
  audio: '/newsletter/newsletter-ptt',
  ptv: '/newsletter/newsletter-ptv',
  sticker: '/newsletter/newsletter-sticker',
  'sticker-pack': '/newsletter/newsletter-sticker-pack',
  document: '/newsletter/newsletter-document',
  'thumbnail-link': '/newsletter/newsletter-thumbnail-link',
}
const __NEWSLETTER_TRANSCODE_TYPES = new Set(['video', 'gif', 'ptv'])
`

// Loosely matches the destructuring list that pulls mediaType + fileEncSha256B64
// out of the upload call's options (works whether it's a function parameter
// pattern or a `const { ... } = opts` statement) — tolerant of spacing/order
// and of other fields already present in the list.
function patchDestructure(src) {
  const re = /\{([^{}]{0,200}\bmediaType\b[^{}]{0,200}\bfileEncSha256B64\b[^{}]{0,200}|[^{}]{0,200}\bfileEncSha256B64\b[^{}]{0,200}\bmediaType\b[^{}]{0,200})\}/
  const m = re.exec(src)
  if (!m) return { src, ok: false, reason: "couldn't find the { mediaType, fileEncSha256B64, ... } destructuring" }
  if (/\bnewsletter\b/.test(m[1])) return { src, ok: true, reason: "already includes newsletter", already: true }
  const replaced = m[0].replace(/\bmediaType\b/, "mediaType, newsletter")
  return { src: src.slice(0, m.index) + replaced + src.slice(m.index + m[0].length), ok: true }
}

// Loosely matches the template-literal line that builds the upload URL from
// the (non-newsletter) path map + fileEncSha256B64 + auth + token, whatever
// the exact accessor expression for the path map is (MEDIA_PATH_MAP,
// Defaults_1.MEDIA_PATH_MAP, (0, Defaults_1.MEDIA_PATH_MAP), etc).
function patchUrlLine(src) {
  const re = /`https:\/\/\$\{hostname\}\$\{(\(?[\w$.,\s]*?MEDIA_PATH_MAP\)?)\[\s*mediaType\s*\]\}\/\$\{fileEncSha256B64\}\?auth=\$\{auth\}&token=\$\{fileEncSha256B64\}`/
  const m = re.exec(src)
  if (!m) return { src, ok: false, reason: "couldn't find the upload-URL template literal (MEDIA_PATH_MAP[mediaType] + fileEncSha256B64 + auth + token)" }
  if (src.includes("__NEWSLETTER_MEDIA_PATH_MAP[mediaType]")) return { src, ok: true, reason: "already patched", already: true }

  const normalAccessor = m[1]
  const replacement =
    "`https://${hostname}${(newsletter && __NEWSLETTER_MEDIA_PATH_MAP[mediaType]) ? __NEWSLETTER_MEDIA_PATH_MAP[mediaType] : " + normalAccessor + "[mediaType]}" +
    "/${fileEncSha256B64}?auth=${auth}&token=${fileEncSha256B64}" +
    "${newsletter ? ('&server_thumb_gen=1' + (__NEWSLETTER_TRANSCODE_TYPES.has(mediaType) ? '&server_transcode=1' : '')) : ''}`"

  return { src: src.slice(0, m.index) + replacement + src.slice(m.index + m[0].length), ok: true }
}

// Optional polish: channels only return directPath, not url — without this the
// returned mediaUrl can end up undefined for a channel upload (harmless for us
// since cs.js only needs directPath+mediaKey, like gcstatus.js already does,
// but this keeps the library's own return value honest).
function patchMediaUrlFallback(src) {
  const re = /mediaUrl\s*:\s*result\.url!?(?!\s*\|\|)/
  const m = re.exec(src)
  if (!m) return { src, ok: false, reason: "mediaUrl: result.url line not found (not essential — skipped)" }
  return { src: src.slice(0, m.index) + "mediaUrl: result.url || result.direct_path || result.directPath" + src.slice(m.index + m[0].length), ok: true }
}

function findPackageRoot(name) {
  try {
    let dir = path.dirname(require.resolve(name, { paths: [process.cwd(), __dirname] }))
    for (let i = 0; i < 8; i++) {
      const pj = path.join(dir, "package.json")
      if (fs.existsSync(pj)) { try { if (JSON.parse(fs.readFileSync(pj, "utf8")).name === name) return dir } catch {} }
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  } catch {}
  return null
}

function findCandidateFiles(dir, depth = 0, out = []) {
  if (depth > 6) return out
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) findCandidateFiles(full, depth + 1, out)
    else if (/^messages-media\.(c|m)?js$/.test(e.name)) out.push(full)
  }
  return out
}

let patched = 0, already = 0, failed = 0, scanned = 0

for (const name of PACKAGES) {
  const root = findPackageRoot(name)
  if (!root) continue
  const files = findCandidateFiles(root)
  console.log(`\n📦 ${name}  (${root})`)
  if (!files.length) { console.log("   ✗ no compiled messages-media.js found inside this package"); failed++; continue }

  for (const file of files) {
    scanned++
    const rel = path.relative(root, file)
    let src
    try { src = fs.readFileSync(file, "utf8") } catch (e) { console.log(`   ✗ ${rel}: can't read (${e.message})`); failed++; continue }

    if (src.includes("__NEWSLETTER_MEDIA_PATH_MAP[mediaType]")) { console.log(`   • ${rel}: already patched`); already++; continue }
    if (!/MEDIA_PATH_MAP/.test(src)) { console.log(`   • ${rel}: no MEDIA_PATH_MAP in this file — not the one`); continue }

    let out = src
    const d = patchDestructure(out)
    if (!d.ok) { console.log(`   ✗ ${rel}: ${d.reason}`); failed++; continue }
    out = d.src

    const u = patchUrlLine(out)
    if (!u.ok) { console.log(`   ✗ ${rel}: ${u.reason}`); failed++; continue }
    out = u.src

    const f = patchMediaUrlFallback(out)
    out = f.src // best-effort — never fails the whole patch

    out = PATH_MAP_BLOCK + out

    console.log(`   ✔ ${rel}: ready to patch` + (f.ok ? " (incl. mediaUrl fallback)" : " (mediaUrl fallback skipped: " + f.reason + ")"))
    if (DRY) { patched++; continue }

    try {
      const bak = file + ".bak-newsletter-media"
      if (!fs.existsSync(bak)) fs.copyFileSync(file, bak)
      fs.writeFileSync(file, out)
      console.log(`   ✔ ${rel}: written`)
      patched++
    } catch (e) {
      console.log(`   ✗ ${rel}: couldn't write (${e.message})`)
      failed++
    }
  }
}

if (!scanned) {
  console.log("\n✗ None of these packages were found from this folder: " + PACKAGES.join(", "))
  console.log("  Run this from your bot folder (where node_modules is).")
  process.exit(1)
}

console.log(`\n${DRY ? "Would patch" : "Done"} — patched: ${patched}, already ok: ${already}, problems: ${failed}`)
if (patched && !DRY) console.log("➡ Restart the bot now so the patched library is loaded.")
if (failed && !patched) process.exit(1)
