// commands/gcstatus.js
// ─────────────────────────────────────────────────────────────────────────────
// .gcstatus — publish a replied message to a WhatsApp GROUP STATUS.
//
//   Reply to a text / image / video / voice-note with:
//     .gcstatus <group name | GID | invite link>     (from anywhere)
//     .gcstatus                                      (inside the target group)
//     .gcstatus all                                  (post it to EVERY group the bot is in)
//     .gcstatus all stop                             (cancel a running bulk post)
//     .gcstatus ... --flat                           (fallback engine, see below)
//     .gcstatus ... --nopreview                      (no link card on text statuses)
//     .gcstatus ... --color=red | #ff8800 | primary | secondary | tertiary | css
//                                                    (background color; default = random of ALL)
//     .gcstatus colors                               (list every color name)
//     .gcstatus check                                (library patch diagnostics)
//
// COLORS: every primary (RGB light, CMY print, RYB paint), every secondary,
//   every tertiary (RYB + RGB wheels) and all CSS named colors — never black,
//   white included. Text color flips dark/white automatically for contrast.
//   Applies to TEXT and AUDIO statuses (images/videos fill the screen, so they
//   have no background). A text status that carries a link card may ignore it.
//
// DEEP LINK-IMAGE ENGINE: the card image is hunted in waves (page as WhatsApp/
//   Facebook/Twitter/browser, deep page scan, oEmbed APIs, site resolvers,
//   screenshots, icons) and stops at the first good picture. Images are squeezed
//   under ~250 KB because WhatsApp silently drops thumbnails over ~300 KB.
//   .env GCSTATUS_IMAGE_BUDGET_MS=45000 sets the most time it may spend.
//
// LINK CARD FIXES (earlier version):
//   • Garbled card text (@#$%^&*...): the page was read as text even when the
//     server sent compressed / binary / non-UTF-8 bytes. Now the body is read as
//     raw bytes, only gzip/deflate is requested, the charset is detected, and
//     every title/description is sanitised. If the text still looks like junk the
//     card falls back to the domain name.
//   • Card image missing: image download had a 700 ms timeout and the big-card
//     upload 2.5 s, so they usually timed out. Timeouts are now realistic, the
//     image is converted to a proper JPEG before upload, and the thumbnail fields
//     are written onto the message explicitly if the library didn't.
//
// OTHER FIX: the "library not patched" check used inspectLib() without await,
//   which threw AFTER a successful media post and showed "Group Status failed".
//
// WHY MEDIA USED TO FAIL (text worked):
//   Group Status is a normal message wrapped in `groupStatusMessageV2`.
//   Baileys' relayMessage() decides the stanza's `mediatype` attribute by
//   looking only at the TOP level of the message → wrapped media never gets it.
//   FIX: node patch-gcstatus-lib.js (run once, restart; re-run after npm install).
//
//   --flat : fallback engine, sends normal media with the group-status
//            contextInfo flags. Use only if the wrapped engine doesn't show up.
// ─────────────────────────────────────────────────────────────────────────────

const { sendOwnerRestricted } = require('../lib/groupAdminNotice')
const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const Pino = require("pino")
const { sendMessageUnstyled } = require("../core/responseTextStyle")

const axios = require("axios")
const baileys = require("@systemzero/baileys")
const {
  downloadMediaMessage,
  generateWAMessageContent,
} = baileys

let sharp = null
try { sharp = require("sharp") } catch {}

const CREDIT = "> *© 𓃦 𝗭Ξ𝗡 𝗫_𝗕𝗼𝘁 𓃦*"

const STATUS_SOURCE = {
  image: 0,
  video: 1,
  gif: 2,
  audio: 3,
  text: 4,
}

const STATUS_SOURCE_NAME = {
  image: "IMAGE",
  video: "VIDEO",
  gif: "GIF",
  audio: "AUDIO",
  text: "TEXT",
}

const SUPPORTED_MEDIA = new Set(["image", "video", "audio"])

function statusReply(sock, msg, text) {
  return sendMessageUnstyled(
    sock,
    msg?.key?.remoteJid,
    { text },
    { quoted: msg }
  )
}

// ── BACKGROUND COLORS ────────────────────────────────────────────────────────
// Every primary (RGB + CMY + RYB paint), every secondary (all three models),
// every tertiary (RYB 12-wheel + RGB 12-wheel) and all CSS named colors.
// NO black (pure black and near-black are filtered out). White IS included.

