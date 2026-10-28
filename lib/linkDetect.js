'use strict'
// ════════════════════════════════════════════════════════════════════
//  lib/linkDetect.js  —  ZENX | link detector for anti-link
//
//  Finds links in a WhatsApp message the way spammers actually send them:
//   • WhatsApp CHANNEL links   whatsapp.com/channel/…
//   • WhatsApp group invites   chat.whatsapp.com/…   (and the invite CARD message)
//   • wa.me / api.whatsapp.com, Telegram, Discord, any http(s)://, www., and bare
//     domains like  example.com/page  or  foo.xyz
//   • disguised links:  chat[.]whatsapp[.]com   chat . whatsapp . com   hxxps://
//     fullwidth letters (ｃｈａｔ．ｗｈａｔｓａｐｐ．ｃｏｍ), zero-width characters, escaped slashes
//   • links hidden in: captions, document names, buttons, lists, polls, contact cards,
//     locations, link-preview fields, ad-reply buttons — and in EDITED messages
//   It never counts a quoted (replied-to) message, and never flags e-mail addresses.
//
//  USE (from your anti-link engine):
//      const { scan } = require('./linkDetect').linkDetect
//      const r = scan(msg.message, { allow: ['youtube.com'] })
//      if (r.hit) { /* r.links = [{kind, value}], r.kinds = ['whatsapp-channel', …] */ }
//
//  .env:  ANTILINK_ALLOW=youtube.com,example.org   (domains that are always OK)
//         ANTILINK_BLOCK_CHANNEL_FORWARDS=1        (also treat forwarded channel posts as links)
// ════════════════════════════════════════════════════════════════════

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u00AD\uFEFF\u180E]/g
const LOOKALIKE_DOTS = /[。｡．․‧﹒⋅]/g

const STRONG_TLDS = [
  'com', 'net', 'org', 'io', 'gg', 'ly', 'xyz', 'site', 'online', 'link', 'app', 'dev', 'ai', 'tv', 'cc', 'ng', 'gh', 'ke', 'za',
  'co', 'info', 'biz', 'store', 'shop', 'top', 'club', 'vip', 'click', 'live', 'me', 'to', 'us', 'uk', 'ru', 'cn', 'in', 'ws', 'sh',
  'fm', 'gl', 'ink', 'cloud', 'pro', 'space', 'tech', 'website', 'page', 'world', 'today', 'fun', 'life', 'news', 'blog', 'win',
  'bid', 'stream', 'icu', 'work', 'zone', 'download', 'rest', 'fit', 'buzz', 'digital', 'media', 'network', 'email', 'group',
  'chat', 'run', 'best', 'one', 'cam', 'sbs', 'cfd', 'lol', 'tk', 'ml', 'ga', 'cf', 'gq', 'ng',
].join('|')

