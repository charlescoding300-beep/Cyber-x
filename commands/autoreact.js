'use strict'
// commands/autoreact.js — AutoReact (per-session, multi-tenant safe)
//
//   .autoreact on | off | status
//   .autoreact groups on|off     (groups + communities)   default on
//   .autoreact dms on|off        (private chats to this number)   default on
//   .autoreact channels on|off   (WhatsApp Channels)   default on
//   .autoreact emoji <emoji|auto>   force one emoji, or "auto" = pick by content (default)
//
// When ON, every NEW incoming message gets an emoji reaction chosen from its content
// (text meaning, or media type). Called from index.js processPassive() for every message:
//     autoReact.handleAutoReact({ state, sock, msg: m, from: jid })
//
// Safety built in (so WhatsApp does not flag the number):
//   • ignores your own messages, statuses, reactions/edits/system messages
//   • ignores OLD messages (offline catch-up after a reconnect never gets reacted to)
//   • caps reactions per minute (env AUTOREACT_MAX_PER_MIN, default 40)
//   • pauses a chat for 10 min after 3 failed reactions in a row (e.g. admins-only groups)
// Channels only allow a basic emoji set, so channel reactions use: 👍 ❤️ 😂 😮 😢 🙏

let baileys = {}
try { baileys = require('@systemzero/baileys') } catch { try { baileys = require('@whiskeysockets/baileys') } catch {} }
const getContentType = baileys.getContentType || ((m) => Object.keys(m || {}).find((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage'))

const KEY = 'autoreact'
const MAX_PER_MIN = Number(process.env.AUTOREACT_MAX_PER_MIN) || 40
const MAX_AGE_SEC = 45
const DEFAULT_CHANNEL_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ANY_CHANNEL_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','🥰','😍','🤩','😘',
  '😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔',
  '🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','🫠','🥹','😌',
  '😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠',
  '🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦',
  '😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡',
  '😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','👾','🤖','🎃','😺','😸','😹',
  '😻','😼','😽','🙀','😿','😾','🙌','👏','🤝','🙏','💪','🫶','👐','🤲','✍️','💅',
  '🤳','💃','🕺','👀','🫰','🤟','🤘','👌','🤌','🤏','✌️','🤞','🤙','👋','🖐️',
  '✋','🖖','🫱','🫲','🫳','🫴','🫵','👍','👎','✊','👊','🤛','🤜','❤️','🧡','💛',
  '💚','💙','🩵','💜','🖤','🩶','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘',
  '💝','💟','☮️','✝️','☪️','🕉️','☯️','✡️','⭐','🌟','✨','⚡','🔥','💥','💫','💦',
  '💨','🕊️','🌈','☀️','🌙','🌹','🌺','🌸','🌼','🌻','🍀','🌿','🍕','🍿','🎉','🎊',
  '🎈','🎁','🎂','🏆','🥇','⚽','🎮','🎵','🎧','💯','✅','❌','❓','❗','💤','🧿'
];
const CHANNEL_MODE_KEY = 'autoreact_channel_emoji_mode';

const isEnabled = (s) => s?.get(KEY) === true
const scopeOn = (s, name) => s?.get(`${KEY}_${name}`) !== false
const fixedEmoji = (s) => { const e = s?.get(`${KEY}_emoji`); return e && e !== 'auto' ? e : null }

const pick = (a) => a[Math.floor(Math.random() * a.length)]

// ───────── content → emoji (first matching rule wins) ─────────
const RULES = [
  ['rip',      /\b(rip|rest in peace|condolence|passed away|sad news|late [a-z]+ has)\b/i, ['😢', '🙏', '💔']],
  ['birthday', /\b(happy birthday|hbd|birthday|bday|born ?day)\b/i, ['🎂', '🎉', '🥳']],
  ['congrats', /\b(congrat\w*|well done|mazel|you did it|i passed|got the job|promoted|big win|jara)\b/i, ['🎉', '👏', '🥳', '🔥']],
  ['thanks',   /\b(thank\w*|thx|tnx|appreciat\w*|grateful|God bless)\b/i, ['🙏', '🤝', '❤️']],
  ['prayer',   /\b(amen|pray|prayer|inshallah|alhamdulillah|hallelujah|jesus|bless(ed)?)\b/i, ['🙏', '🙌', '❤️']],
  ['love',     /\b(i love you|love you|luv u|my love|miss you|i miss|bae|babe|darling)\b|❤|😍|🥰|😘/i, ['❤️', '😍', '🥰']],
  ['sad',      /\b(sad|cry(ing)?|depress(ed)?|heartbroken|lonely|sorry to hear|i'?m hurt|pain|stress(ed)?|tired of)\b|😢|😭|💔/i, ['😢', '🤗', '💔']],
  ['laugh',    /\b(lol|lmao|lmfao|rofl|haha+|hehe+|kekeke+|jor|funny|joke|dead 😂|i'?m dying)\b|😂|🤣|😆/i, ['😂', '🤣', '😆']],
  ['angry',    /\b(angry|annoyed|furious|rubbish|nonsense|useless|wtf|stupid|hate)\b|😡|🤬/i, ['😡', '😤', '😮']],
  ['shock',    /\b(omg|omo|chai|wow|no way|unbelievable|crazy|insane|what the|oh my)\b|😱|😮|🤯/i, ['😮', '😱', '🤯']],
  ['sad',      /\b(wahala|abeg|e don tire me|na wa)\b/i, ['😩', '🙏', '😅']],
  ['morning',  /\b(good morning|gm|morning (fam|everyone|guys|all)|rise and shine)\b/i, ['☀️', '🌞', '👋']],
  ['night',    /\b(good night|goodnight|gn|sleep well|sweet dreams|night (fam|everyone|guys|all))\b/i, ['🌙', '😴', '💤']],
  ['hello',    /^(hi+|hey+|hello+|hola|yo+|sup|wassup|what'?s up|how far|how are you|good (afternoon|evening))\b/i, ['👋', '🙌', '😊']],
  ['bye',      /^(bye|goodbye|see you|cya|later|ttyl|i'?m out)\b/i, ['👋', '🙏']],
  ['money',    /(₦|\$|£|€)\s?\d|\b(money|cash|naira|dollar|transfer(red)?|payment|paid|salary|invest|profit|crypto|bitcoin|btc)\b/i, ['💰', '🤑', '💸']],
  ['food',     /\b(food|eat(ing)?|lunch|dinner|breakfast|jollof|rice|pizza|burger|hungry|suya|chop)\b/i, ['😋', '🍽️', '🔥']],
  ['football', /\b(football|soccer|match|goal|arsenal|chelsea|liverpool|man (utd|united|city)|barca|barcelona|real madrid|super eagles|premier league|ucl)\b/i, ['⚽', '🔥', '👏']],
  ['cool',     /\b(fire|lit|dope|sweet|nice|cool|awesome|great|amazing|beautiful|mad|sharp|clean|goat|legend|best)\b|🔥|💯/i, ['🔥', '💯', '😎']],
  ['code',     /```|\b(bug|error|code|function|javascript|python|api|server|deploy)\b/i, ['👨‍💻', '💻', '👍']],
  ['no',       /^(no+|nah+|nope|never|not really)[.! ]*$/i, ['👎', '😬']],
  ['yes',      /^(yes+|yeah+|yep|ok(ay)?|sure|done|correct|exactly|true|fine|alright|noted|bet)[.! ]*$/i, ['👍', '✅', '💯']],
]
const MEDIA = {
  imageMessage: ['🔥', '👀', '😍', '👌'],
  videoMessage: ['🔥', '👀', '😂', '🎬'],
  ptvMessage: ['🔥', '👀', '😂'],
  audioMessage: ['🎧', '👂', '❤️'],
  stickerMessage: ['😂', '😆', '😄', '🤣'],
  documentMessage: ['📄', '👍', '👀'],
  contactMessage: ['👤', '👍'],
  contactsArrayMessage: ['👥', '👍'],
  locationMessage: ['📍', '👀'],
  liveLocationMessage: ['📍', '👀'],
  pollCreationMessage: ['🤔', '🗳️', '👀'],
  pollCreationMessageV2: ['🤔', '🗳️', '👀'],
  pollCreationMessageV3: ['🤔', '🗳️', '👀'],
}
const SKIP_TYPES = new Set(['protocolMessage', 'reactionMessage', 'encReactionMessage', 'senderKeyDistributionMessage',
  'pollUpdateMessage', 'keepInChatMessage', 'messageContextInfo', 'editedMessage', 'albumMessage'])
const DEFAULT_POOL = ['👍', '👌', '🙌', '✨']
const EMOJI_RE = /\p{Extended_Pictographic}/u

function unwrap(message) {
  let cur = message
  for (let i = 0; i < 10 && cur; i++) {
    const next = cur.ephemeralMessage?.message || cur.viewOnceMessageV2Extension?.message || cur.viewOnceMessageV2?.message ||
      cur.viewOnceMessage?.message || cur.documentWithCaptionMessage?.message || cur.groupStatusMessageV2?.message
    if (!next) break
    cur = next
  }
  return cur || null
}

function textOf(inner) {
  if (!inner) return ''
  return String(inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption ||
    inner.videoMessage?.caption || inner.documentMessage?.caption || '')
}

// first emoji grapheme of a string (keeps ❤️, 👍🏽, 👨‍💻 intact)
function firstEmoji(s) {
  try {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    for (const { segment } of seg.segment(s)) if (EMOJI_RE.test(segment)) return segment
  } catch (_) { const m = String(s).match(/\p{Extended_Pictographic}\uFE0F?/u); return m ? m[0] : null }
  return null
}

function chooseEmoji(inner, type) {
  const text = textOf(inner).trim()
  if (text) {
    // message that is basically just emojis -> mirror the first one
    const stripped = text.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|\s/gu, '')
    if (!stripped.length && EMOJI_RE.test(text)) { const e = firstEmoji(text); if (e) return { emoji: e, cat: 'mirror' } }
    for (const [cat, re, pool] of RULES) if (re.test(text)) return { emoji: pick(pool), cat }
    if (/https?:\/\/|www\./i.test(text)) return { emoji: pick(['👀', '👍', '🤔']), cat: 'link' }
    if (/\?\s*$/.test(text)) return { emoji: pick(['🤔', '🧐', '👀']), cat: 'question' }
    const letters = text.replace(/[^A-Za-z]/g, '')
    if ((letters.length >= 6 && letters === letters.toUpperCase()) || /!{2,}/.test(text)) return { emoji: pick(['😮', '🔥', '😱']), cat: 'shock' }
    return { emoji: pick(DEFAULT_POOL), cat: 'default' }
  }
  if (MEDIA[type]) {
    const pool = type === 'audioMessage' && inner[type]?.ptt ? ['👂', '🎙️', '❤️'] : MEDIA[type]
    return { emoji: pick(pool), cat: type === 'stickerMessage' ? 'laugh' : 'media' }
  }
  return { emoji: pick(DEFAULT_POOL), cat: 'default' }
}

const channelResultBySock = new WeakMap();
function channelMode(settings) {
  return settings?.get(CHANNEL_MODE_KEY) === 'default' ? 'default' : 'any';
}
function channelResultMap(sock) {
  let map = channelResultBySock.get(sock);
  if (!map) { map = new Map(); channelResultBySock.set(sock, map); }
  return map;
}
function chooseChannelEmoji(sock, jid, settings) {
  const result = channelResultMap(sock).get(jid);
  const mode = result && result.until > Date.now() ? result.mode : channelMode(settings);
  return pick(mode === 'default' || mode === 'blocked' ? DEFAULT_CHANNEL_EMOJIS : ANY_CHANNEL_EMOJIS);
}
function channelEmojiRejected(error) {
  return /emoji|reaction|not allowed|not permitted|not[- ]?authori[sz]ed|unsupported|disallowed|invalid|forbidden/i.test(String(error?.message || error));
}
async function reactToChannel(sock, jid, serverId, settings) {
  const map = channelResultMap(sock);
  const cached = map.get(jid);
  if (cached && cached.until > Date.now() && cached.mode === 'blocked') return false;
  const configured = channelMode(settings);
  const mode = cached && cached.until > Date.now() ? cached.mode : configured;
  const emoji = pick(mode === 'default' || mode === 'blocked' ? DEFAULT_CHANNEL_EMOJIS : ANY_CHANNEL_EMOJIS);
  try {
    await sock.newsletterReactMessage(jid, String(serverId), emoji);
    if (cached && cached.until <= Date.now()) map.delete(jid);
    return true;
  } catch (error) {
    if (configured === 'any' && mode === 'any' && channelEmojiRejected(error)) {
      const fallback = pick(DEFAULT_CHANNEL_EMOJIS);
      try {
        await sock.newsletterReactMessage(jid, String(serverId), fallback);
        map.set(jid, { mode: 'default', until: Date.now() + 10 * 60 * 1000 });
        return true;
      } catch (fallbackError) {
        if (channelEmojiRejected(fallbackError)) {
          map.set(jid, { mode: 'blocked', until: Date.now() + 10 * 60 * 1000 });
        }
        throw fallbackError;
      }
    }
    if (channelEmojiRejected(error)) {
      map.set(jid, { mode: 'blocked', until: Date.now() + 10 * 60 * 1000 });
    }
    throw error;
  }
}

// ───────── safety state (per socket, never shared between sessions) ─────────
const rateBySock = new WeakMap()
const failBySock = new WeakMap()
const seenBySock = new WeakMap()

function underRateLimit(sock) {
  const now = Date.now()
  const arr = (rateBySock.get(sock) || []).filter((t) => now - t < 60000)
  if (arr.length >= MAX_PER_MIN) { rateBySock.set(sock, arr); return false }
  arr.push(now); rateBySock.set(sock, arr)
  return true
}
function chatPaused(sock, jid) {
  const f = failBySock.get(sock)?.get(jid)
  return !!f && f.until > Date.now()
}
function noteResult(sock, jid, ok) {
  let m = failBySock.get(sock); if (!m) { m = new Map(); failBySock.set(sock, m) }
  if (ok) { m.delete(jid); return }
  const f = m.get(jid) || { n: 0, until: 0 }
  f.n += 1
  if (f.n >= 3) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0 }
  m.set(jid, f)
}

function tsSeconds(msg) {
  const t = msg?.messageTimestamp
  if (t === undefined || t === null) return null
  const n = typeof t === 'object' ? Number(t.low ?? t.toString()) : Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

const kindOf = (jid) =>
  jid.endsWith('@g.us') ? 'groups'
    : jid.endsWith('@newsletter') ? 'channels'
      : (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) ? 'dms'
        : null

// ───────── the live handler ─────────
async function handleAutoReact({ state, sock, msg, from }) {
  try {
    const settings = state?.settings
    if (!isEnabled(settings)) return false
    if (!from || !msg?.key?.id || !msg.message) return false
    if (msg.key.fromMe) return false
    const kind = kindOf(from)
    if (!kind || !scopeOn(settings, kind)) return false          // skips status@broadcast and unknown jids

    const ts = tsSeconds(msg)
    if (ts && Date.now() / 1000 - ts > MAX_AGE_SEC) return false  // old / catch-up message

    const inner = unwrap(msg.message)
    const type = inner && getContentType(inner)
    if (!inner || !type || SKIP_TYPES.has(type)) return false

    let seen = seenBySock.get(sock); if (!seen) { seen = new Set(); seenBySock.set(sock, seen) }
    const sid = `${from}|${msg.key.id}`
    if (seen.has(sid)) return false
    seen.add(sid); if (seen.size > 3000) seen.delete(seen.values().next().value)

    if (chatPaused(sock, from)) return false
    if (!underRateLimit(sock)) return false

    const forced = fixedEmoji(settings)
    const pickd = forced ? { emoji: forced, cat: 'default' } : chooseEmoji(inner, type)

    try {
      if (kind === 'channels') {
        const serverId = msg.key.server_id || msg.key.serverId || msg.serverId || msg.newsletterServerId
        if (!serverId || typeof sock.newsletterReactMessage !== 'function') return false
        if (!(await reactToChannel(sock, from, serverId, settings))) return false
      } else {
        await sock.sendMessage(from, { react: { text: pickd.emoji, key: msg.key } })
      }
      noteResult(sock, from, true)
      return true
    } catch (e) {
      noteResult(sock, from, false)
      console.log(`[AUTOREACT] ${from} failed: ${e?.message || e}`)
      return false
    }
  } catch (e) {
    console.error('[AUTOREACT] handler error:', e?.stack || e)
    return false
  }
}

function ownerRestricted(sock, jid, msg) {
  if (typeof sendOwnerRestricted === 'function') return sendOwnerRestricted(sock, jid, msg)
  return sock.sendMessage(jid, { text: '🚫 This command is for the owner only.' }, { quoted: msg })
}

module.exports = {
  pattern: 'autoreact',
  name: 'autoreact',
  alias: ['areact'],
  category: 'owner',
  desc: 'Automatically react to every new message (groups, DMs, channels) with an emoji that fits it',
  usage: '.autoreact on|off|status · .autoreact groups|dms|channels on|off · .autoreact emoji <emoji|auto>',

  run: async ({ sock, from, msg, args, isOwner, settings }) => {
    if (!isOwner) return ownerRestricted(sock, msg?.key?.remoteJid, msg)
    const reply = (text) => sock.sendMessage(from, { text }, { quoted: msg })
    const a = String(args?.[0] || 'status').toLowerCase()
    const v = String(args?.[1] || '').toLowerCase()

    if (a === 'on' || a === 'enable') {
      settings?.set(KEY, true)
      return reply([
        '😎 *AUTO-REACT ENABLED*',
        '',
        'Every new message in your groups, DMs and channels will get an emoji that fits it.',
        '',
        'Use *.autoreact off* to stop · *.autoreact status* for details.',
      ].join('\n'))
    }
    if (a === 'off' || a === 'disable') { settings?.set(KEY, false); return reply('😴 *AUTO-REACT DISABLED* for this number.') }

    if (['groups', 'dms', 'channels'].includes(a)) {
      if (v !== 'on' && v !== 'off') return reply(`Use *.autoreact ${a} on* or *.autoreact ${a} off*`)
      settings?.set(`${KEY}_${a}`, v === 'on')
      return reply(`✅ AutoReact for *${a}* is now ${v === 'on' ? 'ON' : 'OFF'}.`)
    }

    if (a === 'emoji') {
      const raw = String(args?.[1] || '').trim()
      if (raw.toLowerCase() === 'auto') { settings?.set(`${KEY}_emoji`, 'auto'); return reply('✅ AutoReact now picks the emoji by content.') }
      const e = firstEmoji(raw)
      if (!e) return reply('Send a real emoji, e.g. *.autoreact emoji 🔥*  (or *auto*).')
      settings?.set(`${KEY}_emoji`, e)
      return reply(`✅ Fixed emoji set to ${e} for groups and DMs. Channels use the channel emoji mode.`)
    }

    if (a === 'channelemoji') {
      if (v !== 'any' && v !== 'default') return reply('Use *.autoreact channelemoji any* for channels allowing any emoji, or *.autoreact channelemoji default* for default-only channels.')
      settings?.set(CHANNEL_MODE_KEY, v)
      channelResultBySock.delete(sock)
      return reply(`✅ Channel emoji mode: *${v === 'any' ? 'any emoji' : 'default emoji only'}*. WhatsApp still enforces each channel’s reaction setting.`)
    }

    if (a === 'status') {
      const on = (n) => (scopeOn(settings, n) ? '✅' : '❌')
      return reply([
        '😎 *AUTO-REACT STATUS*',
        '',
        `This number: ${isEnabled(settings) ? '✅ ENABLED' : '❌ DISABLED'}`,
        `Groups & communities: ${on('groups')}   DMs: ${on('dms')}   Channels: ${on('channels')}`,
        `Emoji: ${fixedEmoji(settings) || 'auto (by content)'}`,
        `Channel emoji mode: ${channelMode(settings)}`,
        `Limit: ${MAX_PER_MIN} reactions / minute`,
      ].join('\n'))
    }

    return reply([
      '😎 *AUTO-REACT*',
      '',
      '• *.autoreact on* / *off*',
      '• *.autoreact groups|dms|channels on|off*',
      '• *.autoreact emoji 🔥* or *auto*',
      '• *.autoreact channelemoji any|default*',
      '• *.autoreact status*',
    ].join('\n'))
  },

  isEnabled,
  handleAutoReact,
  chooseEmoji,
  _chooseChannelEmoji: chooseChannelEmoji,
}