const toColorMap = str => {
  const out = {}
  for (const pair of str.trim().split(/\s+/)) {
    const [name, hex] = pair.split(":")
    const n = parseInt(hex, 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    if (r < 0x30 && g < 0x30 && b < 0x30) continue // never black / near-black
    out[name] = n
  }
  return out
}

const COLOR_GROUPS = {
  // primary: light (RGB), print (CMY), paint (RYB)
  primary: toColorMap(`
    red:FF0000 green:00FF00 blue:0000FF
    cyan:00FFFF magenta:FF00FF yellow:FFFF00
    paintred:E60026 paintyellow:FFD500 paintblue:0047AB`),

  // secondary: light (yellow cyan magenta), print (red green blue), paint (orange green purple/violet)
  secondary: toColorMap(`
    yellow:FFFF00 cyan:00FFFF magenta:FF00FF
    red:FF0000 green:00FF00 blue:0000FF
    orange:FF8000 purple:800080 violet:8000FF
    paintorange:FF6A00 paintgreen:00A550 paintpurple:6A0DAD`),

  // tertiary: the 6 RYB ones + the 6 RGB ones
  tertiary: toColorMap(`
    vermilion:E34234 amber:FFBF00 chartreuse:7FFF00
    teal:008080 indigo:4B0082 redviolet:C71585
    springgreen:00FF80 azure:0080FF rose:FF0080
    redorange:FF4500 yelloworange:FFAE42 yellowgreen:9ACD32
    bluegreen:0D98BA blueviolet:8A2BE2`),

  // every CSS named color (black removed)
  css: toColorMap(`
    aliceblue:F0F8FF antiquewhite:FAEBD7 aqua:00FFFF aquamarine:7FFFD4 azuremist:F0FFFF
    beige:F5F5DC bisque:FFE4C4 black:000000 blanchedalmond:FFEBCD blueviolet:8A2BE2
    brown:A52A2A burlywood:DEB887 cadetblue:5F9EA0 chocolate:D2691E coral:FF7F50
    cornflowerblue:6495ED cornsilk:FFF8DC crimson:DC143C darkblue:00008B darkcyan:008B8B
    darkgoldenrod:B8860B darkgray:A9A9A9 darkgreen:006400 darkkhaki:BDB76B darkmagenta:8B008B
    darkolivegreen:556B2F darkorange:FF8C00 darkorchid:9932CC darkred:8B0000 darksalmon:E9967A
    darkseagreen:8FBC8F darkslateblue:483D8B darkslategray:2F4F4F darkturquoise:00CED1
    darkviolet:9400D3 deeppink:FF1493 deepskyblue:00BFFF dimgray:696969 dodgerblue:1E90FF
    firebrick:B22222 floralwhite:FFFAF0 forestgreen:228B22 fuchsia:FF00FF gainsboro:DCDCDC
    ghostwhite:F8F8FF gold:FFD700 goldenrod:DAA520 gray:808080 greenyellow:ADFF2F
    honeydew:F0FFF0 hotpink:FF69B4 indianred:CD5C5C ivory:FFFFF0 khaki:F0E68C
    lavender:E6E6FA lavenderblush:FFF0F5 lawngreen:7CFC00 lemonchiffon:FFFACD lightblue:ADD8E6
    lightcoral:F08080 lightcyan:E0FFFF lightgoldenrodyellow:FAFAD2 lightgray:D3D3D3
    lightgreen:90EE90 lightpink:FFB6C1 lightsalmon:FFA07A lightseagreen:20B2AA
    lightskyblue:87CEFA lightslategray:778899 lightsteelblue:B0C4DE lightyellow:FFFFE0
    lime:00FF00 limegreen:32CD32 linen:FAF0E6 maroon:800000 mediumaquamarine:66CDAA
    mediumblue:0000CD mediumorchid:BA55D3 mediumpurple:9370DB mediumseagreen:3CB371
    mediumslateblue:7B68EE mediumspringgreen:00FA9A mediumturquoise:48D1CC
    mediumvioletred:C71585 midnightblue:191970 mintcream:F5FFFA mistyrose:FFE4E1
    moccasin:FFE4B5 navajowhite:FFDEAD navy:000080 oldlace:FDF5E6 olive:808000
    olivedrab:6B8E23 orangered:FF4500 orchid:DA70D6 palegoldenrod:EEE8AA palegreen:98FB98
    paleturquoise:AFEEEE palevioletred:DB7093 papayawhip:FFEFD5 peachpuff:FFDAB9 peru:CD853F
    pink:FFC0CB plum:DDA0DD powderblue:B0E0E6 rebeccapurple:663399 rosybrown:BC8F8F
    royalblue:4169E1 saddlebrown:8B4513 salmon:FA8072 sandybrown:F4A460 seagreen:2E8B57
    seashell:FFF5EE sienna:A0522D silver:C0C0C0 skyblue:87CEEB slateblue:6A5ACD
    slategray:708090 snow:FFFAFA steelblue:4682B4 tan:D2B48C thistle:D8BFD8 tomato:FF6347
    turquoise:40E0D0 wheat:F5DEB3 white:FFFFFF whitesmoke:F5F5F5`),
}

// white is a valid background (kept explicitly)
COLOR_GROUPS.primary.white = 0xFFFFFF

// name → rgb for every color in every group
const STATUS_COLORS = {}
for (const group of Object.values(COLOR_GROUPS)) {
  for (const [name, rgb] of Object.entries(group)) {
    if (STATUS_COLORS[name] === undefined) STATUS_COLORS[name] = rgb
  }
}
// unique shades (so duplicate names for the same shade don't skew the random pick)
const ALL_SHADES = [...new Set(Object.values(STATUS_COLORS))]

const toArgb = rgb => (0xFF000000 | rgb) >>> 0

// light backgrounds get dark text, dark backgrounds get white text
function textColorFor(argb) {
  const r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? 0xFF222222 : 0xFFFFFFFF
}

// spec can be:  a color name ("red", "teal", "hotpink")  |  a hex ("#ff8800")
//               a group ("primary" | "secondary" | "tertiary" | "css")
//               nothing / "random" / unknown  → random from EVERY color
function pickBackground(spec) {
  const s = String(spec || "").trim().toLowerCase().replace(/^#/, "")

  if (/^[0-9a-f]{6}$/.test(s)) {
    const n = parseInt(s, 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    if (!(r < 0x30 && g < 0x30 && b < 0x30)) return toArgb(n) // black is refused
  }

  if (COLOR_GROUPS[s]) {
    const shades = Object.values(COLOR_GROUPS[s])
    return toArgb(shades[Math.floor(Math.random() * shades.length)])
  }

  if (STATUS_COLORS[s] !== undefined) return toArgb(STATUS_COLORS[s])

  return toArgb(ALL_SHADES[Math.floor(Math.random() * ALL_SHADES.length)])
}

function colorSummary() {
  const g = COLOR_GROUPS
  return {
    primary: Object.keys(g.primary).length,
    secondary: Object.keys(g.secondary).length,
    tertiary: Object.keys(g.tertiary).length,
    css: Object.keys(g.css).length,
    names: Object.keys(STATUS_COLORS).length,
    shades: ALL_SHADES.length,
  }
}

// ── quoted message helpers ───────────────────────────────────────────────────

function getQuotedInfo(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    msg.message?.stickerMessage?.contextInfo

  if (!ctx?.quotedMessage) return null

  return {
    quotedMessage: ctx.quotedMessage,
    participant: ctx.participant,
    stanzaId: ctx.stanzaId,
  }
}

function unwrap(message) {
  let current = message

  for (let i = 0; i < 8 && current; i++) {
    const next =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message

    if (!next) break
    current = next
  }

  return current
}

function getContent(message) {
  const m = unwrap(message)

  if (m?.conversation) return { type: "text", node: { text: m.conversation } }
  if (m?.extendedTextMessage) return { type: "text", node: m.extendedTextMessage }
  if (m?.imageMessage) return { type: "image", node: m.imageMessage }
  if (m?.videoMessage) return { type: "video", node: m.videoMessage }
  if (m?.audioMessage) return { type: "audio", node: m.audioMessage }
  if (m?.stickerMessage) return { type: "sticker", node: m.stickerMessage }
  if (m?.documentMessage) return { type: "document", node: m.documentMessage }

  return null
}

// Keep user-authored status text opaque: return the original text/caption
// verbatim, including Unicode, spacing, and punctuation. Do not stylize it.
function originalText(node) {
  if (typeof node?.text === "string") return node.text
  if (typeof node?.caption === "string") return node.caption
  return ""
}

async function downloadMedia(sock, node, type, quoted, from) {
  if (!node) throw new Error("Media node is missing")

  const fakeMsg = {
    key: {
      remoteJid: from,
      id: quoted.stanzaId,
      participant: quoted.participant,
      fromMe: false,
    },
    message: unwrap(quoted.quotedMessage),
  }

  console.log("[GCSTATUS] Downloading quoted media", {
    type,
    hasMediaKey: !!node.mediaKey,
    hasUrl: !!node.url,
    hasDirectPath: !!node.directPath,
  })

  const buffer = await downloadMediaMessage(
    fakeMsg,
    "buffer",
    {},
    {
      logger: Pino({ level: "silent" }),
      // lets WhatsApp re-serve media whose CDN link has expired
      reuploadRequest: sock.updateMediaMessage,
    }
  )

  if (!buffer || buffer.length < 10) throw new Error("Downloaded media is empty")

  console.log("[GCSTATUS] Downloaded", { type, bytes: buffer.length })
  return buffer
}

// ── group lookup (unchanged) ─────────────────────────────────────────────────

async function findGroup(sock, destination) {
  const groups = await sock.groupFetchAllParticipating()
  const list = Object.values(groups || {})

  if (!destination) return null

  const raw = destination.trim()

  if (raw.endsWith("@g.us")) {
    return list.find(g => g.id === raw) || { id: raw, subject: raw }
  }

  const match = raw.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i)

  if (match) {
    try {
      const metadata = await sock.groupGetInviteInfo(match[1])
      if (metadata?.id) return metadata
    } catch (e) {
      throw new Error(`Invite link could not be resolved: ${e.message}`)
    }
  }

  const exact = list.find(
    g => String(g.subject || "").trim().toLowerCase() === raw.toLowerCase()
  )
  if (exact) return exact

  const partial = list.filter(g =>
    String(g.subject || "").toLowerCase().includes(raw.toLowerCase())
  )

  if (partial.length === 1) return partial[0]

  if (partial.length > 1) {
    throw new Error(`More than one group matches "${raw}". Use the GID from .gcjid.`)
  }

  return null
}

// ── status building blocks ───────────────────────────────────────────────────

function buildStatusContext(statusSourceType) {
  return {
    isGroupStatus: true,
    statusSourceType,
    forwardingScore: 0,
    featureEligibilities: {
      canBeReshared: true,
      canReceiveMultiReact: true,
    },
  }
}

// Keep the Group Status V2 wrapper out of generateWAMessageFromContent().
// Baileys normalizes that wrapper as a future-proof message and unwraps it,
// which can make WhatsApp receive the inner payload as ordinary chat content.
function makeGroupStatusMessage(groupJid, inner, userJid, secret) {
  const id = typeof baileys.generateMessageIDV2 === "function"
    ? baileys.generateMessageIDV2(userJid)
    : crypto.randomBytes(10).toString("hex").toUpperCase()

  const content = {
    messageContextInfo: { messageSecret: secret },
    groupStatusMessageV2: {
      message: {
        ...inner,
        messageContextInfo: {
          ...(inner.messageContextInfo || {}),
          messageSecret: secret,
        },
      },
    },
  }

  const message = baileys.proto?.Message?.fromObject
    ? baileys.proto.Message.fromObject(content)
    : content

  return {
    key: { remoteJid: groupJid, fromMe: true, id, participant: userJid },
    message,
  }
}

// gif-playback videos are their own status source type
function statusKind(content) {
  if (content.type === "video" && content.node?.gifPlayback) return "gif"
  return content.type
}

// ── LINK PREVIEW (text statuses that contain a link) ─────────────────────────
// Builds the card WhatsApp shows in a normal chat: big image + title +
// description + domain. Everything comes from the link's own page
// (og:title / og:description / og:image).
// Never blocks the status: if anything fails, the text is sent without a card.

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|\b(?:t\.me|wa\.me|chat\.whatsapp\.com|youtu\.be|bit\.ly|instagram\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com)\/[^\s<>"']+)/i

function extractFirstUrl(text) {
  const m = String(text || "").match(URL_RE)
  if (!m) return null
  return m[1].replace(/[)\].,;:!?]+$/, "") // drop trailing punctuation
}

function toFetchUrl(u) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}