// ── turn tricks into plain text ──────────────────────────────────────
function normalize(text) {
  let t = String(text || '')
    .normalize('NFKC')                                   // fullwidth letters/dots → normal ones
    .replace(ZERO_WIDTH, '')
    .replace(LOOKALIKE_DOTS, '.')
    .replace(/\\\//g, '/')                               // "https:\/\/" inside JSON
  t = t.replace(/\s*[\[\(\{<]\s*(?:\.|dot)\s*[\]\)\}>]\s*/gi, '.')          // [.]  (.)  [dot]
  t = t.replace(/\bhxxp(s?):\/\//gi, 'http$1://')                              // hxxp://
  // known domains typed with spaces:  chat . whatsapp . com / XXXX
  t = t.replace(/\b(chat|api|www|business)\s*\.\s*whatsapp\s*\.\s*com\s*\/\s*/gi, (_, p) => `${p.toLowerCase()}.whatsapp.com/`)
  t = t.replace(/\bwhatsapp\s*\.\s*com\s*\/\s*channel\s*\/\s*/gi, 'whatsapp.com/channel/')
  t = t.replace(/\bwa\s*\.\s*me\s*\/\s*/gi, 'wa.me/')
  t = t.replace(/\bt\s*\.\s*me\s*\/\s*/gi, 't.me/')
  t = t.replace(/\bdiscord\s*\.\s*gg\s*\/\s*/gi, 'discord.gg/')
  return t
}

// ── patterns, most specific first (a match is blanked so it is only reported once) ──
const PATTERNS = [
  ['whatsapp-channel', /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/[\w-]+/ig],
  ['whatsapp-group',   /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?[\w-]{6,}/ig],
  ['whatsapp',         /(?:https?:\/\/)?(?:wa\.me|wa\.link|whats\.app|api\.whatsapp\.com|business\.whatsapp\.com|(?:www\.)?whatsapp\.com)(?:\/[^\s<>"']*)?/ig],
  ['telegram',         /(?:(?:https?:\/\/)?(?:t\.me|telegram\.(?:me|dog|org))\/[^\s<>"']+|tg:\/\/[^\s<>"']+)/ig],
  ['discord',          /(?:https?:\/\/)?(?:discord\.gg|dsc\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/ig],
  ['url',              /\b(?:https?|ftp):\/\/[^\s<>"']+|\bwww\.[a-z0-9-]+\.[^\s<>"']+/ig],
]
// bare domains (no http, no www):  example.com   foo.xyz/page   sub.site.ng
const BARE = new RegExp(`(?<![@\\w./-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(${STRONG_TLDS}))(?![\\w@-])(?::\\d{2,5})?(\\/[^\\s<>"']*)?`, 'ig')

const trimEnd = s => s.replace(/[)\]}>"'.,;:!?*_~`]+$/, '')

function hostOf(v) {
  return v.replace(/^[a-z]+:\/\//i, '').split(/[\/?#:]/)[0].replace(/^www\./i, '').toLowerCase()
}

function allowList(opts) {
  const fromEnv = (process.env.ANTILINK_ALLOW || '').split(',')
  return [...fromEnv, ...(opts?.allow || [])].map(s => s.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean)
}
const isAllowed = (value, allow) => { const h = hostOf(value); return allow.some(a => h === a || h.endsWith('.' + a)) }

function findLinks(text, opts = {}) {
  let work = normalize(text)
  if (!work) return []
  const allow = allowList(opts)
  const found = []
  const add = (kind, raw) => {
    const value = trimEnd(raw)
    if (!value || isAllowed(value, allow)) return
    if (!found.some(f => f.value.toLowerCase() === value.toLowerCase())) found.push({ kind, value })
  }
  for (const [kind, re] of PATTERNS) {
    work = work.replace(re, m => { add(kind, m); return ' '.repeat(m.length) })
  }
  work.replace(BARE, (m, host, tld, path) => {
    // "Wait.Me" / "Okay.Co" (capital after a full stop) is a sentence, not a domain — real bare domains are typed lowercase
    if (!path && tld !== tld.toLowerCase()) return m
    add('domain', m)
    return m
  })
  return found
}

// ── pull every place a link can hide out of a WhatsApp message ───────
function unwrap(m) {
  for (let i = 0; i < 6 && m; i++) {
    const inner =
      m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message || m.protocolMessage?.editedMessage
    if (!inner) break
    m = inner
  }
  return m
}

function gather(message, texts, cards, opts) {
  const m = unwrap(message)
  if (!m || typeof m !== 'object') return
  const push = v => { if (typeof v === 'string' && v) texts.push(v) }

  push(m.conversation)
  const ext = m.extendedTextMessage
  if (ext) { push(ext.text); push(ext.matchedText); push(ext.canonicalUrl) }

  push(m.imageMessage?.caption); push(m.videoMessage?.caption); push(m.liveLocationMessage?.caption)
  const doc = m.documentMessage; if (doc) { push(doc.caption); push(doc.fileName); push(doc.title) }

  const b = m.buttonsMessage; if (b) { push(b.contentText); push(b.footerText); (b.buttons || []).forEach(x => push(x?.buttonText?.displayText)) }
  const tpl = m.templateMessage?.hydratedTemplate || m.templateMessage?.hydratedFourRowTemplate
  if (tpl) { push(tpl.hydratedContentText); push(tpl.hydratedFooterText); (tpl.hydratedButtons || []).forEach(x => { push(x?.urlButton?.url); push(x?.urlButton?.displayText) }) }
  const list = m.listMessage; if (list) { push(list.title); push(list.description); push(list.footerText); (list.sections || []).forEach(s => (s.rows || []).forEach(r => { push(r.title); push(r.description) })) }
  const inter = m.interactiveMessage
  if (inter) { push(inter.body?.text); push(inter.header?.title); push(inter.footer?.text); (inter.nativeFlowMessage?.buttons || []).forEach(x => push(x?.buttonParamsJson)) }
  for (const k of ['pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3']) {
    const p = m[k]; if (p) { push(p.name); (p.options || []).forEach(o => push(o?.optionName)) }
  }
  push(m.contactMessage?.displayName); push(m.contactMessage?.vcard)
  ;(m.contactsArrayMessage?.contacts || []).forEach(c => { push(c?.displayName); push(c?.vcard) })
  const loc = m.locationMessage; if (loc) { push(loc.name); push(loc.address); push(loc.url); push(loc.comment) }

  // WhatsApp invite CARDS (not text, so text scanners miss them)
  if (m.groupInviteMessage) { cards.push('group-invite-card'); push(m.groupInviteMessage.caption) }
  if (m.newsletterAdminInviteMessage) { cards.push('channel-invite-card'); push(m.newsletterAdminInviteMessage.caption) }

  // contextInfo (ad-reply buttons, forwarded-from-channel). The QUOTED message is deliberately ignored.
  for (const v of Object.values(m)) {
    const ctx = v && typeof v === 'object' ? v.contextInfo : null
    if (!ctx) continue
    push(ctx.externalAdReply?.sourceUrl)
    if (ctx.forwardedNewsletterMessageInfo && (opts.blockChannelForwards ?? process.env.ANTILINK_BLOCK_CHANNEL_FORWARDS === '1')) cards.push('channel-forward')
  }
}

function scan(message, opts = {}) {
  const texts = [], cards = []
  gather(message, texts, cards, opts)
  const links = []
  for (const t of texts) {
    for (const l of findLinks(t, opts)) if (!links.some(x => x.value.toLowerCase() === l.value.toLowerCase())) links.push(l)
  }
  for (const c of new Set(cards)) links.push({ kind: c, value: c })
  return { hit: links.length > 0, links, kinds: [...new Set(links.map(l => l.kind))] }
}

const LABELS = {
  'whatsapp-channel': '📢 WhatsApp channel link', 'whatsapp-group': '👥 WhatsApp group invite', 'whatsapp': '💬 WhatsApp link',
  'telegram': '✈️ Telegram link', 'discord': '🎮 Discord invite', 'url': '🔗 Web link', 'domain': '🌐 Website address',
  'group-invite-card': '👥 Group invite card', 'channel-invite-card': '📢 Channel invite card', 'channel-forward': '📢 Forwarded channel post',
}
const label = kind => LABELS[kind] || kind

module.exports = { linkDetect: { scan, findLinks, normalize, label, LABELS } }
