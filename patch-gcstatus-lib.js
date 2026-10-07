const fs = require("fs")
const path = require("path")

const PACKAGES = [
  "@systemzero/baileys",
  "@whiskeysockets/baileys",
  "baileys",
]

function __gsInner(m) {
  try {
    let c = m
    for (let i = 0; i < 6 && c; i++) {
      const n =
        c.groupStatusMessageV2?.message ||
        c.groupStatusMessage?.message ||
        c.ephemeralMessage?.message ||
        c.viewOnceMessage?.message ||
        c.viewOnceMessageV2?.message ||
        c.viewOnceMessageV2Extension?.message ||
        c.documentWithCaptionMessage?.message

      if (!n) break
      c = n
    }

    return c || m
  } catch {
    return m
  }
}

function findFiles(root) {
  const out = []

  if (!fs.existsSync(root)) return out

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)

    if (entry.isDirectory()) {
      out.push(...findFiles(full))
      continue
    }

    if (/^messages-send\.(c|m)?js$/.test(entry.name)) {
      out.push(full)
    }
  }

  return out
}

function isAlreadyPatched(src) {
  return (
    src.includes("__gsInner(") ||
    /getMediaType\)?\(\s*(?:\(0,\s*[\w$.]+\.normalizeMessageContent\)|normalizeMessageContent)\(/.test(src)
  )
}

const CALL =
  /(\(0,\s*[\w$.]+\.getMediaType\)|getMediaType)\(\s*message\s*\)/g

const ROOT = path.resolve(__dirname)

for (const pkg of PACKAGES) {
  const pkgRoot = path.join(ROOT, "node_modules", pkg)

  if (!fs.existsSync(pkgRoot)) continue

  const files = findFiles(pkgRoot)

  for (const file of files) {
    let src = fs.readFileSync(file, "utf8")

    if (isAlreadyPatched(src)) {
      console.log(`[SKIP] already patched: ${file}`)
      continue
    }

    if (!CALL.test(src)) {
      console.log(`[SKIP] no target call: ${file}`)
      continue
    }

    CALL.lastIndex = 0

    const replaced = src.replace(
      CALL,
      "$1(__gsInner(message))"
    )

    const helper = `
function __gsInner(m) {
  try {
    let c = m
    for (let i = 0; i < 6 && c; i++) {
      const n =
        c.groupStatusMessageV2?.message ||
        c.groupStatusMessage?.message ||
        c.ephemeralMessage?.message ||
        c.viewOnceMessage?.message ||
        c.viewOnceMessageV2?.message ||
        c.viewOnceMessageV2Extension?.message ||
        c.documentWithCaptionMessage?.message
      if (!n) break
      c = n
    }
    return c || m
  } catch {
    return m
  }
}
`

    const finalSrc = replaced.includes("__gsInner")
      ? replaced + helper
      : replaced

    const backup = `${file}.bak-gcstatus`

    if (!fs.existsSync(backup)) {
      fs.copyFileSync(file, backup)
      console.log(`[BACKUP] ${backup}`)
    }

    fs.writeFileSync(file, finalSrc)

    console.log(`[PATCHED] ${file}`)
  }
}