function withTimeout(promise, ms, label = "operation") {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function decodeEntities(s) {
  const cp = n => { try { return String.fromCodePoint(n) } catch { return "" } }
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .trim()
}

// Strip control characters / replacement chars / stray markup, collapse spaces.
function cleanText(s, max = 300) {
  return decodeEntities(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\ufffd\u200b-\u200f\u2028-\u202f\u2060\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

// True when a string is mostly symbols/junk (e.g. "@#$(*&^%$#!@#$%^&*(") instead of
// real text. Real titles are mostly letters/digits/spaces in any language.
function isGarbled(s) {
  const t = String(s || "")
  if (!t) return false
  if (t.length < 3) return false
  const good = (t.match(/[\p{L}\p{N}\s]/gu) || []).length
  return good / t.length < 0.5
}

// Pick the best readable text, or "" if it's junk.
function safeText(s, max) {
  const t = cleanText(s, max)
  return t && !isGarbled(t) ? t : ""
}

function decodeBody(buf, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || "")?.[1]
  if (!charset) {
    const head = buf.subarray(0, 4096).toString("latin1")
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  }
  try { return new TextDecoder(charset || "utf-8").decode(buf) }
  catch { return buf.toString("utf8") }
}

function readMeta(html, names) {
  for (const name of names) {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i")
    const m = html.match(a) || html.match(b)
    if (m?.[1]) return decodeEntities(m[1])
  }
  return null
}

function readMetaAttribute(html, attribute, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const attr = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']${value}["']`, "i"))
    if (!attr) continue
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const result = content?.[1] || content?.[2] || content?.[3]
    if (result) return decodeEntities(result)
  }
  return null
}

function tagAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
  return decodeEntities(match?.[1] || match?.[2] || match?.[3] || "")
}

function normalizePreviewImageUrl(raw, baseUrl) {
  const value = decodeEntities(raw).trim()
  if (!value || /^data:/i.test(value)) return null
  try {
    const url = new URL(value, baseUrl)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DEEP LINK-IMAGE ENGINE
// Finds the picture of a link by going as deep as it takes, in waves, and stops
// the moment it has a good one (so easy links are instant, hard links get time).
//
//   WAVE 1  page HTML fetched as WhatsApp / Facebook / Twitter / browser at the
//           same time (sites often only show the image to some crawlers) +
//           site-specific resolvers (YouTube, TikTok, X, Instagram, Vimeo,
//           Spotify, SoundCloud) → og:image, twitter:image, JSON-LD, <link
//           image_src>, video posters, <img>/srcset/<picture>, and a raw scan of
//           every image URL buried in the page's scripts/JSON.
//   WAVE 2  oEmbed advertised by the page, noembed.com, Microlink metadata.
//   WAVE 3  real screenshot of the page (Microlink, WordPress mshots, thum.io),
//           then the site's icon on a clean card.
//
// Every image is checked (real image? big enough? sensible shape?) and squeezed
// under ~250 KB — WhatsApp silently drops thumbnails bigger than about 300 KB.
// Results are cached 30 min, so reposting / `.gcstatus all` is instant.
//   .env  GCSTATUS_IMAGE_BUDGET_MS=45000   (max total time the engine may spend)
// ═════════════════════════════════════════════════════════════════════════════

const ENGINE_UAS = {
  whatsapp: "WhatsApp/2.24.7.78 A",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  browser: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}
const ENGINE_MAX_BYTES = 250 * 1024
const ENGINE_CACHE_MS = 30 * 60 * 1000
const engineCache = new Map()
const engineLog = (...a) => console.log("[GCSTATUS ENGINE]", ...a)
const engineSleep = ms => new Promise(r => setTimeout(r, ms))

function engineBudgetMs() {
  const n = parseInt(process.env.GCSTATUS_IMAGE_BUDGET_MS, 10)
  return Number.isFinite(n) && n >= 5000 ? n : 45000
}

function hostOf(url) {
  try { return new URL(toFetchUrl(url)).hostname.replace(/^www\./i, "").toLowerCase() } catch { return "" }
}

function httpGet(url, { ua = ENGINE_UAS.browser, timeout = 8000, max = 3 * 1024 * 1024, accept, headers } = {}) {
  return withTimeout(axios.get(url, {
    timeout,
    maxRedirects: 6,
    maxContentLength: max,
    maxBodyLength: max,
    responseType: "arraybuffer",
    headers: {
      "User-Agent": ua,
      Accept: accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
      "Accept-Encoding": "gzip, deflate", // never br/zstd — that produced the garbage text
      "Accept-Language": "en-US,en;q=0.9",
      ...(headers || {}),
    },
    validateStatus: s => s >= 200 && s < 400,
  }), timeout + 1500, "request")
}

async function getJson(url, timeout = 7000) {
  const res = await httpGet(url, { timeout, max: 2 * 1024 * 1024, accept: "application/json,*/*;q=0.5" })
  try { return JSON.parse(Buffer.from(res.data || []).toString("utf8")) } catch { return null }
}

// ── page fetching ────────────────────────────────────────────────────────────

async function fetchPage(url, ua) {
  let target = toFetchUrl(url)
  for (let hop = 0; hop < 2; hop++) {
    const res = await httpGet(target, { ua, timeout: 9000 })
    const contentType = String(res.headers?.["content-type"] || "")
    const finalUrl = res.request?.res?.responseUrl || target

    if (/^image\//i.test(contentType)) return { html: "", finalUrl, directImage: finalUrl, ua }
    if (contentType && !/html|xml|text\/|json/i.test(contentType)) throw new Error(`not HTML (${contentType.split(";")[0]})`)

    const buf = Buffer.from(res.data || [])
    if (buf.subarray(0, 2000).includes(0)) throw new Error("binary body")
    const html = decodeBody(buf, contentType)

    // tiny redirect pages (meta refresh / JS location) — follow one hop
    const hop2 =
      html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"'>\s]+)/i)?.[1] ||
      html.match(/location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]
    if (hop === 0 && hop2 && html.length < 6000 && !readMeta(html, ["og:image"])) {
      try { target = new URL(decodeEntities(hop2), finalUrl).href; continue } catch {}
    }
    return { html, finalUrl, ua }
  }
}

// all four crawler identities at once; returns as soon as the first one answers
// (plus a short grace period so the others can still contribute)
function collectPages(url) {
  const order = [ENGINE_UAS.whatsapp, ENGINE_UAS.facebook, ENGINE_UAS.twitter, ENGINE_UAS.browser]
  return new Promise(resolve => {
    const got = []
    let pending = order.length
    let timer = null
    const finish = () => {
      clearTimeout(timer)
      resolve(order.map(ua => got.find(g => g.ua === ua)).filter(Boolean))
    }
    for (const ua of order) {
      fetchPage(url, ua)
        .then(p => {
          got.push(p)
          // the page already advertises an image → no reason to wait for the others
          if (p.directImage || (p.html && readMeta(p.html, ["og:image", "twitter:image", "og:image:secure_url"]))) return finish()
          if (!timer) timer = setTimeout(finish, 700)
        })
        .catch(e => engineLog(`page fetch failed (${ua.split("/")[0]}): ${e.message}`))
        .finally(() => { if (--pending === 0) finish() })
    }
  })
}

// ── candidate extraction (the "go deep" part) ────────────────────────────────

const JUNK_IMG = /(sprite|pixel|tracking|tracker|beacon|1x1|spacer|blank\.|transparent|doubleclick|adsystem|googleads|facebook\.com\/tr|emoji|loading\.|loader|placeholder|lazy\.|\/ads?\/|badge|button)/i

function collectLdImages(value, acc, depth = 0) {
  if (depth > 8 || value == null || acc.length >= 6) return
  if (Array.isArray(value)) { value.forEach(v => collectLdImages(v, acc, depth + 1)); return }
  if (typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (["image", "thumbnailUrl", "thumbnail", "primaryImageOfPage"].includes(key)) {
      const items = Array.isArray(child) ? child : [child]
      for (const it of items) {
        if (typeof it === "string") acc.push(it)
        else if (it?.url) acc.push(it.url)
      }
    } else collectLdImages(child, acc, depth + 1)
  }
}

function bestFromSrcset(srcset, fallback) {
  let best = fallback, bestW = -1
  for (const part of String(srcset || "").split(",")) {
    const [u, d] = part.trim().split(/\s+/)
    const w = parseInt(d, 10) || 0
    if (u && w > bestW) { bestW = w; best = u }
  }
  return best
}

// returns [{ url, tier, source }] — lower tier = better source
function deepCandidates(html, baseUrl) {
  const out = []
  const seen = new Set()
  const add = (raw, tier, source) => {
    const url = normalizePreviewImageUrl(raw, baseUrl)
    if (!url || seen.has(url)) return
    if (/\.ico(\?|#|$)/i.test(url)) return                              // sharp can't read .ico
    if (tier >= 4 && (/\.(svg|gif)(\?|#|$)/i.test(url) || JUNK_IMG.test(url))) return
    seen.add(url)
    out.push({ url, tier, source })
  }

  // tier 1 — metadata the site deliberately publishes for link cards
  for (const [name, label] of [
    ["og:image", "og:image"], ["og:image:secure_url", "og:image:secure"], ["og:image:url", "og:image:url"],
    ["twitter:image", "twitter:image"], ["twitter:image:src", "twitter:image:src"],
    ["thumbnail", "meta thumbnail"], ["parsely-image-url", "parsely"], ["vk:image", "vk:image"],
  ]) add(readMeta(html, [name]), 1, label)
  add(readMetaAttribute(html, "itemprop", "image"), 1, "itemprop image")
  add(readMetaAttribute(html, "itemprop", "thumbnailUrl"), 1, "itemprop thumbnail")

  // tier 2 — structured data and <link image_src>
  const ld = []
  for (const script of html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []) {
    try { collectLdImages(JSON.parse(script.replace(/^.*?>|<\/script>.*$/gis, "").trim()), ld) } catch {}
  }
  ld.forEach(u => add(u, 2, "JSON-LD"))

  const links = html.match(/<link\b[^>]*>/gi) || []
  for (const tag of links) {
    const rel = tagAttribute(tag, "rel").toLowerCase().split(/\s+/)
    if (rel.includes("image_src")) add(tagAttribute(tag, "href"), 2, "link image_src")
  }

  // tier 3 — preloaded hero images and video posters
  for (const tag of links) {
    const rel = tagAttribute(tag, "rel").toLowerCase().split(/\s+/)
    if (rel.includes("preload") && /image/i.test(tagAttribute(tag, "as"))) {
      add(bestFromSrcset(tagAttribute(tag, "imagesrcset"), tagAttribute(tag, "href")), 3, "preloaded image")
    }
  }
  for (const tag of html.match(/<video\b[^>]*>/gi) || []) add(tagAttribute(tag, "poster"), 3, "video poster")
  add(readMeta(html, ["msapplication-TileImage"]), 3, "tile image")

  // tier 5 — images in the page body, ranked (hero/cover/banner up, logos/avatars down)
  const scored = []
  for (const tag of (html.match(/<img\b[^>]*>/gi) || []).slice(0, 150)) {
    const src = tagAttribute(tag, "src") || tagAttribute(tag, "data-src") || tagAttribute(tag, "data-lazy-src") || tagAttribute(tag, "data-original")
    const best = bestFromSrcset(tagAttribute(tag, "srcset") || tagAttribute(tag, "data-srcset"), src)
    if (!best) continue
    const w = parseInt(tagAttribute(tag, "width"), 10) || 0
    const h = parseInt(tagAttribute(tag, "height"), 10) || 0
    if ((w && w < 120) || (h && h < 90)) continue
    const hint = `${tag} ${best}`.toLowerCase()
    let score = w + h
    if (/hero|cover|banner|featured|lead|poster|thumb|article|post-image|og-image|wp-post-image/.test(hint)) score += 800
    if (/logo|avatar|icon|profile|author|sprite|emoji|advert|\bad-/.test(hint)) score -= 1500
    scored.push({ best, score })
  }
  scored.sort((a, b) => b.score - a.score).slice(0, 10).forEach(s => add(s.best, 5, "page image"))
  for (const tag of (html.match(/<source\b[^>]*>/gi) || []).slice(0, 10)) {
    add(bestFromSrcset(tagAttribute(tag, "srcset") || tagAttribute(tag, "data-srcset"), ""), 5, "picture source")
  }

  // tier 6 — every image URL hiding in scripts / JSON state (Next.js, Nuxt, apps)
  const flat = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/")
  const raw = flat.match(/https?:\/\/[^"'\s<>\\)(]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>\\)(]*)?/gi) || []
  let deep = 0
  for (const u of raw) {
    if (deep >= 15) break
    const before = out.length
    add(u, 6, "deep page scan")
    if (out.length > before) deep++
  }

  // tier 9 — the site's own icons (last resort, shown on a clean card)
  let iconBest = null, iconSize = -1
  for (const tag of links) {
    const rel = tagAttribute(tag, "rel").toLowerCase().split(/\s+/)
    if (!(rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed") || rel.includes("icon"))) continue
    const size = parseInt(tagAttribute(tag, "sizes"), 10) || (rel.includes("apple-touch-icon") ? 180 : 32)
    if (size > iconSize) { iconSize = size; iconBest = tagAttribute(tag, "href") }
  }
  add(iconBest, 9, "site icon")
  try { add(new URL("/apple-touch-icon.png", baseUrl).href, 9, "apple-touch-icon") } catch {}

  return out
}

// ── site-specific resolvers (cheap, run in wave 1 alongside the page fetch) ──

async function resolveKnownSites(url) {
  const host = hostOf(url)
  const enc = encodeURIComponent(toFetchUrl(url))
  const cands = []
  const jobs = []
  let title = ""
  const push = (u, tier, source) => { if (u && typeof u === "string") cands.push({ url: u, tier, source }) }
  const oembed = (endpoint, label) => jobs.push(
    getJson(endpoint).then(j => {
      if (j?.thumbnail_url) push(j.thumbnail_url, 1, label)
      if (j?.title && !title) title = String(j.title)
    }).catch(() => {})
  )

  const yt = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/i)?.[1]
  if (yt) {
    push(`https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`, 1, "youtube thumbnail")
    push(`https://i.ytimg.com/vi/${yt}/sddefault.jpg`, 1, "youtube thumbnail")
    push(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, 2, "youtube thumbnail")
    oembed(`https://www.youtube.com/oembed?url=${enc}&format=json`, "youtube oembed")
  }
  if (/(^|\.)tiktok\.com$/.test(host)) oembed(`https://www.tiktok.com/oembed?url=${enc}`, "tiktok oembed")
  if (/(^|\.)vimeo\.com$/.test(host)) oembed(`https://vimeo.com/api/oembed.json?url=${enc}`, "vimeo oembed")
  if (/(^|\.)spotify\.com$/.test(host)) oembed(`https://open.spotify.com/oembed?url=${enc}`, "spotify oembed")
  if (/(^|\.)soundcloud\.com$/.test(host)) oembed(`https://soundcloud.com/oembed?format=json&url=${enc}`, "soundcloud oembed")

  const tw = String(url).match(/(?:twitter|x)\.com\/([^\/?#]+)\/status\/(\d+)/i)
  if (tw) {
    jobs.push(getJson(`https://api.fxtwitter.com/${tw[1]}/status/${tw[2]}`).then(j => {
      const t = j?.tweet
      for (const p of t?.media?.photos || []) push(p.url, 1, "x photo")
      for (const v of t?.media?.videos || []) push(v.thumbnail_url, 1, "x video")
      push(String(t?.author?.avatar_url || "").replace("_normal", "_400x400"), 3, "x avatar")
      if (t?.text && !title) title = String(t.text)
    }).catch(() => {}))
  }

  const ig = String(url).match(/instagram\.com\/(?:p|reel|tv)\/([\w-]+)/i)?.[1]
  if (ig) push(`https://www.instagram.com/p/${ig}/media/?size=l`, 2, "instagram media")

  await Promise.all(jobs)
  return { cands, title }
}

// ── wave 2: generic oEmbed / metadata APIs ───────────────────────────────────

async function resolveGeneric(url, pages) {
  const enc = encodeURIComponent(toFetchUrl(url))
  const cands = []
  const jobs = []
  let title = "", description = ""
  const push = (u, tier, source) => { if (u && typeof u === "string") cands.push({ url: u, tier, source }) }

  // oEmbed endpoint advertised by the page itself
  for (const p of pages) {
    for (const tag of (p.html || "").match(/<link\b[^>]*oembed[^>]*>/gi) || []) {
      const href = tagAttribute(tag, "href")
      if (!href) continue
      try {
        const abs = new URL(href, p.finalUrl).href
        jobs.push(getJson(abs).then(j => {
          push(j?.thumbnail_url, 1, "page oEmbed")
          if (j?.type === "photo") push(j.url, 1, "page oEmbed photo")
          if (j?.title && !title) title = String(j.title)
        }).catch(() => {}))
      } catch {}
    }
  }

  jobs.push(getJson(`https://noembed.com/embed?url=${enc}`, 9000).then(j => {
    push(j?.thumbnail_url, 2, "noembed")
    if (j?.title && !title) title = String(j.title)
  }).catch(() => {}))

  jobs.push(getJson(`https://api.microlink.io/?url=${enc}`, 12000).then(j => {
    const d = j?.data
    push(d?.image?.url, 2, "microlink image")
    push(d?.logo?.url, 4, "microlink logo")
    if (d?.title && !title) title = String(d.title)
    if (d?.description && !description) description = String(d.description)
  }).catch(() => {}))

  await Promise.all(jobs)
  return { cands, title, description }
}

// ── wave 3: screenshots, then icons ──────────────────────────────────────────

function lastResortCandidates(finalUrl) {
  const enc = encodeURIComponent(finalUrl)
  const host = hostOf(finalUrl)
  return [
    { url: `https://api.microlink.io/?url=${enc}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1200&viewport.height=630`, tier: 8, source: "microlink screenshot" },
    { url: `https://s.wordpress.com/mshots/v1/${enc}?w=1200&h=630`, tier: 8, source: "wordpress screenshot", retries: 4, retryDelay: 2500 },
    { url: `https://image.thum.io/get/width/1200/crop/630/noanimate/${finalUrl}`, tier: 8, source: "thum.io screenshot" },
    { url: `https://www.google.com/s2/favicons?domain=${host}&sz=256`, tier: 9, source: "site icon (google)" },
  ]
}

// ── image check + squeeze ────────────────────────────────────────────────────

// returns { buffer, width, height } (JPEG ≤ ~250 KB) or null if the image is unusable
async function compressForCard(raw, tier) {
  if (!sharp) {
    return isJpegBuffer(raw) && raw.length <= ENGINE_MAX_BYTES + 50 * 1024 ? { buffer: raw, width: 0, height: 0 } : null
  }

  let meta
  try { meta = await sharp(raw, { failOn: "none" }).metadata() } catch { return null }
  const w = meta.width || 0
  const h = meta.height || 0
  if (!w || !h) return null

  const isIcon = tier >= 9
  if (isIcon) {
    if (w < 48 || h < 48) return null
    try {
      const icon = await sharp(raw, { failOn: "none" }).resize({ width: 280, height: 280, fit: "inside" }).png().toBuffer()
      const bg = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e2e8f0"/><stop offset="1" stop-color="#cbd5e1"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>`)
      const out = await sharp(bg).composite([{ input: icon, gravity: "center" }]).jpeg({ quality: 82 }).toBuffer()
      return { buffer: out, width: 1200, height: 630 }
    } catch { return null }
  }

  if (w < 200 || h < 120) return null                 // thumbnails/trackers
  const ratio = w / h
  if (ratio > 4.5 || ratio < 0.25) return null        // banners/skyscrapers

  for (const width of [1200, 960, 720, 540, 400]) {
    for (const quality of [82, 70, 58, 46]) {
      try {
        const out = await sharp(raw, { failOn: "none" })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer()
        if (out.length <= ENGINE_MAX_BYTES) {
          const sw = Math.min(width, w)
          return { buffer: out, width: sw, height: Math.round(h * sw / w) }
        }
      } catch { return null }
    }
  }
  return null
}

async function tryImage(cand, deadline, referer) {
  const attempts = (cand.retries || 0) + 1
  for (let i = 0; i < attempts; i++) {
    const left = deadline - Date.now()
    if (left < 1200) throw new Error("time budget used up")

    const res = await httpGet(cand.url, {
      ua: ENGINE_UAS.browser,
      timeout: Math.min(cand.tier >= 8 ? 20000 : 8000, left),
      max: 12 * 1024 * 1024,
      accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      headers: referer ? { Referer: referer } : undefined,
    })
    const contentType = String(res.headers?.["content-type"] || "").toLowerCase()
    const raw = Buffer.from(res.data || [])

    // WordPress mshots answers with a "generating…" GIF until the shot is ready
    if (cand.retries && contentType.includes("gif")) {
      if (i < attempts - 1) { await engineSleep(cand.retryDelay || 2500); continue }
      throw new Error("screenshot not ready")
    }
    if (raw.length < 400) throw new Error("too small")
    if (/text\/|json|html/.test(contentType)) throw new Error("not an image")

    const card = await compressForCard(raw, cand.tier)
    if (!card) throw new Error("rejected (too small, odd shape or unreadable)")
    return { ...card, url: cand.url, source: cand.source, tier: cand.tier }
  }
  throw new Error("not ready")
}

// tries candidates best-first, four at a time; first good one wins
async function firstGoodImage(cands, deadline, referer, tried, label) {
  const list = cands.filter(c => !tried.has(c.url)).slice(0, 28)
  engineLog(`${label}: trying up to ${list.length} image candidates`)
  for (let i = 0; i < list.length; i += 4) {
    if (deadline - Date.now() < 1500) return null
    const chunk = list.slice(i, i + 4)
    chunk.forEach(c => tried.add(c.url))
    const runs = chunk.map(c => tryImage(c, deadline, referer).then(r => ({ ok: true, r }), e => ({ ok: false, e, c })))
    for (const run of runs) {                 // in priority order, but never wait for losers
      const res = await run
      if (res.ok) return res.r
      engineLog(`  ✗ ${res.c.source}: ${res.e.message}`)
    }
  }
  return null
}

function dedupeBest(list) {
  const best = new Map()
  for (const c of list) {
    const prev = best.get(c.url)
    if (!prev || c.tier < prev.tier) best.set(c.url, c)
  }
  return [...best.values()].sort((a, b) => a.tier - b.tier)   // stable: known-site results stay first within a tier
}

const BLOCK_TITLE = /just a moment|attention required|access denied|403 forbidden|captcha|robot check|are you a human|enable javascript/i

// → { title, description, canonicalUrl, image: {buffer,width,height,source,url}|null, ms }
async function resolveLinkImage(url) {
  const cached = engineCache.get(url)
  if (cached && Date.now() - cached.at < ENGINE_CACHE_MS) {
    engineLog("cache hit", url)
    return cached.data
  }

  const t0 = Date.now()
  const deadline = t0 + engineBudgetMs()
  const tried = new Set()
  engineLog("START", url)

  // ── WAVE 1
  const [pages, known] = await Promise.all([
    collectPages(url).catch(() => []),
    resolveKnownSites(url).catch(() => ({ cands: [], title: "" })),
  ])

  let title = "", description = ""
  let finalUrl = pages.find(p => p.finalUrl)?.finalUrl || toFetchUrl(url)
  let canonicalUrl = ""
  for (const p of pages) {
    if (!p.html) continue
    const t = safeText(readMeta(p.html, ["og:title", "twitter:title"]) || decodeEntities(p.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]), 120)
    const d = safeText(readMeta(p.html, ["og:description", "twitter:description", "description"]), 220)
    if (t && !BLOCK_TITLE.test(t) && !title) title = t
    if (d && !description) description = d
    if (!canonicalUrl) canonicalUrl = readMeta(p.html, ["og:url"]) || ""
  }

  const pageCands = []
  for (const p of pages) {
    if (p.directImage) pageCands.push({ url: p.directImage, tier: 1, source: "direct image link" })
    if (p.html) pageCands.push(...deepCandidates(p.html, p.finalUrl))
  }
  engineLog(`wave 1: ${pages.length} page(s) read, ${pageCands.length} page candidates, ${known.cands.length} site candidates`)

  let image = await firstGoodImage(dedupeBest([...known.cands, ...pageCands]), deadline, finalUrl, tried, "wave 1")

  // ── WAVE 2
  if (!image && deadline - Date.now() > 4000) {
    const generic = await resolveGeneric(url, pages).catch(() => ({ cands: [], title: "", description: "" }))
    if (!title && generic.title) title = safeText(generic.title, 120)
    if (!description && generic.description) description = safeText(generic.description, 220)
    image = await firstGoodImage(dedupeBest(generic.cands), deadline, finalUrl, tried, "wave 2")
  }

  // ── WAVE 3
  if (!image && deadline - Date.now() > 4000) {
    image = await firstGoodImage(lastResortCandidates(finalUrl), deadline, finalUrl, tried, "wave 3")
  }

  if (!title && known.title) title = safeText(known.title, 120)
  if (!title) title = hostOf(finalUrl) || "Link preview"

  const data = {
    title,
    description,
    canonicalUrl: canonicalUrl || finalUrl,
    image,
    ms: Date.now() - t0,
  }
  engineLog(image
    ? `DONE in ${data.ms} ms — image from "${image.source}" (${image.width}x${image.height}, ${Math.round(image.buffer.length / 1024)} KB)`
    : `DONE in ${data.ms} ms — no image found anywhere`)

  if (image) engineCache.set(url, { at: Date.now(), data })
  return data
}

function isJpegBuffer(buf) {
  return buf?.[0] === 0xff && buf?.[1] === 0xd8
}

async function makeSmallThumb(buf) {
  if (sharp) {
    try { return await sharp(buf).resize({ width: 192, withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer() } catch {}
  }
  return isJpegBuffer(buf) && buf.length <= 40000 ? buf : null
}

function escapeXml(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c])
}

async function makeFallbackThumb(host, title) {
  if (!sharp) return null
  const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#164e63"/></linearGradient></defs><rect width="640" height="360" rx="32" fill="url(#g)"/><circle cx="566" cy="70" r="120" fill="#22d3ee" opacity=".12"/><text x="48" y="104" fill="#67e8f9" font-family="Arial,sans-serif" font-size="24" font-weight="700">LINK PREVIEW</text><text x="48" y="190" fill="#fff" font-family="Arial,sans-serif" font-size="32" font-weight="700">${escapeXml(String(title || "").slice(0, 32))}</text><text x="48" y="250" fill="#cbd5e1" font-family="Arial,sans-serif" font-size="24">${escapeXml(String(host || "").slice(0, 42))}</text></svg>`
  try { return await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer() } catch { return null }
}

// Uploads the BIG card image to WhatsApp ("thumbnail-link" media type).
async function uploadBigThumb(sock, buf) {
  if (typeof baileys.prepareWAMessageMedia !== "function") return null
  const { imageMessage } = await baileys.prepareWAMessageMedia(
    { image: buf },
    { upload: sock.waUploadToServer, mediaTypeOverride: "thumbnail-link" }
  )
  return imageMessage || null
}

// returns { matchedText, canonicalUrl, title, description, jpegThumbnail, hq, imageSource } or null
async function fetchLinkPreview(sock, url) {
  const r = await resolveLinkImage(url)

  let jpegThumbnail = null
  let hq = null
  let imageSource = "none"

  if (r.image) {
    imageSource = r.image.source
    jpegThumbnail = await makeSmallThumb(r.image.buffer)
    // big card image: upload to WhatsApp, one retry if it fails
    for (let attempt = 1; attempt <= 2 && !hq; attempt++) {
      hq = await withTimeout(uploadBigThumb(sock, r.image.buffer), 20000, "thumbnail upload")
        .catch(e => { console.warn(`[GCSTATUS] big thumbnail upload attempt ${attempt} failed:`, e.message); return null })
    }
  }

  if (!jpegThumbnail) {
    const host = hostOf(r.canonicalUrl) || "Link preview"
    jpegThumbnail = await makeFallbackThumb(host, r.title)
    imageSource = jpegThumbnail ? "generated card (no image found)" : "none"
  }

  console.log("[GCSTATUS] Link preview", { title: r.title, imageSource, hasSmallThumb: !!jpegThumbnail, hasBigThumb: !!hq, bigThumbPath: hq?.directPath || null, engineMs: r.ms })
  return {
    matchedText: url,
    canonicalUrl: r.canonicalUrl,
    title: r.title,
    description: r.description || "",
    jpegThumbnail,
    hq,
    imageSource,
  }
}

// ── TEXT status ──────────────────────────────────────────────────────────────

async function buildTextStatus(sock, groupJid, text, userJid, preview, bg) {
  const secret = crypto.randomBytes(32)
  const linkPreview = preview ? {
    "canonical-url": preview.canonicalUrl || toFetchUrl(preview.matchedText),
    "matched-text": preview.matchedText || extractFirstUrl(text) || text,
    title: preview.title,
    description: preview.description || "",
    jpegThumbnail: preview.jpegThumbnail,
    highQualityThumbnail: preview.hq || undefined,
  }
  : undefined

  // Use Baileys' content builder for linkPreview fields and thumbnail
  // serialization, then add the Group Status context and wrapper.
  const prepared = await generateWAMessageContent(
    { text, linkPreview: linkPreview || null },
    { upload: sock.waUploadToServer, logger: Pino({ level: "silent" }) }
  )

  const inner = prepared?.message || prepared

  if (!inner?.extendedTextMessage) {
    throw new Error(`Text status content was not generated (got: ${Object.keys(prepared || {}).join(", ") || "nothing"})`)
  }

  const ext = inner.extendedTextMessage

  ext.contextInfo = {
    ...(ext.contextInfo || {}),
    ...buildStatusContext(STATUS_SOURCE.text),
  }

  // background color + readable white text + font
  ext.backgroundArgb = bg ?? pickBackground()
  ext.textArgb = textColorFor(ext.backgroundArgb)
  ext.font = 2

  // Some baileys forks don't copy highQualityThumbnail onto the message.
  // If the big image was uploaded but the fields are missing, write them here
  // so the card actually shows its image.
  if (preview?.hq && !ext.thumbnailDirectPath) {
    const h = preview.hq
    ext.thumbnailDirectPath = h.directPath
    ext.thumbnailSha256 = h.fileSha256
    ext.thumbnailEncSha256 = h.fileEncSha256
    ext.thumbnailHeight = h.height
    ext.thumbnailWidth = h.width
    ext.mediaKey = h.mediaKey
    ext.mediaKeyTimestamp = h.mediaKeyTimestamp
    console.log("[GCSTATUS] Big thumbnail fields written onto the message manually")
  }

  inner.messageContextInfo = {
    ...(inner.messageContextInfo || {}),
    messageSecret: secret,
  }

  return makeGroupStatusMessage(groupJid, inner, userJid, secret)
}

async function relayStatus(sock, group, status, type) {
  console.log("[GCSTATUS] Relaying Group Status", {
    group: group.id,
    messageId: status.key.id,
    type,
  })

  await sock.relayMessage(group.id, status.message, { messageId: status.key.id })

  console.log("[GCSTATUS] relayMessage completed", status.key.id)
  return status
}

// ── MEDIA status ─────────────────────────────────────────────────────────────

function runFfmpeg(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: "ignore" })
    const timer = setTimeout(() => { try { p.kill("SIGKILL") } catch {} ; reject(new Error("ffmpeg timeout")) }, timeoutMs)
    p.on("error", e => { clearTimeout(timer); reject(e) })
    p.on("close", code => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    })
  })
}

