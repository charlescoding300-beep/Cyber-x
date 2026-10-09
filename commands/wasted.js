'use strict'

// ════════════════════════════════════════════════════════════════════
// ZEN X | 💀 GTA WASTED Effect
// Usage:
//   .wasted @user
//   reply to someone + .wasted
//
// Caption sent with the image:  *@user Got Wasted*   (bold + real mention)
//
// FALLBACK CHAIN (so the command almost never fails):
//   1. Profile pic lookup: tries the JID, then its phone-number form
//      (for @lid users), each as 'image' then 'preview'
//   2. Download is retried once
//   3. No pic / hidden pic / download failed → a default silhouette avatar
//      is used, so you STILL get a wasted image
//   4. Render A: grayscale + "wasted" text (only used if the server's
//      fonts actually render text — checked automatically)
//   5. Render B: grayscale + built-in block letters (needs NO fonts)
//   6. Render C: default avatar + block letters (if the pic is corrupt)
//   7. Last resort: text-only message "*@user Got Wasted*"
//   8. Sending retries without the quoted reply if the quoted send fails
// ════════════════════════════════════════════════════════════════════

const sharp = require('sharp')
const https = require('https')

const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

const FONT_STACK = "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif"
const PIC_LOOKUP_TIMEOUT = 8000
const DOWNLOAD_TIMEOUT   = 15000
const MAX_DIMENSION      = 1024

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanJid(jid) {
  if (!jid || typeof jid !== 'string') return null
  return jid.replace(/:\d+(?=@)/, '')
}

// Unwraps ephemeral / view-once wrappers so contextInfo is always reachable
function unwrapMessage(message) {
  let m = message || {}
  for (let i = 0; i < 4; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      null
    if (!inner) break
    m = inner
  }
  return m
}

function getContextInfo(msg) {
  const message = unwrapMessage(msg?.message)
  for (const key of Object.keys(message)) {
    const ci = message[key]?.contextInfo
    if (ci) return ci
  }
  return {}
}

function getTarget(msg, sender, from) {
  const ctx = getContextInfo(msg)

  // 1) Replied-to user has priority
  let quoted = ctx.participant || null

  // In a private chat, replies carry no participant — the other person is the chat itself
  if (!quoted && ctx.quotedMessage && typeof from === 'string' && !from.endsWith('@g.us')) {
    quoted = from
  }

  // 2) Then an explicit @mention
  const mentioned =
    Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length
      ? ctx.mentionedJid[0]
      : null

  // 3) Otherwise the sender themself
  return cleanJid(quoted || mentioned || sender)
}

function withTimeout(promise, ms, label = 'operation') {
  let timer
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    }),
  ])
}

function errReason(e) {
  return String(e?.output?.payload?.message || e?.data || e?.message || e || '')
}

// Picture is hidden / doesn't exist — no point trying other sizes for this JID
function isHiddenError(e) {
  return /item-not-found|not-authorized|forbidden|\b40[134]\b/i.test(errReason(e))
}

async function safeSend(sock, jid, content, quoted) {
  try {
    await sock.sendMessage(jid, content, quoted ? { quoted } : {})
    return true
  } catch (e) {
    console.error('[WASTED] send failed (with quote):', errReason(e))
  }
  try {
    await sock.sendMessage(jid, content)
    return true
  } catch (e) {
    console.error('[WASTED] send failed (no quote):', errReason(e))
    return false
  }
}

// ── Download (uses fetch, falls back to https on old Node) ───────────────────

async function downloadOnce(url, timeoutMs) {
  if (typeof fetch === 'function' && typeof AbortSignal?.timeout === 'function') {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(downloadOnce(res.headers.location, timeoutMs))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('download timed out')))
    req.on('error', reject)
  })
}

async function downloadWithRetry(url) {
  try {
    return await downloadOnce(url, DOWNLOAD_TIMEOUT)
  } catch (e) {
    console.log(`[WASTED] download failed (${errReason(e)}), retrying once`)
    return await downloadOnce(url, DOWNLOAD_TIMEOUT)
  }
}

// ── Profile picture lookup with fallbacks ────────────────────────────────────

