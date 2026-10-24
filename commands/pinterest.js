'use strict'
// ════════════════════════════════════════════════════════════════════
//  commands/pinterest.js  —  ZENX  |  🩸 Pinterest Image Search  (v2, no API keys)
//  Usage: .pinterest <query>      .pin <query>      .pinterest --check
//  Reaction: 🩸 | Category: media
//
//  WHY THE OLD VERSION SAID "No results":
//    It relied on two third-party relay APIs (popcat / giftedtech). Those die
//    or change without notice, so every search came back empty.
//
//  HOW THIS VERSION WORKS (all free, no key):
//    1. PINTEREST DIRECT  — Pinterest's own public search resource
//       (/resource/BaseSearchResource/get/). A logged-out browser-style request
//       works; the one header that matters is x-pinterest-pws-handler. A session
//       is minted by a single GET to pinterest.com and re-used for 20 minutes.
//    2. BING IMAGES       — free fallback (/images/async). Not Pinterest, but
//       real image results, so the command never comes back empty.
//    3. LEGACY RELAY APIs — your two old APIs, kept as a last resort.
//
//  EXTRAS: results cached 10 min per query (repeat searches are instant and give
//  a different picture), never repeats a recent image in the same chat, skips
//  ads/story modules, converts webp/gif to jpeg when `sharp` is installed, and
//  `.pinterest --check` reports which source is working on your server.
// ════════════════════════════════════════════════════════════════════

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const CREDIT = '> © 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦'

let sharp = null
try { sharp = require('sharp') } catch {}

const log  = (...a) => console.log('[PINTEREST]', ...a)
const warn = (...a) => console.warn('[PINTEREST]', ...a)

// ── helpers ──────────────────────────────────────────────────────────