// Group status audio is a voice note → WhatsApp wants ogg/opus.
// Converts anything else when ffmpeg exists; otherwise sends it as-is.
async function prepareAudio(buffer, mimetype) {
  const mt = String(mimetype || "")
  if (/ogg/i.test(mt) && /opus/i.test(mt)) {
    return { buffer, mimetype: "audio/ogg; codecs=opus" }
  }

  const id = crypto.randomBytes(6).toString("hex")
  const inPath = path.join(os.tmpdir(), `gcs-${id}.in`)
  const outPath = path.join(os.tmpdir(), `gcs-${id}.ogg`)

  try {
    await fs.promises.writeFile(inPath, buffer)
    await runFfmpeg([
      "-y", "-i", inPath, "-vn",
      "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1",
      "-f", "ogg", outPath,
    ])
    const out = await fs.promises.readFile(outPath)
    if (out.length < 100) throw new Error("ffmpeg produced an empty file")
    console.log("[GCSTATUS] Audio converted to ogg/opus", { from: mt || "unknown", bytes: out.length })
    return { buffer: out, mimetype: "audio/ogg; codecs=opus" }
  } catch (e) {
    console.warn(`[GCSTATUS] Audio conversion skipped (${e.message}) — sending original`)
    return { buffer, mimetype: mt || "audio/mpeg" }
  } finally {
    await fs.promises.unlink(inPath).catch(() => {})
    await fs.promises.unlink(outPath).catch(() => {})
  }
}