async function getCandidateJids(sock, jid) {
  const list = [jid]
  try {
    // @lid users: also try their real phone-number JID if Baileys knows it
    if (jid.endsWith('@lid')) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid)
      if (pn) {
        const pnJid = cleanJid(String(pn).includes('@') ? String(pn) : `${pn}@s.whatsapp.net`)
        if (pnJid) list.push(pnJid)
      }
    }
  } catch (e) {
    console.log('[WASTED] LID→PN lookup skipped:', errReason(e))
  }
  return [...new Set(list.filter(Boolean))]
}

// Returns a Buffer, or null if no usable picture could be fetched
async function getProfilePicBuffer(sock, targetJid) {
  const candidates = await getCandidateJids(sock, targetJid)

  for (const jid of candidates) {
    for (const type of ['image', 'preview']) {
      try {
        console.log(`[WASTED] profile pic lookup: ${jid} (${type})`)
        const url = await withTimeout(
          sock.profilePictureUrl(jid, type),
          PIC_LOOKUP_TIMEOUT,
          'profile picture lookup'
        )
        if (!url) break              // no picture → next JID

        const buf = await downloadWithRetry(url)
        if (buf?.length) {
          console.log(`[WASTED] picture ready: ${buf.length} bytes`)
          return buf
        }
      } catch (e) {
        console.log(`[WASTED] ${jid} (${type}) failed: ${errReason(e)}`)
        if (isHiddenError(e)) break  // hidden / none → skip other sizes
      }
    }
  }

  return null
}

// ── Image generation ─────────────────────────────────────────────────────────

// Simple silhouette used when the person has no (visible) profile picture
async function defaultAvatar() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">` +
    `<rect width="640" height="640" fill="#4a4f57"/>` +
    `<circle cx="320" cy="250" r="110" fill="#9aa0a8"/>` +
    `<path d="M110 640 C110 470 210 400 320 400 C430 400 530 470 530 640 Z" fill="#9aa0a8"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// Checks once whether this server can actually draw SVG text (fonts installed)
let _fontsOk = null
async function fontsWork() {
  if (_fontsOk !== null) return _fontsOk
  try {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80">` +
      `<text x="100" y="55" text-anchor="middle" font-family="${FONT_STACK}" ` +
      `font-weight="900" font-size="48" fill="#ffffff">wasted</text></svg>`
    const { data } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    let any = false
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) { any = true; break }
    }
    _fontsOk = any
  } catch {
    _fontsOk = false
  }
  console.log(`[WASTED] SVG text rendering ${_fontsOk ? 'works' : 'unavailable → using block letters'}`)
  return _fontsOk
}