function sniff(buf) {
  if (!buf || buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'image/avif'
  return null
}

function dedupe(items) {
  const seen = new Set()
  return items.filter(it => {
    const k = it.urls[0]
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ════════════════════════════════════════════════════════════════════
//  SOURCE 1 — Pinterest direct
// ════════════════════════════════════════════════════════════════════

let pinSess = { cookie: '', csrf: '', version: '', at: 0 }

function parseSetCookies(res) {
  let list = []
  if (typeof res.headers.getSetCookie === 'function') list = res.headers.getSetCookie()
  else {
    const raw = res.headers.get('set-cookie')
    if (raw) list = raw.split(/,(?=\s*[\w.-]+=)/)
  }
  return list.map(c => c.split(';')[0].trim()).filter(c => c.includes('='))
}

async function pinSession(force = false) {
  if (!force && pinSess.at && Date.now() - pinSess.at < 20 * 60 * 1000) return pinSess

  const res = await fetch('https://www.pinterest.com/', {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  })

  const jar = new Map()
  for (const c of parseSetCookies(res)) {
    const i = c.indexOf('=')
    jar.set(c.slice(0, i), c.slice(i + 1))
  }
  const html = await res.text().catch(() => '')

  pinSess = {
    cookie:  [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    csrf:    jar.get('csrftoken') || '',
    version: (html.match(/"appVersion"\s*:\s*"([^"]+)"/) || [])[1] || '',
    at:      Date.now(),
  }
  return pinSess
}

function parsePinterest(json) {
  const data = json?.resource_response?.data
  const results = Array.isArray(data) ? data : (data?.results || [])
  const out = []

  for (const it of results) {
    if (!it || it.type === 'story') continue          // "related interests" rails, not pins
    if (it.is_promoted || it.promoter) continue       // ads
    const im = it.images
    if (!im || typeof im !== 'object') continue

    // read each URL from the pin's own images map — never rewrite the size segment
    const urls = ['orig', '736x', '564x', '474x', '236x']
      .map(k => im[k]?.url)
      .filter(u => typeof u === 'string' && u.startsWith('http'))

    if (urls.length) out.push({ urls })
  }
  return dedupe(out)
}

async function searchPinterest(query) {
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`
  const data = {
    options: {
      applied_unified_filters: null, appliedProductFilters: '---', article: null,
      auto_correction_disabled: false, corpus: null, customized_rerank_type: null,
      domains: null, filters: null, journey_depth: null, page_size: null,
      price_max: null, price_min: null, query_pin_sigs: null, query,
      redux_normalize_feed: true, request_params: null, rs: 'typed', scope: 'pins',
      selected_one_bar_modules: null, source_id: null, source_module_id: null,
      source_url: sourceUrl, top_pin_id: null, top_pin_ids: null,
    },
    context: {},
  }
  const url =
    'https://www.pinterest.com/resource/BaseSearchResource/get/' +
    `?source_url=${encodeURIComponent(sourceUrl)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}&_=${Date.now()}`

  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await pinSession(attempt > 0)   // 2nd try = brand-new session

    const headers = {
      'User-Agent': UA,
      'Accept': 'application/json, text/javascript, */*, q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.pinterest.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Pinterest-AppState': 'active',
      'X-Pinterest-PWS-Handler': 'www/search/[scope].js',   // the header Pinterest actually checks
      'X-Pinterest-Source-Url': sourceUrl,
    }
    if (s.version) headers['X-APP-VERSION'] = s.version
    if (s.csrf)    headers['X-CSRFToken'] = s.csrf
    if (s.cookie)  headers['Cookie'] = s.cookie

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) })

    if (res.status === 403 || res.status === 429) {
      if (attempt === 0) { warn(`Pinterest answered ${res.status}, refreshing session…`); continue }
      throw new Error(`HTTP ${res.status}`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    return parsePinterest(await res.json())
  }
  return []
}

// ════════════════════════════════════════════════════════════════════
//  SOURCE 2 — Bing Images (free fallback)
// ════════════════════════════════════════════════════════════════════

function parseBing(html) {
  const urls = []
  const re = /murl(?:&quot;|")\s*:\s*(?:&quot;|")(.*?)(?:&quot;|")/g
  let m
  while ((m = re.exec(html))) {
    const u = m[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/')
    if (/^https?:\/\//i.test(u) && !/\.(svg|gif)(\?|#|$)/i.test(u)) urls.push(u)
  }
  return dedupe(urls.map(u => ({ urls: [u] })))
}

async function searchBing(query) {
  let all = []
  // Bing's yield per request varies a lot, so ask for up to two pages
  for (let page = 0; page < 2 && all.length < 10; page++) {
    const url =
      `https://www.bing.com/images/async?q=${encodeURIComponent(query)}` +
      `&async=1&first=${page === 0 ? 1 : 36}&count=35&mmasync=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    all = dedupe(all.concat(parseBing(await res.text())))
  }
  return all
}

// ════════════════════════════════════════════════════════════════════
//  SOURCE 3 — your two old relay APIs (last resort)
// ════════════════════════════════════════════════════════════════════

async function searchLegacy(query) {
  const apis = [
    `https://api.popcat.xyz/pinterest?search=${encodeURIComponent(query)}`,
    `https://api.giftedtech.web.id/api/search/pinterest?apikey=gifted&query=${encodeURIComponent(query)}`,
  ]
  for (const url of apis) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': UA } })
      if (!res.ok) continue
      const data = await res.json()
      const list = Array.isArray(data) ? data
        : Array.isArray(data?.result) ? data.result
        : Array.isArray(data?.data) ? data.data : []
      const items = list
        .map(r => (typeof r === 'string' ? r : (r?.image || r?.url)))
        .filter(u => typeof u === 'string' && u.startsWith('http'))
        .map(u => ({ urls: [u] }))
      if (items.length) return dedupe(items)
    } catch (e) {
      warn(`legacy API failed: ${e.message}`)
    }
  }
  return []
}

const SOURCES = [
  { name: 'Pinterest', fn: searchPinterest },
  { name: 'Bing Images', fn: searchBing },
  { name: 'Legacy APIs', fn: searchLegacy },
]

// ── find results (with cache) ────────────────────────────────────────

const cache = new Map()       // query -> { at, items, source }
const recent = new Map()      // chat|query -> Set(urls)

async function findImages(query) {
  const key = query.toLowerCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000 && hit.items.length) return hit

  const errors = []
  for (const src of SOURCES) {
    try {
      const items = await src.fn(query)
      if (items.length) {
        log(`${src.name}: ${items.length} results for "${query}"`)
        const entry = { at: Date.now(), items, source: src.name }
        cache.set(key, entry)
        if (cache.size > 200) cache.delete(cache.keys().next().value)
        return entry
      }
      errors.push(`${src.name}: 0 results`)
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`)
    }
  }
  warn('all sources failed —', errors.join(' | '))
  return { items: [], source: null, errors }
}

// ── download one image (tries each size variant) ─────────────────────

async function downloadImage(urls) {
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': UA, 'Referer': 'https://www.pinterest.com/', 'Accept': 'image/jpeg,image/png,image/*;q=0.8' },
        signal: AbortSignal.timeout(9000),
      })
      if (!res.ok) continue

      let buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1500 || buf.length > 16 * 1024 * 1024) continue

      let mime = sniff(buf)
      if (!mime) continue

      // WhatsApp shows jpeg/png reliably — convert the rest when sharp is available
      if (mime === 'image/webp' || mime === 'image/avif' || mime === 'image/gif') {
        if (!sharp) continue
        buf = await sharp(buf).jpeg({ quality: 90 }).toBuffer().catch(() => null)
        if (!buf) continue
        mime = 'image/jpeg'
      }
      // very large originals → keep them chat-friendly
      if (sharp && buf.length > 4 * 1024 * 1024) {
        const small = await sharp(buf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer().catch(() => null)
        if (small) { buf = small; mime = 'image/jpeg' }
      }
      return { buf, mime, url: u }
    } catch (e) {
      warn(`image download failed (${e.message})`)
    }
  }
  return null
}

// ── pick an image, avoiding recent repeats in this chat ──────────────

async function pickAndDownload(entry, chatKey) {
  const seen = recent.get(chatKey) || new Set()
  let pool = entry.items.filter(it => !seen.has(it.urls[0]))
  if (!pool.length) { seen.clear(); pool = entry.items }

  for (const it of shuffle(pool).slice(0, 5)) {
    const img = await downloadImage(it.urls)
    if (img) {
      seen.add(it.urls[0])
      if (seen.size > 25) seen.delete(seen.values().next().value)
      recent.set(chatKey, seen)
      return img
    }
  }
  return null
}

// ── diagnostics:  .pinterest --check ─────────────────────────────────

async function runCheck() {
  const lines = []
  for (const src of SOURCES) {
    const t = Date.now()
    try {
      const items = await src.fn('cats')
      if (!items.length) { lines.push(`❌ *${src.name}* — 0 results (${Date.now() - t}ms)`); continue }
      const img = await downloadImage(items[0].urls)
      lines.push(
        img
          ? `✅ *${src.name}* — ${items.length} results, image OK ${Math.round(img.buf.length / 1024)}KB (${Date.now() - t}ms)`
          : `⚠️ *${src.name}* — ${items.length} results but the image would not download`
      )
    } catch (e) {
      lines.push(`❌ *${src.name}* — ${e.message} (${Date.now() - t}ms)`)
    }
  }
  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
//  the command
// ════════════════════════════════════════════════════════════════════

module.exports = {
  pattern:  'pinterest',
  alias:    ['pin'],
  category: 'media',
  desc:     'Search Pinterest images',
  usage:    '.pinterest <query>',

  run: async ({ sock, from, msg, args, text }) => {

    const query = (text || args?.join(' ') || '').trim()

    // ── No query → usage help ──────────────────────────────────
    if (!query) {
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗
║  🩸  *PINTEREST SEARCH*       ║
╚══════════════════════════════╝

❌ *No search query provided!*

📌 *Usage:*
  _.pinterest <search>_
  _.pin <search>_

🔥 *Examples:*
  _.pinterest anime wallpaper_
  _.pinterest aesthetic dark_
  _.pinterest cute cats_

${CREDIT}`,
      }, { quoted: msg })
    }

    // ── diagnostics ────────────────────────────────────────────
    if (query.toLowerCase() === '--check') {
      void sock.sendMessage(from, { react: { text: '🔎', key: msg.key } }).catch(() => {})
      const report = await runCheck()
      return sock.sendMessage(from, {
        text: `🔎 *Pinterest source check*\n\n${report}\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    // ── React instantly ────────────────────────────────────────
    void sock.sendMessage(from, { react: { text: '🩸', key: msg.key } }).catch(() => {})

    const found = await findImages(query)

    if (!found.items.length) {
      void sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `╔══════════════════════════════╗
║  🩸  *PINTEREST SEARCH*       ║
╚══════════════════════════════╝

❌ *No results for:* _"${query}"_
💡 Try different keywords, or run _.pinterest --check_ to test the sources

${CREDIT}`,
      }, { quoted: msg })
    }

    const img = await pickAndDownload(found, `${from}|${query.toLowerCase()}`)

    if (!img) {
      void sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
      return sock.sendMessage(from, {
        text: `❌ *Could not load the image*\n💡 Send the command again for a different one\n\n${CREDIT}`,
      }, { quoted: msg })
    }

    const label   = found.source === 'Pinterest' ? 'Pinterest' : 'Image Search'
    const caption = `🩸 *${label}* — _${query}_\n\n${CREDIT}`

    // ── Send image (buffer first, URL fallback) ────────────────
    try {
      await sock.sendMessage(from, { image: img.buf, caption, mimetype: img.mime }, { quoted: msg })
    } catch (err) {
      warn('buffer send failed, trying URL fallback:', err.message)
      try {
        await sock.sendMessage(from, { image: { url: img.url }, caption }, { quoted: msg })
      } catch {
        void sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {})
        return sock.sendMessage(from, {
          text: `❌ *Could not send the image*\n\n${CREDIT}`,
        }, { quoted: msg })
      }
    }

    void sock.sendMessage(from, { react: { text: '✅', key: msg.key } }).catch(() => {})
  },
}

// exposed for offline tests only (not enumerable, so command loaders ignore it)
Object.defineProperty(module.exports, '_test', {
  value: { parsePinterest, parseBing, sniff, findImages, searchPinterest, searchBing, runCheck, cache },
  enumerable: false,
})