async function buildMediaInput(content) {
  const { type, node, buffer } = content
  const input = {}

  if (type === "audio") {
    const audio = await prepareAudio(buffer, node.mimetype)
    input.audio = audio.buffer
    input.mimetype = audio.mimetype
    input.ptt = true
    return input
  }

  input[type] = buffer
  input.mimetype = node.mimetype || (type === "image" ? "image/jpeg" : "video/mp4")
  if (node.caption) input.caption = node.caption
  if (type === "video" && node.gifPlayback) input.gifPlayback = true
  return input
}

// ENGINE 1 (default): wrapped in groupStatusMessageV2 — same shape as the text
// path that already works, relayed with relayMessage().
async function sendWrappedMedia(sock, groupJid, content) {
  const kind = statusKind(content)
  const input = await buildMediaInput(content)
  const mediaKey = `${content.type}Message`

  console.log("[GCSTATUS] Uploading media for Group Status", {
    type: content.type,
    kind,
    bytes: content.buffer.length,
    mimetype: input.mimetype,
  })

  const prepared = await generateWAMessageContent(
    input,
    {
      upload: sock.waUploadToServer,
      logger: Pino({ level: "silent" }),
    }
  )

  if (!prepared) throw new Error("Media pipeline returned nothing")

  const inner = prepared?.message || prepared

  const mediaMessage = inner?.[mediaKey]
  if (!mediaMessage) {
    throw new Error(
      `Upload produced no ${mediaKey} (got: ${Object.keys(prepared).join(", ") || "nothing"})`
    )
  }

  mediaMessage.contextInfo = {
    ...(mediaMessage.contextInfo || {}),
    ...buildStatusContext(STATUS_SOURCE[kind]),
  }

  // voice-note statuses get a background color too
  if (content.type === "audio") {
    mediaMessage.backgroundArgb = content.bg ?? pickBackground()
  }

  console.log("[GCSTATUS] Media uploaded", {
    hasUrl: !!mediaMessage.url,
    hasDirectPath: !!mediaMessage.directPath,
    hasMediaKey: !!mediaMessage.mediaKey,
    fileLength: mediaMessage.fileLength ? String(mediaMessage.fileLength) : null,
  })

  const status = makeGroupStatusMessage(
    groupJid,
    inner,
    sock.user?.id,
    crypto.randomBytes(32)
  )

  await relayStatus(sock, { id: groupJid }, status, content.type)
  return status
}