// Overlay A — real text (needs fonts)
function textOverlay(W, H) {
  const fontSize  = Math.max(48, Math.floor(W * 0.15))
  const shadowOff = Math.max(2, Math.floor(W * 0.01))
  const cx = W / 2
  const cy = H * 0.52

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="0" y="${Math.floor(cy - fontSize * 1.0)}" width="${W}" height="${Math.floor(fontSize * 1.5)}" fill="#000000" opacity="0.4"/>
      <style>
        .txt {
          font-family: ${FONT_STACK};
          font-weight: 900;
          letter-spacing: ${Math.floor(W * 0.005)}px;
        }
      </style>
      <text x="${cx + shadowOff}" y="${cy + shadowOff}" text-anchor="middle"
            class="txt" font-size="${fontSize}" fill="#000000" opacity="0.55">wasted</text>
      <text x="${cx}" y="${cy}" text-anchor="middle"
            class="txt" font-size="${fontSize}" fill="#e0201a">wasted</text>
    </svg>`
}

// Overlay B — letters drawn from rectangles (needs NO fonts at all)
const GLYPHS = {
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
}

function blocksOverlay(W, H) {
  const word  = 'WASTED'
  const cols  = word.length * 5 + (word.length - 1)       // 5 cols per letter + 1 gap
  const cell  = Math.max(2, Math.floor((W * 0.8) / cols))
  const textW = cols * cell
  const textH = 7 * cell
  const x0    = Math.floor((W - textW) / 2)
  const y0    = Math.floor(H * 0.52 - textH / 2)
  const shade = Math.max(2, Math.floor(cell * 0.35))

  let main = ''
  let shadow = ''

  ;[...word].forEach((ch, li) => {
    const lx = x0 + li * 6 * cell
    GLYPHS[ch].forEach((row, r) => {
      ;[...row].forEach((bit, c) => {
        if (bit !== '1') return
        const x = lx + c * cell
        const y = y0 + r * cell
        main   += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}"/>`
        shadow += `<rect x="${x + shade}" y="${y + shade}" width="${cell}" height="${cell}"/>`
      })
    })
  })

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges">
      <rect x="0" y="${y0 - cell * 2}" width="${W}" height="${textH + cell * 4}" fill="#000000" opacity="0.4"/>
      <g fill="#000000" opacity="0.55">${shadow}</g>
      <g fill="#e0201a">${main}</g>
    </svg>`
}

// mode: 'text' | 'blocks'
async function renderWasted(inputBuf, mode) {
  // Normalise: fix rotation, cap size, get real dimensions
  const { data: base, info } = await sharp(inputBuf)
    .rotate()
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true })

  const W = info.width  || 512
  const H = info.height || 512

  const useText = mode === 'text' && (await fontsWork())
  const overlay = useText ? textOverlay(W, H) : blocksOverlay(W, H)

  return sharp(base)
    .grayscale()
    .modulate({ brightness: 0.75 })
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

// ── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  pattern: 'wasted',
  alias: ['waste', 'gta', 'gtawasted'],
  category: 'fun',
  desc: 'GTA wasted effect on someone\'s profile pic',
  usage: '.wasted @user | reply to message',

  run: async ({ sock, from, msg, sender }) => {
    console.log('[WASTED] ▶ command started')

    await sock.sendMessage(from, {
      react: { text: '💀', key: msg.key },
    }).catch(() => {})

    const targetJid = getTarget(msg, sender, from)

    if (!targetJid) {
      await safeSend(sock, from, {
        text:
          `╔════════════════════════╗\n` +
          `║  💀 *WASTED* 💀        ║\n` +
          `╚════════════════════════╝\n\n` +
          `❌ Reply to a message or mention someone.\n\n` +
          `${CREDIT}`,
      }, msg)
      return
    }

    const targetNum = targetJid.split('@')[0]
    const targetTag = `@${targetNum}`
    const caption   = `*${targetTag} Got Wasted*`

    console.log(`[WASTED] target=${targetJid}`)

    // NOTE: do NOT call groupMetadata() here — on LID messages it can hang
    // for a very long time and make the whole command look frozen.

    // ── 1) Get the picture (or a default avatar) ───────────────────────────────
    let base = null
    try {
      base = await getProfilePicBuffer(sock, targetJid)
    } catch (e) {
      console.log('[WASTED] picture step crashed:', errReason(e))
    }

    let usedDefault = false
    if (!base) {
      console.log('[WASTED] no usable picture → default avatar')
      base = await defaultAvatar()
      usedDefault = true
    }

    // ── 2) Render with fallbacks ───────────────────────────────────────────────
    let outBuf = null

    try {
      outBuf = await renderWasted(base, 'text')
    } catch (e) {
      console.error('[WASTED] render A (text) failed:', errReason(e))
    }

    if (!outBuf) {
      try {
        outBuf = await renderWasted(base, 'blocks')
      } catch (e) {
        console.error('[WASTED] render B (blocks) failed:', errReason(e))
      }
    }

    if (!outBuf && !usedDefault) {
      try {
        outBuf = await renderWasted(await defaultAvatar(), 'blocks')
      } catch (e) {
        console.error('[WASTED] render C (default avatar) failed:', errReason(e))
      }
    }

    // ── 3) Send ────────────────────────────────────────────────────────────────
    let sent = false

    if (outBuf) {
      console.log(`[WASTED] output generated: ${outBuf.length} bytes`)
      sent = await safeSend(sock, from, {
        image: outBuf,
        mimetype: 'image/jpeg',
        caption,
        mentions: [targetJid],
      }, msg)
    }

    // Last resort: plain text so the user always gets something
    if (!sent) {
      sent = await safeSend(sock, from, {
        text: `💀 ${caption}\n\n${CREDIT}`,
        mentions: [targetJid],
      }, msg)
    }

    await sock.sendMessage(from, {
      react: { text: sent ? '✅' : '❌', key: msg.key },
    }).catch(() => {})

    console.log(sent ? '[WASTED] ✅ done' : '[WASTED] ❌ nothing could be sent')
  },
}