// ENGINE 2 (--flat): ordinary media message carrying the group-status
// contextInfo. No wrapper → no mediatype problem. Fallback only.
async function sendFlatMedia(sock, groupJid, content) {
  const kind = statusKind(content)
  const input = await buildMediaInput(content)

  input.contextInfo = {
    isGroupStatus: true,
    statusSourceType: STATUS_SOURCE_NAME[kind],
    statusAttributions: [{ type: 10 }],
    statusAudienceMetadata: { audienceType: "CLOSE_FRIENDS" },
  }

  console.log("[GCSTATUS] Sending FLAT media (--flat engine)", { type: content.type, kind })

  const sent = await sendMessageUnstyled(sock, groupJid, input)
  console.log("[GCSTATUS] flat send completed", sent?.key?.id)
  return sent
}

// ── library patch diagnostics ────────────────────────────────────────────────

const LIB_PACKAGES = ["@systemzero/baileys", "@whiskeysockets/baileys"]

async function pkgRoot(name) {
  let dir
  try { dir = path.dirname(require.resolve(name)) } catch { return null }
  for (let i = 0; i < 6; i++) {
    const pj = path.join(dir, "package.json")
    try {
      if (JSON.parse(await fs.promises.readFile(pj, "utf8")).name === name) return dir
    } catch {}
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

async function findSendFiles(dir, depth = 0, out = []) {
  if (depth > 5) return out
  let entries = []
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await findSendFiles(full, depth + 1, out)
    else if (/^messages-send\.(c|m)?js$/.test(e.name)) out.push(full)
  }
  return out
}

function isMediaTypeFixed(src) {
  return (
    src.includes("__gsInner(") ||
    /getMediaType\)?\(\s*(?:\(0,\s*[\w$.]+\.normalizeMessageContent\)|normalizeMessageContent)\(/.test(src)
  )
}

async function inspectLib() {
  const report = []
  for (const name of LIB_PACKAGES) {
    const root = await pkgRoot(name)
    if (!root) continue
    for (const file of await findSendFiles(root)) {
      let src = ""
      try { src = await fs.promises.readFile(file, "utf8") } catch { continue }
      report.push({ name, file, fixed: isMediaTypeFixed(src) })
    }
  }
  return report
}

// ── POST TO EVERY GROUP  (.gcstatus all) ─────────────────────────────────────
// Reply to any content in your DM and send:  .gcstatus all
// The media is downloaded + uploaded ONCE and re-used for every group, groups are
// posted one-by-one with a short pause (so WhatsApp doesn't see a burst), and it
// runs in the background — the command answers instantly and reports at the end.
//   .gcstatus all stop   cancels a running job
//   GCSTATUS_ALL_DELAY_MS=2500  (.env) changes the pause between groups
//   GCSTATUS_ALL_JITTER_MS=800  (.env) extra random 0–800ms added to each pause

const bulkJobs = new Map() // session phone -> { cancel, total, done }
const MAX_CONSECUTIVE_FAILS = 5

const sleep = ms => new Promise(r => setTimeout(r, ms))

function allDelayMs() {
  const n = parseInt(process.env.GCSTATUS_ALL_DELAY_MS, 10)
  return Number.isFinite(n) && n >= 0 ? n : 2500
}

function allJitterMs() {
  const n = parseInt(process.env.GCSTATUS_ALL_JITTER_MS, 10)
  return Number.isFinite(n) && n >= 0 ? n : 800
}

function sessionKey(sock) {
  return String(sock.user?.id || "").replace(/@.+$/, "").replace(/:\d+$/, "").replace(/\D/g, "") || "session"
}

// same upload as sendWrappedMedia(), but WITHOUT sending — so it can be reused per group
async function prepareWrappedMedia(sock, content) {
  const kind = statusKind(content)
  const input = await buildMediaInput(content)
  const mediaKey = `${content.type}Message`

  console.log("[GCSTATUS ALL] Uploading media once", { type: content.type, kind, bytes: content.buffer.length })

  const prepared = await generateWAMessageContent(
    input,
    { upload: sock.waUploadToServer, logger: Pino({ level: "silent" }) }
  )
  if (!prepared) throw new Error("Media pipeline returned nothing")

  const inner = prepared?.message || prepared

  const mediaMessage = inner?.[mediaKey]
  if (!mediaMessage) {
    throw new Error(`Upload produced no ${mediaKey} (got: ${Object.keys(prepared).join(", ") || "nothing"})`)
  }

  mediaMessage.contextInfo = {
    ...(mediaMessage.contextInfo || {}),
    ...buildStatusContext(STATUS_SOURCE[kind]),
  }

  if (content.type === "audio") {
    mediaMessage.backgroundArgb = content.bg ?? pickBackground()
  }

  return { inner, mediaKey, type: content.type }
}

// one group: fresh message secret + fresh message id, shared (already uploaded) media
async function publishPrepared(sock, groupJid, prep) {
  const secret = crypto.randomBytes(32)
  const inner = {
    ...prep.inner,
    [prep.mediaKey]: { ...prep.inner[prep.mediaKey] },
    messageContextInfo: { ...(prep.inner.messageContextInfo || {}), messageSecret: secret },
  }

  const status = makeGroupStatusMessage(groupJid, inner, sock.user?.id, secret)

  await relayStatus(sock, { id: groupJid }, status, prep.type)
  return status
}

async function runAllGroups({ sock, from, msg, sub, flat, noPreview, bg }) {
  const reply = text => statusReply(sock, msg, text)
  const key = sessionKey(sock)
  const running = bulkJobs.get(key)

  // ── .gcstatus all stop ─────────────────────────────────────────────────────
  if (sub === "stop") {
    if (!running) return reply("> ℹ️ *No bulk Group Status is running.*")
    running.cancel = true
    return reply(`> 🛑 *Stopping after the current group…*\n> Done so far: *${running.done}/${running.total}*`)
  }

  if (running) {
    return reply(`> ⏳ *A bulk Group Status is already running* (${running.done}/${running.total}).\n> Send *.gcstatus all stop* to cancel it.`
    )
  }

  const quoted = getQuotedInfo(msg)
  if (!quoted) {
    return reply("> ❌ *Reply to the content you want to post, then send .gcstatus all*")
  }

  const content = getContent(quoted.quotedMessage)
  if (!content) return reply("> ❌ *Unsupported quoted message.*")
  if (content.type !== "text" && !SUPPORTED_MEDIA.has(content.type)) {
    return reply(`> ❌ *${content.type} is not currently a supported WhatsApp Group Status media type.*\n>\n> Supported: *image, video, audio, text*`
    )
  }

  // ── every group this account is in ─────────────────────────────────────────
  let groups
  try {
    const all = await sock.groupFetchAllParticipating()
    groups = Object.values(all || {})
      .filter(g => g?.id?.endsWith("@g.us"))
      .sort((a, b) => String(a.subject || "").localeCompare(String(b.subject || ""), undefined, { sensitivity: "base" }))
  } catch (e) {
    return reply(`> ❌ *Couldn't fetch the group list.*\n> ${e.message}`)
  }
  if (!groups.length) return reply("> ❌ *This account isn't in any groups.*")

  // ── prepare ONCE (download / upload / link preview) ────────────────────────
  let publish
  try {
    if (content.type === "text") {
      const textValue = originalText(content.node)
      if (!textValue.trim()) throw new Error("The quoted text message is empty.")

      let preview = null
      const link = noPreview ? null : extractFirstUrl(textValue)
      if (link) {
        try { preview = await withTimeout(fetchLinkPreview(sock, link), engineBudgetMs() + 30000, "link preview") }
        catch (e) { console.warn(`[GCSTATUS ALL] Link preview skipped: ${e.message}`) }
      }

      publish = async (g) => {
        const st = await buildTextStatus(sock, g.id, textValue, sock.user?.id, preview, bg)
        await relayStatus(sock, g, st, "text")
      }
    } else {
      content.buffer = await downloadMedia(sock, content.node, content.type, quoted, from)
      content.bg = bg

      if (flat) {
        publish = (g) => sendFlatMedia(sock, g.id, content)
      } else {
        const prep = await prepareWrappedMedia(sock, content)
        publish = (g) => publishPrepared(sock, g.id, prep)
      }
    }
  } catch (e) {
    console.error("[GCSTATUS ALL] prepare failed", e)
    return reply(`> ❌ *Couldn't prepare the content.*\n> ${e.message}`)
  }

  const job = { cancel: false, total: groups.length, done: 0 }
  bulkJobs.set(key, job)

  const delay = allDelayMs()
  const etaMin = Math.max(1, Math.round((groups.length * (delay + allJitterMs() / 2 + 700)) / 60000))

  await reply(`> 📤 *Posting to ALL groups…*\n>\n> Groups: *${groups.length}*\n> Type: *${content.type}*${flat ? " (flat)" : ""}\n> Estimated time: ~${etaMin} min\n>\n> Send *.gcstatus all stop* to cancel.\n>\n${CREDIT}`
  ).catch(() => {})

  // ── run in the background so the command itself returns right away ─────────
  ;(async () => {
    const ok = []
    const failed = []
    let streak = 0
    let aborted = false

    try {
      for (const g of groups) {
        if (job.cancel) break

        try {
          await publish(g)
          ok.push(g)
          streak = 0
        } catch (e) {
          failed.push({ g, reason: e.message })
          streak++
          console.error(`[GCSTATUS ALL] ✗ ${g.subject || g.id}: ${e.message}`)
        }
        job.done++

        if (streak >= MAX_CONSECUTIVE_FAILS) { aborted = true; break }

        if (job.done % 20 === 0 && job.done < groups.length && !job.cancel) {
          reply(`> ⏳ *Progress:* ${job.done}/${job.total}  (✅ ${ok.length}  ❌ ${failed.length})`).catch(() => {})
        }

        if (job.done < groups.length && !job.cancel) {
          await sleep(delay + Math.floor(Math.random() * (allJitterMs() + 1))) // small random jitter
        }
      }
    } finally {
      bulkJobs.delete(key)
    }

    const head = job.cancel
      ? "🛑 *Bulk Group Status cancelled.*"
      : aborted
        ? `⚠️ *Stopped — ${MAX_CONSECUTIVE_FAILS} failures in a row (connection problem?).*`
        : "✅ *Bulk Group Status finished.*"

    const failLines = failed.slice(0, 8).map(f => `> • ${f.g.subject || f.g.id} — ${String(f.reason).slice(0, 60)}`)
    const more = failed.length > 8 ? `\n> …and ${failed.length - 8} more` : ""

    const summary =
      `> ${head}\n>\n> Type: *${content.type}*\n> Posted: *${ok.length}* / ${job.total}\n> Failed: *${failed.length}*` +
      (failLines.length ? `\n>\n${failLines.join("\n")}${more}` : "") +
      `\n>\n${CREDIT}`

    console.log(`[GCSTATUS ALL] done — posted ${ok.length}/${job.total}, failed ${failed.length}`)
    await reply(summary).catch(() => {})
  })().catch(e => console.error("[GCSTATUS ALL] crashed:", e))
}

// ── the command ──────────────────────────────────────────────────────────────

module.exports = {
  name: "gcstatus",
  heavy: true,
  media: true,
  independent: true,
  aliases: ["groupstatus"],

  desc: "Publish replied content (text, image, video, audio) to a WhatsApp Group Status.",

  usage: ".gcstatus <group name|GID|invite link> | .gcstatus all (every group) | .gcstatus all stop | or .gcstatus inside a group  (flags: --nopreview skips the link card, --color=red picks the background, --flat = fallback engine; .gcstatus check = diagnostics)",

  category: "owner",

  async run({ sock, from, msg, text, isOwner, isGroup }) {
    const reply = text => statusReply(sock, msg, text)
    if (!isOwner) return sendOwnerRestricted(sock, msg?.key?.remoteJid, msg)

    let destination = String(text || "").trim()

    // diagnostics
    if (destination.toLowerCase() === "check") {
      const report = await inspectLib()
      if (!report.length) {
        return reply("> ⚠️ *Couldn't locate the baileys library files to inspect.*")
      }
      const lines = report.map(r => `> ${r.fixed ? "✅" : "❌"} ${r.name}\n>    ${r.file.split("node_modules/")[1] || r.file}`)
      const allFixed = report.every(r => r.fixed)
      return reply(`> 🔎 *Group Status library check*\n>\n${lines.join("\n")}\n>\n> ${allFixed ? "All good — media group status should work." : "Run: *node patch-gcstatus-lib.js* then restart the bot."}`
      )
    }

    // list the available colors
    if (destination.toLowerCase() === "colors") {
      const c = colorSummary()
      const names = Object.keys(STATUS_COLORS).sort().join(", ")
      return reply(`> 🎨 *Group Status colors*\n>\n> Primary: *${c.primary}* | Secondary: *${c.secondary}* | Tertiary: *${c.tertiary}* | CSS named: *${c.css}*\n> Total names: *${c.names}* (${c.shades} unique shades, no black)\n>\n> Use: *--color=red*, *--color=#ff8800*, *--color=primary|secondary|tertiary|css*, or leave it out for random.\n>\n> ${names}`
      )
    }

    // flags: --flat  --nopreview  --color=NAME
    const flat = /(^|\s)--flat(?=\s|$)/i.test(destination)
    const noPreview = /(^|\s)--nopreview(?=\s|$)/i.test(destination)
    const colorFlag = destination.match(/(^|\s)--color=(\S+)(?=\s|$)/i)?.[2]
    destination = destination.replace(/(^|\s)--(?:flat|nopreview|color=\S+)(?=\s|$)/gi, " ").trim()
    const bg = pickBackground(colorFlag)

    // .gcstatus all  /  .gcstatus all stop  → every group the bot is in
    const words = destination.split(/\s+/).filter(Boolean)
    if (words[0] && words[0].toLowerCase() === "all") {
      return runAllGroups({ sock, from, msg, sub: (words[1] || "").toLowerCase(), flat, noPreview, bg })
    }

    const quoted = getQuotedInfo(msg)

    if (!quoted) {
      return reply("> ❌ *Reply to the content you want to publish with .gcstatus.*"
      )
    }

    let group

    try {
      if (isGroup && !destination) {
        group = await sock.groupMetadata(from)
      } else {
        if (!destination) {
          return reply("> ❌ *Give me a group name, GID, or WhatsApp group invite link.*"
          )
        }
        group = await findGroup(sock, destination)
      }
    } catch (e) {
      return reply(`> ❌ *${e.message}*`)
    }

    if (!group?.id) {
      return reply("> ❌ *Group not found.*\n> Use *.gcjid* to see the available groups."
      )
    }

    const content = getContent(quoted.quotedMessage)

    if (!content) {
      return reply("> ❌ *Unsupported quoted message.*")
    }

    console.log("[GCSTATUS] Content detected", {
      type: content.type,
      group: group.id,
      subject: group.subject || group.id,
      engine: content.type === "text" ? "text" : flat ? "flat" : "wrapped",
    })

    let preview = null

    try {
      let status

      // ── TEXT ──────────────────────────────────────────────────────────────
      if (content.type === "text") {
        const textValue = originalText(content.node)

        if (!textValue.trim()) throw new Error("The quoted text message is empty.")

        // link in the text? build the preview card (image + title + description)
        const link = noPreview ? null : extractFirstUrl(textValue)
        if (link) {
          try {
            preview = await withTimeout(fetchLinkPreview(sock, link), engineBudgetMs() + 30000, "link preview")
          } catch (e) {
            console.warn(`[GCSTATUS] Link preview skipped: ${e.message}`)
          }
        }

        status = await buildTextStatus(sock, group.id, textValue, sock.user?.id, preview, bg)
        await relayStatus(sock, group, status, "text")
      }

      // ── IMAGE / VIDEO / AUDIO ─────────────────────────────────────────────
      else {
        if (!SUPPORTED_MEDIA.has(content.type)) {
          return reply(`> ❌ *${content.type} is not currently a supported WhatsApp Group Status media type.*\n>\n> Supported: *image, video, audio, text*`
          )
        }

        content.buffer = await downloadMedia(sock, content.node, content.type, quoted, from)
        content.bg = bg

        status = flat
          ? await sendFlatMedia(sock, group.id, content)
          : await sendWrappedMedia(sock, group.id, content)

        console.log("[GCSTATUS] MEDIA SEND COMPLETE", {
          group: group.id,
          type: content.type,
          messageId: status?.key?.id || null,
        })
      }

      // warn if the library still has the mediatype bug (wrapped media only)
      const previewNote = preview ? `\n> Link card: *attached*${preview.hq ? " (big image)" : preview.jpegThumbnail ? " (small image)" : ""}\n> Image source: *${preview.imageSource || "unknown"}*` : ""
      let warn = ""
      if (content.type !== "text" && !flat) {
        // inspectLib() is async — it must be awaited (this used to throw here)
        let unfixed = []
        try { unfixed = (await inspectLib()).filter(r => !r.fixed) } catch {}
        if (unfixed.length) {
          warn = `\n>\n> ⚠️ *Library not patched yet* — media may not show.\n> Run *node patch-gcstatus-lib.js* and restart.`
        }
      }

      // When invoked from a group, keep the chat quiet after a successful
      // publish and acknowledge the command itself with a reaction. Derive
      // this from the actual chat JID so a missing/stale isGroup flag cannot
      // leak the success report into the group.
      if (typeof from === "string" && from.endsWith("@g.us")) {
        try {
          await sock.sendMessage(from, {
            react: {
              text: "✅",
              key: msg.key,
            },
          })
        } catch (e) {
          console.warn("[GCSTATUS] Success reaction failed:", e.message)
        }
        return
      }

      return reply(`> ✅ *Group Status send completed.*\n>\n> Group: *${group.subject || group.id}*\n> GID: ${group.id}\n> Type: *${content.type}*${flat ? " (flat)" : ""}${previewNote}\n> Message ID: ${status?.key?.id || "unknown"}${warn}\n>\n${CREDIT}`
      )
    } catch (e) {
      console.error("[GCSTATUS FAILED]", e)
      return reply(`> ❌ *Group Status failed.*\n> ${e.message}`)
    }
  },
}
